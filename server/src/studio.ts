import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { config } from './config.js'
import { requireProject } from './projects.js'

export type StudioStatus = {
  /** Project the Studio daemon is configured to serve (what the API or action asked for). */
  configuredProject: string | null
  /** Project Studio currently reports serving, or null when Studio is not reachable yet. */
  servingProject: string | null
  reachable: boolean
  version: string | null
  urls: string[]
  /** Deep links for the serving project (Studio opens `#project/<name>`). */
  projectUrls: string[]
}

export async function readConfiguredProject(): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(config.studioFile, 'utf8')) as { project?: unknown }
    return typeof parsed.project === 'string' && parsed.project ? parsed.project : null
  } catch {
    return null
  }
}

/**
 * Point Studio at a project. The StartOS package watches this file and
 * restarts only the Studio daemon, so a render in progress is unaffected.
 */
export async function openInStudio(project: string): Promise<StudioStatus> {
  await requireProject(project)
  await mkdir(dirname(config.studioFile), { recursive: true })
  const tmp = `${config.studioFile}.tmp`
  await writeFile(tmp, JSON.stringify({ project }, null, 2) + '\n')
  await rename(tmp, config.studioFile)
  return studioStatus()
}

export function studioProjectUrls(project: string | null): string[] {
  if (!project) return config.studioUrls
  return config.studioUrls.map((u) => `${u.replace(/\/$/, '')}/#project/${encodeURIComponent(project)}`)
}

export async function studioStatus(): Promise<StudioStatus> {
  const configuredProject = await readConfiguredProject()
  let servingProject: string | null = null
  let version: string | null = null
  let reachable = false
  try {
    const res = await fetch(`http://127.0.0.1:${config.studioPort}/__hyperframes_config`, {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const body = (await res.json()) as { projectName?: string; version?: string }
      servingProject = body.projectName ?? null
      version = body.version ?? null
      reachable = true
    }
  } catch {
    /* Studio restarting or not up yet */
  }
  return {
    configuredProject,
    servingProject,
    reachable,
    version,
    urls: config.studioUrls,
    projectUrls: studioProjectUrls(servingProject ?? configuredProject),
  }
}
