import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { config } from './config.js'
import { projectJson, requireProject } from './projects.js'
import { assertAllowedCli, parseJsonOutput, runCli } from './util/cli.js'
import { ApiError, badRequest } from './util/errors.js'
import { resolveInside } from './util/paths.js'

// Operations shared by the REST API and the MCP tools. Each one wraps a
// hyperframes CLI command and returns the parsed `--json` payload.

export async function lintProject(project: string, verbose = false): Promise<unknown> {
  const args = ['lint']
  if (verbose) args.push('--verbose')
  return projectJson(project, args, 120_000)
}

export type CheckOptions = {
  snapshots?: boolean
  at?: number[]
  samples?: number
  strict?: boolean
  contrast?: boolean
  atTransitions?: boolean
  range?: [number, number]
  components?: string
  maxTransitionSamples?: number
  maxIssues?: number
  collapseStatic?: boolean
}

export function checkArgs(options: CheckOptions = {}): string[] {
  const args = ['check']
  if (options.snapshots) args.push('--snapshots')
  if (options.at?.length) args.push('--at', options.at.map(numArg).join(','))
  if (options.samples !== undefined) args.push('--samples', String(intArg(options.samples, 1, 60)))
  if (options.strict) args.push('--strict')
  if (options.contrast === false) args.push('--no-contrast')
  if (options.atTransitions) args.push('--at-transitions')
  if (options.range !== undefined) args.push('--range', rangeArg(options.range))
  if (options.components !== undefined) args.push('--components', textArg(options.components, 'components'))
  if (options.maxTransitionSamples !== undefined) args.push('--max-transition-samples', String(intArg(options.maxTransitionSamples, 1, 10000)))
  if (options.maxIssues !== undefined) args.push('--max-issues', String(intArg(options.maxIssues, 1, 1000)))
  if (options.collapseStatic === false) args.push('--no-collapse-static')
  return args
}

export async function checkProject(project: string, options: CheckOptions = {}): Promise<unknown> {
  return projectJson(project, checkArgs(options), 10 * 60_000)
}

export type SnapshotOptions = {
  at?: number[]
  frames?: number
  zoom?: string
  end?: boolean
  /** Explicit opt-in to Gemini descriptions; dedicated REST/MCP tools force false. */
  describe?: boolean
  review?: boolean
  range?: [number, number]
  /** data-composition-id (not a filename). */
  composition?: string
}

export type SnapshotResult = {
  outputDir: string
  files: { path: string; size: number }[]
  stdout: string
  /** Upstream JSON frame times, contact sheets and optional review plan. */
  json: unknown
}

export async function snapshotProject(project: string, options: SnapshotOptions = {}): Promise<SnapshotResult> {
  const dir = await requireProject(project)
  const relOut = `snapshots/${new Date().toISOString().replace(/[:.]/g, '-')}`
  const outDir = await resolveInside(dir, relOut)
  const args = snapshotArgs(dir, outDir, options)
  const result = await runCli(args, { cwd: dir, timeoutMs: 10 * 60_000 })
  const names = await readdir(outDir).catch(() => [])
  if (result.exitCode !== 0) {
    throw new ApiError(500, 'hyperframes snapshot failed', {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-4000),
      stdout: result.stdout.slice(-4000),
    })
  }
  const files: SnapshotResult['files'] = []
  for (const n of names.sort()) {
    const s = await stat(join(outDir, n)).catch(() => null)
    if (s?.isFile()) files.push({ path: `${relOut}/${n}`, size: s.size })
  }
  return { outputDir: relOut, files, stdout: result.stdout.slice(-4000), json: parseJsonOutput(result.stdout) }
}

export function snapshotArgs(dir: string, outDir: string, options: SnapshotOptions = {}): string[] {
  if ([options.at !== undefined, options.range !== undefined, options.composition !== undefined].filter(Boolean).length > 1) {
    throw badRequest('use only one of at, range or composition')
  }
  if (options.review && (options.at !== undefined || options.range !== undefined || options.zoom !== undefined)) {
    throw badRequest('review picks its own frames; omit at, range and zoom')
  }
  const args = ['snapshot', dir, '--output', outDir, '--json']
  if (options.review) args.push('--review')
  if (options.range !== undefined) args.push('--range', rangeArg(options.range))
  if (options.composition !== undefined) args.push('--composition', textArg(options.composition, 'composition'))
  if (options.at?.length) args.push('--at', options.at.map(numArg).join(','))
  else if (options.frames !== undefined) args.push('--frames', String(intArg(options.frames, 1, 60)))
  if (options.zoom) {
    if (options.zoom.length > 200 || options.zoom.includes('\0')) throw badRequest('zoom is too long')
    args.push('--zoom', options.zoom)
  }
  if (options.end === false) args.push('--no-end')
  // A configured Gemini key must never silently turn a local screenshot into an upload.
  if (options.describe !== true) args.push('--describe', 'false')
  return args
}

export async function readSnapshotPng(project: string, path: string): Promise<Buffer> {
  const dir = await requireProject(project)
  const abs = await resolveInside(dir, path)
  return readFile(abs)
}

export type CatalogOptions = { query?: string; type?: 'block' | 'component'; tag?: string }

export async function catalogSearch(options: CatalogOptions): Promise<unknown> {
  const args = ['catalog', '--json']
  if (options.query) {
    if (options.query.length > 500) throw badRequest('query is too long')
    args.push('--query', options.query)
  }
  if (options.type) args.push('--type', options.type)
  if (options.tag) {
    if (!/^[a-z0-9-]{1,40}$/.test(options.tag)) throw badRequest('tag must be a lowercase slug')
    args.push('--tag', options.tag)
  }
  const result = await runCli(args, { cwd: config.projectsDir, timeoutMs: 120_000 })
  const parsed = parseJsonOutput(result.stdout)
  if (parsed === null) {
    throw new ApiError(502, 'hyperframes catalog returned no JSON', {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-4000),
    })
  }
  return parsed
}

export type CatalogAddOptions = {
  /** Variable values baked into the returned snippet as `data-variable-values`. */
  vars?: Record<string, unknown>
  /** Overwrite files the project edited since the item was installed. */
  force?: boolean
}

export function catalogAddArgs(name: string, dir: string, options: CatalogAddOptions = {}): string[] {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)) throw badRequest('name must be a registry item or tag slug')
  const args = ['add', name, '--dir', dir, '--no-clipboard', '--json']
  if (options.vars !== undefined) {
    if (typeof options.vars !== 'object' || options.vars === null || Array.isArray(options.vars)) {
      throw badRequest('vars must be an object of variable values')
    }
    const json = JSON.stringify(options.vars)
    if (json.length > 16_000) throw badRequest('vars is too large')
    args.push('--vars', json)
  }
  if (options.force) args.push('--force')
  return args
}

export async function catalogAdd(project: string, name: string, options: CatalogAddOptions = {}): Promise<unknown> {
  const dir = await requireProject(project)
  const result = await runCli(catalogAddArgs(name, dir, options), {
    cwd: dir,
    timeoutMs: 5 * 60_000,
  })
  const parsed = parseJsonOutput(result.stdout)
  if (result.exitCode !== 0) {
    throw new ApiError(502, `hyperframes add ${name} failed`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-4000),
      stdout: result.stdout.slice(-4000),
    })
  }
  return parsed ?? { stdout: result.stdout }
}

export type CliRunResult = {
  args: string[]
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  json: unknown
}

// Snapshot's describe is a string, not a boolean: any non-"false" value uploads.
// Match citty 0.2.2's node:util parser string operands, including output's alias.
const snapshotStringOptions = Object.fromEntries(
  ['output', 'o', 'frames', 'at', 'range', 'composition', 'timeout', 'angle', 'zoom', 'zoom-scale', 'zoomScale', 'against', 'describe']
    .map(name => [name, { type: 'string' as const, ...(name === 'output' ? { short: 'o' } : {}) }]),
)

function snapshotConsentArgs(args: string[]): string[] {
  let describe: string | undefined
  const normalized = [args[0]]
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    // Terminators and negated spellings make lexical consent ambiguous.
    if (arg === '--' || arg === '--no-describe' || arg.startsWith('--no-describe=')) {
      throw badRequest('snapshot requires an unambiguous --describe value; omit it for local-only snapshots')
    }
    if (arg === '--describe' || arg.startsWith('--describe=')) {
      if (describe !== undefined) throw badRequest('duplicate --describe is not allowed')
      const value = arg === '--describe' ? args[++i] : arg.slice('--describe='.length)
      if (!value?.trim() || value.startsWith('-')) throw badRequest('--describe requires false, true or a custom question')
      describe = value
    } else normalized.push(arg)
  }
  const value = describe ?? 'false'
  // Validate the original explicit operand too: a preceding string option may
  // swallow --describe, which must not be mistaken for intentional consent.
  const parsed = parseArgs({ args: args.slice(1).filter(arg => !arg.startsWith('--no-')), options: snapshotStringOptions, strict: false, allowPositionals: true })
  if (describe !== undefined && parsed.values.describe !== describe) throw badRequest('ambiguous --describe operand')
  normalized.push('--describe', value)
  const forwarded = parseArgs({ args: normalized.slice(1).filter(arg => !arg.startsWith('--no-')), options: snapshotStringOptions, strict: false, allowPositionals: true })
  if (forwarded.values.describe !== value) throw badRequest('snapshot arguments swallow the required --describe operand')
  return normalized
}

export async function runAllowedCli(project: string | undefined, args: string[], timeoutMs?: number): Promise<CliRunResult> {
  try {
    assertAllowedCli(args)
    if (args[0] === 'snapshot') args = snapshotConsentArgs(args)
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : String(err))
  }
  const cwd = project ? await requireProject(project) : config.projectsDir
  const timeout = timeoutMs === undefined ? 10 * 60_000 : intArg(timeoutMs, 1000, 60 * 60_000)
  const result = await runCli(args, { cwd, timeoutMs: timeout })
  return {
    args,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdout: result.stdout.slice(-200_000),
    stderr: result.stderr.slice(-50_000),
    json: args.includes('--json') ? parseJsonOutput(result.stdout) : null,
  }
}

let doctorCache: { at: number; value: unknown } | null = null

export async function doctor(): Promise<unknown> {
  if (doctorCache && Date.now() - doctorCache.at < 5 * 60_000) return doctorCache.value
  const result = await runCli(['doctor', '--json'], { cwd: config.projectsDir, timeoutMs: 120_000 })
  const value = parseJsonOutput(result.stdout) ?? { stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) }
  doctorCache = { at: Date.now(), value }
  return value
}

export function serverInfo() {
  return {
    name: 'hyperframes-startos',
    serverVersion: config.version,
    hyperframesVersion: config.hyperframesVersion,
    apiUrls: config.apiUrls,
    mcpPath: config.mcpPath,
    studioUrls: config.studioUrls,
    projectsDir: config.projectsDir,
    limits: {
      maxConcurrentRenders: config.maxConcurrentRenders,
      renderWorkers: config.renderWorkers,
    },
    docs: {
      openapi: '/openapi.json',
      skills: '/skills/',
      upstream: 'https://hyperframes.heygen.com/introduction',
    },
  }
}

function textArg(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || value.includes('\0')) throw badRequest(`${name} must be a non-empty string up to 500 characters`)
  return value
}

function rangeArg(value: [number, number]): string {
  if (!Array.isArray(value) || value.length !== 2) throw badRequest('range must be [start, end] in seconds')
  const parts = value.map(numArg)
  if (value[0] >= value[1]) throw badRequest('range start must be less than end')
  return parts.join(',')
}

function numArg(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 86_400) throw badRequest('timestamps must be non-negative seconds')
  return String(n)
}

function intArg(n: number, min: number, max: number): number {
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`value must be an integer between ${min} and ${max}`)
  return n
}
