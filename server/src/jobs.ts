import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.js'
import { requireProject } from './projects.js'
import { runCli } from './util/cli.js'
import { badRequest, notFound } from './util/errors.js'

export const renderFormats = ['mp4', 'webm', 'mov', 'gif', 'png-sequence', 'hls'] as const
export type RenderFormat = (typeof renderFormats)[number]
export const renderQualities = ['draft', 'looks', 'delivery', 'standard', 'high'] as const
export type RenderQuality = (typeof renderQualities)[number]
export const renderResolutions = [
  'landscape',
  'portrait',
  'landscape-4k',
  'portrait-4k',
  'square',
  'square-4k',
  '1080p',
  '4k',
] as const

export type RenderRequest = {
  project: string
  format?: RenderFormat
  fps?: number | string
  quality?: RenderQuality
  composition?: string
  /** Output name without extension; defaults to `<project>_<timestamp>`. */
  outputName?: string
  resolution?: (typeof renderResolutions)[number]
  variables?: Record<string, unknown>
  workers?: number | 'auto'
  strict?: boolean
  gifLoop?: number
  extraArgs?: string[]
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export type RenderJob = {
  id: string
  project: string
  status: JobStatus
  request: RenderRequest
  args: string[]
  /** Project-relative output path (a file, or a directory for png-sequence and hls). */
  output: string
  outputIsDirectory: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  error: string | null
  /** Last lines of the CLI output; the full log is on disk. */
  logTail: string
  outputSize: number | null
}

const extByFormat: Record<RenderFormat, string> = {
  mp4: 'mp4',
  webm: 'webm',
  mov: 'mov',
  gif: 'gif',
  'png-sequence': '',
  hls: '',
}

const jobs = new Map<string, RenderJob>()
const killers = new Map<string, (signal?: NodeJS.Signals) => void>()
let running = 0
const queue: string[] = []
const LOG_TAIL = 16 * 1024

function jobsDir(): string {
  return join(config.stateDir, 'jobs')
}

async function persist(job: RenderJob): Promise<void> {
  await mkdir(jobsDir(), { recursive: true })
  const tmp = join(jobsDir(), `${job.id}.json.tmp`)
  await writeFile(tmp, JSON.stringify(job, null, 2))
  const { rename } = await import('node:fs/promises')
  await rename(tmp, join(jobsDir(), `${job.id}.json`))
}

/** Load jobs left by a previous process; anything that was running is now interrupted. */
export async function loadJobs(): Promise<void> {
  await mkdir(jobsDir(), { recursive: true })
  const files = await readdir(jobsDir())
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const job = JSON.parse(await readFile(join(jobsDir(), f), 'utf8')) as RenderJob
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'interrupted'
        job.finishedAt = new Date().toISOString()
        job.error = 'the service restarted while this job was active'
        await persist(job)
      }
      jobs.set(job.id, job)
    } catch {
      /* skip a corrupt record */
    }
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')
}

export function buildRenderArgs(req: RenderRequest, projectDir: string): { args: string[]; output: string; isDir: boolean } {
  const format = req.format ?? 'mp4'
  if (!renderFormats.includes(format)) throw badRequest(`format must be one of ${renderFormats.join(', ')}`)
  const quality = req.quality ?? 'looks'
  if (!renderQualities.includes(quality)) throw badRequest(`quality must be one of ${renderQualities.join(', ')}`)
  const name = req.outputName ?? `${req.project}_${timestamp()}`
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) || name.includes('..')) {
    throw badRequest('outputName may only contain letters, digits, ".", "_" and "-"')
  }
  const ext = extByFormat[format]
  const isDir = ext === ''
  const output = isDir ? `renders/${name}` : `renders/${name}.${ext}`
  const args = ['render', projectDir, '--output', join(projectDir, output), '--format', format, '--quality', quality]
  if (req.fps !== undefined) {
    const fps = String(req.fps)
    if (!/^\d{1,6}(\/\d{1,6})?$/.test(fps)) throw badRequest('fps must be an integer or a rational like 30000/1001')
    const [num, den = 1] = fps.split('/').map(Number)
    if (den === 0 || num / den < 1 || num / den > 240) throw badRequest('fps must be in the range 1-240 with a nonzero denominator')
    args.push('--fps', fps)
  }
  if (req.composition) {
    if (req.composition.includes('..') || req.composition.startsWith('/')) throw badRequest('composition must be a project-relative path')
    args.push('--composition', req.composition)
  }
  if (req.resolution) {
    if (!renderResolutions.includes(req.resolution)) throw badRequest(`resolution must be one of ${renderResolutions.join(', ')}`)
    args.push('--resolution', req.resolution)
  }
  if (req.variables && Object.keys(req.variables).length > 0) {
    args.push('--variables', JSON.stringify(req.variables))
  }
  const workers = req.workers ?? (config.renderWorkers === 'auto' ? undefined : Number(config.renderWorkers))
  if (workers !== undefined && workers !== 'auto') {
    const n = Number(workers)
    if (!Number.isInteger(n) || n < 1 || n > 24) throw badRequest('workers must be 1-24 or "auto"')
    args.push('--workers', String(n))
  }
  if (req.strict) args.push('--strict')
  if (req.gifLoop !== undefined) {
    if (!Number.isInteger(req.gifLoop) || req.gifLoop < 0 || req.gifLoop > 65535) throw badRequest('gifLoop must be 0-65535')
    args.push('--gif-loop', String(req.gifLoop))
  }
  for (const extra of req.extraArgs ?? []) {
    if (typeof extra !== 'string' || !extra.startsWith('--') || extra.includes('\0')) {
      throw badRequest('extraArgs must be "--flag" or "--flag=value" strings')
    }
    if (extra === '--docker' || extra.startsWith('--docker=') || extra.startsWith('--output') || extra.startsWith('-o') || /^--(?:batch|variables-file)(?:=|$)/.test(extra)) throw badRequest(`${extra} is not allowed`)
    args.push(extra)
  }
  args.push('--quiet')
  return { args, output, isDir }
}

export async function submitRender(req: RenderRequest): Promise<RenderJob> {
  const dir = await requireProject(req.project)
  const { args, output, isDir } = buildRenderArgs(req, dir)
  const job: RenderJob = {
    id: randomUUID(),
    project: req.project,
    status: 'queued',
    request: req,
    args,
    output,
    outputIsDirectory: isDir,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    logTail: '',
    outputSize: null,
  }
  jobs.set(job.id, job)
  await persist(job)
  queue.push(job.id)
  void pump()
  return job
}

async function pump(): Promise<void> {
  while (running < config.maxConcurrentRenders && queue.length > 0) {
    const id = queue.shift()
    if (!id) return
    const job = jobs.get(id)
    if (!job || job.status !== 'queued') continue
    running++
    void execute(job).finally(() => {
      running--
      void pump()
    })
  }
}

async function execute(job: RenderJob): Promise<void> {
  const dir = join(config.projectsDir, job.project)
  const logPath = join(jobsDir(), `${job.id}.log`)
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  await persist(job)
  await writeFile(logPath, `$ hyperframes ${job.args.join(' ')}\n`)
  let pending = ''
  let flushTimer: NodeJS.Timeout | null = null
  const flush = async () => {
    const chunk = pending
    pending = ''
    if (chunk) await appendFile(logPath, chunk).catch(() => {})
  }
  try {
    const result = await runCli(job.args, {
      cwd: dir,
      timeoutMs: 6 * 60 * 60_000,
      onSpawn: (kill) => killers.set(job.id, kill),
      onOutput: (chunk) => {
        pending += chunk
        job.logTail = (job.logTail + chunk).slice(-LOG_TAIL)
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null
            void flush()
          }, 500)
        }
      },
    })
    if (flushTimer) clearTimeout(flushTimer)
    await flush()
    job.exitCode = result.exitCode
    job.finishedAt = new Date().toISOString()
    if (job.status === ('cancelled' as JobStatus)) {
      // cancelRender already recorded the outcome
    } else if (result.timedOut) {
      job.status = 'failed'
      job.error = 'render timed out'
    } else if (result.exitCode === 0) {
      const s = await stat(join(dir, job.output)).catch(() => null)
      if (s) {
        job.status = 'succeeded'
        job.outputSize = s.isFile() ? s.size : null
      } else {
        job.status = 'failed'
        job.error = 'the CLI exited 0 but produced no output'
      }
    } else {
      job.status = 'failed'
      job.error = lastErrorLine(job.logTail) ?? `hyperframes render exited ${result.exitCode}`
    }
  } catch (err) {
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.error = err instanceof Error ? err.message : String(err)
  } finally {
    killers.delete(job.id)
    await persist(job)
  }
}

function lastErrorLine(log: string): string | null {
  const lines = log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const failed = lines.findIndex((l) => l.includes('Render failed'))
  if (failed >= 0) return lines.slice(failed, failed + 4).join(' ')
  return lines.at(-1) ?? null
}

export function getJob(id: string): RenderJob {
  const job = jobs.get(id)
  if (!job) throw notFound(`render job "${id}" not found`)
  return job
}

export function listJobs(project?: string): RenderJob[] {
  return [...jobs.values()]
    .filter((j) => !project || j.project === project)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function cancelRender(id: string): Promise<RenderJob> {
  const job = getJob(id)
  if (job.status === 'queued') {
    const i = queue.indexOf(id)
    if (i >= 0) queue.splice(i, 1)
    job.status = 'cancelled'
    job.finishedAt = new Date().toISOString()
    await persist(job)
    return job
  }
  if (job.status === 'running') {
    job.status = 'cancelled'
    job.error = 'cancelled by request'
    killers.get(id)?.('SIGTERM')
    setTimeout(() => killers.get(id)?.('SIGKILL'), 10_000).unref()
    await persist(job)
  }
  return job
}

export async function jobLog(id: string): Promise<string> {
  getJob(id)
  return readFile(join(jobsDir(), `${id}.log`), 'utf8').catch(() => '')
}
