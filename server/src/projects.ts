import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.js'
import { parseJsonOutput, runCli } from './util/cli.js'
import { ApiError, badRequest, conflict, notFound } from './util/errors.js'
import { assertProjectName } from './util/paths.js'

export type ProjectSummary = {
  name: string
  path: string
  title: string | null
  width: number | null
  height: number | null
  duration: number | null
  fps: number | null
  compositions: string[]
  renders: string[]
  updatedAt: string
}

export const resolutions = [
  'landscape',
  'portrait',
  'landscape-4k',
  'portrait-4k',
  'square',
  'square-4k',
] as const
export type Resolution = (typeof resolutions)[number]

export function projectDir(name: string): string {
  return join(config.projectsDir, assertProjectName(name))
}

export async function projectExists(name: string): Promise<boolean> {
  try {
    const s = await stat(join(projectDir(name), 'index.html'))
    return s.isFile()
  } catch {
    return false
  }
}

export async function requireProject(name: string): Promise<string> {
  const dir = projectDir(name)
  if (!(await projectExists(name))) throw notFound(`project "${name}" not found`)
  return dir
}

function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : null
}

function num(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function listHtml(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'renders') continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listHtml(join(dir, e.name), rel)))
    else if (e.isFile() && e.name.endsWith('.html')) out.push(rel)
  }
  return out.sort()
}

export async function summarize(name: string): Promise<ProjectSummary> {
  const dir = await requireProject(name)
  const html = await readFile(join(dir, 'index.html'), 'utf8').catch(() => '')
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() || null
  const compositions = (await listHtml(dir)).filter((f) => f !== 'index.html')
  const renders = (await readdir(join(dir, 'renders')).catch(() => []))
    .filter((f) => !f.startsWith('.'))
    .sort()
  const s = await stat(dir)
  return {
    name,
    path: dir,
    title,
    width: num(attr(html, 'data-width')),
    height: num(attr(html, 'data-height')),
    duration: num(attr(html, 'data-duration')),
    fps: num(attr(html, 'data-fps')),
    compositions,
    renders,
    updatedAt: s.mtime.toISOString(),
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(config.projectsDir, { recursive: true })
  const entries = await readdir(config.projectsDir, { withFileTypes: true })
  const names = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
  const out: ProjectSummary[] = []
  for (const n of names) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(n)) continue
    if (await projectExists(n)) out.push(await summarize(n))
  }
  return out
}

export type CreateProjectOptions = {
  name: string
  resolution?: Resolution
  /** A registry example name, e.g. `warm-grain`. Needs network access to GitHub. */
  example?: string
  tailwind?: boolean
}

export async function createProject(options: CreateProjectOptions): Promise<ProjectSummary> {
  const name = assertProjectName(options.name)
  await mkdir(config.projectsDir, { recursive: true })
  const dir = projectDir(name)
  const exists = await stat(dir).then(() => true, () => false)
  if (exists) throw conflict(`project "${name}" already exists`)
  if (options.example !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.example)) {
    throw badRequest('example must be a registry example name')
  }
  const args = ['init', dir, '--non-interactive']
  if (options.resolution) args.push('--resolution', options.resolution)
  if (options.example) args.push('--example', options.example)
  if (options.tailwind) args.push('--tailwind')
  const result = await runCli(args, {
    cwd: config.projectsDir,
    timeoutMs: 5 * 60_000,
    env: { HYPERFRAMES_SKIP_SKILLS: '1' },
  })
  if (result.exitCode !== 0) {
    await rm(dir, { recursive: true, force: true })
    throw new ApiError(500, 'hyperframes init failed', {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-4000),
      stdout: result.stdout.slice(-4000),
    })
  }
  return summarize(name)
}

export async function deleteProject(name: string): Promise<void> {
  const dir = await requireProject(name)
  await rm(dir, { recursive: true, force: true })
}

/** `hyperframes info --json`, `timeline --json` and friends, scoped to one project. */
export async function projectJson(name: string, args: string[], timeoutMs = 120_000): Promise<unknown> {
  const dir = await requireProject(name)
  const result = await runCli([...args, '--json'], { cwd: dir, timeoutMs })
  const parsed = parseJsonOutput(result.stdout)
  if (parsed === null && result.exitCode !== 0) {
    throw new ApiError(500, `hyperframes ${args[0]} failed`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-4000),
      stdout: result.stdout.slice(-4000),
    })
  }
  return parsed ?? { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}
