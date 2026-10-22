import { spawn } from 'node:child_process'
import { config } from '../config.js'

export type CliResult = {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

export type CliOptions = {
  cwd: string
  timeoutMs?: number
  env?: Record<string, string>
  /** Called with each stdout/stderr chunk, for live logs. */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void
  /** Receives the child so a caller can cancel it. */
  onSpawn?: (kill: (signal?: NodeJS.Signals) => void) => void
  maxCapture?: number
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_CAPTURE = 512 * 1024

function keepTail(buffer: string, chunk: string, max: number): string {
  const next = buffer + chunk
  return next.length > max ? next.slice(next.length - max) : next
}

/**
 * Run the hyperframes CLI without a shell. Arguments are passed verbatim, so
 * shell metacharacters have no effect. The whole process group is killed on
 * timeout or cancel so Chrome and FFmpeg children do not linger.
 */
export function runCli(args: string[], options: CliOptions): Promise<CliResult> {
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxCapture = options.maxCapture ?? DEFAULT_CAPTURE
  return new Promise((resolvePromise, reject) => {
    const child = spawn(config.cli, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1',
        HEYGEN_NO_ANALYTICS: '1', HEYGEN_NO_UPDATE_CHECK: '1', HEYGEN_NONINTERACTIVE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const kill = (signal: NodeJS.Signals = 'SIGTERM') => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          /* already gone */
        }
      }
    }
    options.onSpawn?.(kill)

    const timer = setTimeout(() => {
      timedOut = true
      kill('SIGTERM')
      setTimeout(() => kill('SIGKILL'), 10_000).unref()
    }, timeoutMs)

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      stdout = keepTail(stdout, text, maxCapture)
      options.onOutput?.(text, 'stdout')
    })
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      stderr = keepTail(stderr, text, maxCapture)
      options.onOutput?.(text, 'stderr')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      })
    })
  })
}

/** Parse the last JSON document in a CLI's stdout (progress lines may precede it). */
export function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    // Find the last line that starts a JSON value and parse from there.
    const lines = trimmed.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const candidate = lines.slice(i).join('\n').trim()
      if (candidate.startsWith('{') || candidate.startsWith('[')) {
        try {
          return JSON.parse(candidate)
        } catch {
          /* keep looking */
        }
      }
    }
    return null
  }
}

/**
 * Subcommands `run_cli` may invoke. Interactive account management, publishing,
 * telemetry and desktop hand-off stay out. Allowed media-use/tts/capture commands
 * may contact optional providers when configured: this is a trusted-agent API,
 * not a guarantee that every subcommand is offline or cost-free.
 */
export const allowedCliCommands = new Set([
  'lint',
  'check',
  'inspect',
  'layout', // Upstream compatibility alias for inspect.
  'validate', // Upstream compatibility runtime/contrast diagnostic.
  'snapshot',
  'timeline',
  'info',
  'compositions',
  'keyframes',
  'catalog',
  'add',
  'beats',
  // Local signal analysis. The hosted provider (HYPERFRAMES_AUDIO_API_URL +
  // HYPERFRAMES_AUDIO_API_KEY) and Beat This! (a configured Python) are
  // unavailable in this image, so `audio` reads the file and never uploads it.
  'audio',
  'normalize-audio',
  'media-treatment',
  'media-use',
  'capture',
  'compare',
  'grade-compare',
  'doctor',
  'clean',
  'transcribe',
  'tts',
  'models',
  'remove-background',
  'history',
  'upgrade',
  'figma',
  'docs',
  'render',
])

export function assertAllowedCli(args: string[]): void {
  if (!Array.isArray(args) || args.length === 0) throw new Error('args must be a non-empty array')
  if (args.length > 64) throw new Error('too many arguments')
  for (const a of args) {
    if (typeof a !== 'string') throw new Error('every argument must be a string')
    if (a.length > 4096) throw new Error('argument too long')
    if (a.includes('\0')) throw new Error('argument contains a NUL byte')
  }
  const command = args[0]
  if (!allowedCliCommands.has(command)) {
    throw new Error(
      `subcommand "${command}" is not available through the agent API; allowed: ${[...allowedCliCommands].sort().join(', ')}`,
    )
  }
  if (args.some((a) => a === '--docker' || a.startsWith('--docker='))) throw new Error('--docker is not available inside the service')
  if (args.some((a) => a === '--file-issue' || a.startsWith('--file-issue='))) throw new Error('--file-issue publishes the project; refused')
  const flagRule = flagRules[command]
  if (flagRule) {
    const flags = args.slice(1)
    const bad = flags.find((a) => !flagRule.allowed.has(a))
    if (bad !== undefined) throw new Error(`${command} ${bad}: ${flagRule.reason}`)
    if (!flags.some((a) => flagRule.requireOne.has(a))) throw new Error(`${command}: ${flagRule.reason}`)
  }
}

/**
 * Commands whose safety depends on their flags. Every argument after the
 * command must be in `allowed`, and one of `requireOne` must be present.
 * Values are refused too, so a flag cannot be pointed at a path outside the
 * project.
 */
const flagRules: Record<string, { allowed: Set<string>; requireOne: Set<string>; reason: string }> = {
  // Bare `upgrade` prompts, and `upgrade --yes` runs the installer and replaces
  // the CLI pinned in this image. `--check` only reports, and `--project`
  // rewrites the current project's own package.json pins.
  upgrade: {
    allowed: new Set(['--check', '--project', '--json']),
    requireOne: new Set(['--check', '--project']),
    reason: 'only `upgrade --check` and `upgrade --project` (plus `--json`) are available; the CLI version is pinned by the image',
  },
}
