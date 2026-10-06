import { resolve } from 'node:path'

function list(json: string | undefined): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const config = {
  port: int(process.env.PORT, 3100, 1, 65535),
  /** Bearer token. Empty means "not configured": every authenticated route answers 503. */
  apiKey: process.env.HF_API_KEY ?? '',
  projectsDir: resolve(process.env.HYPERFRAMES_PROJECTS_DIR ?? '/data/projects'),
  stateDir: resolve(process.env.HF_STATE_DIR ?? '/data/startos'),
  studioFile: resolve(process.env.HF_STUDIO_FILE ?? '/data/startos/studio.json'),
  studioPort: int(process.env.HF_STUDIO_PORT, 3002, 1, 65535),
  /** Public Studio addresses, as StartOS reports them; the first is used in links. */
  studioUrls: list(process.env.HF_STUDIO_URLS),
  apiUrls: list(process.env.HF_API_URLS),
  mcpPath: process.env.HF_MCP_PATH ?? '/mcp',
  cli: process.env.HF_CLI ?? 'hyperframes',
  renderWorkers: process.env.HF_RENDER_WORKERS ?? 'auto',
  maxConcurrentRenders: int(process.env.HF_MAX_CONCURRENT_RENDERS, 1, 1, 8),
  /** Colon-separated directories that hold `<skill>/SKILL.md` trees. */
  skillsDirs: (process.env.HF_SKILLS_DIRS ?? '/opt/hyperframes/skills:/opt/hyperframes-startos/skills')
    .split(':')
    .filter(Boolean)
    .map((d) => resolve(d)),
  version: process.env.HF_SERVER_VERSION ?? '0.1.0',
  hyperframesVersion: process.env.HYPERFRAMES_VERSION ?? 'unknown',
} as const

export type Config = typeof config
