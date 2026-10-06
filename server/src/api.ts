import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { stream } from 'hono/streaming'
import { config } from './config.js'
import {
  absoluteFile,
  deleteProjectPath,
  fetchIntoProject,
  listFiles,
  readProjectFile,
  streamFile,
  writeProjectFile,
} from './files.js'
import { cancelRender, getJob, jobLog, listJobs, submitRender, type RenderJob, type RenderRequest } from './jobs.js'
import {
  catalogAdd,
  catalogSearch,
  checkProject,
  doctor,
  lintProject,
  runAllowedCli,
  serverInfo,
  snapshotProject,
} from './ops.js'
import { openapi } from './openapi.js'
import { createProject, deleteProject, listProjects, projectJson, summarize } from './projects.js'
import { listSkills, readSkillFile, skillFiles } from './skills.js'
import { openInStudio, studioStatus } from './studio.js'
import { ApiError } from './util/errors.js'
import { mimeFor } from './files.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from './mcp.js'

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function requireBearer(c: Context, next: Next) {
  if (!config.apiKey) {
    return c.json(
      { error: 'no API key is configured; run the "Set API Key" action in StartOS first' },
      503,
    )
  }
  const header = c.req.header('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match || !constantTimeEqual(match[1].trim(), config.apiKey)) {
    c.header('WWW-Authenticate', 'Bearer realm="HyperFrames API"')
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

function jobView(job: RenderJob) {
  return {
    ...job,
    downloadPath: job.status === 'succeeded' && !job.outputIsDirectory ? `/api/v1/renders/${job.id}/download` : null,
    outputFilePath: job.status === 'succeeded' ? `/api/v1/projects/${job.project}/files/${job.output}` : null,
  }
}

async function body<T>(c: Context): Promise<T> {
  const text = await c.req.text()
  if (!text.trim()) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(400, 'request body must be JSON')
  }
}

export function createApp(): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, details: err.details ?? null }, err.status as 400)
    console.error(err)
    return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500)
  })

  app.get('/health', (c) =>
    c.json({ ok: true, service: 'hyperframes-startos', version: config.version, apiKeyConfigured: Boolean(config.apiKey) }),
  )

  app.get('/', requireBearer, (c) => c.json({ ...serverInfo(), endpoints: { api: '/api/v1', mcp: config.mcpPath, openapi: '/openapi.json', skills: '/skills/' } }))
  app.get('/openapi.json', requireBearer, (c) => c.json(openapi(config.apiUrls)))

  // ── MCP (streamable HTTP, stateless) ───────────────────────────────────
  app.all(config.mcpPath, requireBearer, async (c) => {
    const server = createMcpServer()
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      // Close after the response body has been delivered.
      c.req.raw.signal.addEventListener('abort', () => void transport.close())
      setTimeout(() => void transport.close().then(() => server.close()), 60_000).unref()
    }
  })

  const api = new Hono()
  api.use('*', requireBearer)

  api.get('/server', (c) => c.json(serverInfo()))
  api.get('/doctor', async (c) => c.json(await doctor()))

  api.get('/projects', async (c) => c.json(await listProjects()))
  api.post('/projects', async (c) => {
    const input = await body<{ name: string; resolution?: never; example?: string; tailwind?: boolean }>(c)
    if (typeof input.name !== 'string') throw new ApiError(400, 'name is required')
    return c.json(await createProject(input), 201)
  })
  api.get('/projects/:project', async (c) => {
    const name = c.req.param('project')
    return c.json({ ...(await summarize(name)), files: await listFiles(name), studio: await studioStatus() })
  })
  api.delete('/projects/:project', async (c) => {
    await deleteProject(c.req.param('project'))
    return c.body(null, 204)
  })

  api.get('/projects/:project/files', async (c) => c.json(await listFiles(c.req.param('project'), c.req.query('path') ?? '')))
  api.get('/projects/:project/files/*', async (c) => {
    const name = c.req.param('project')
    const path = decodeURIComponent(c.req.path.split(`/projects/${name}/files/`)[1] ?? '')
    if (c.req.query('json')) return c.json(await readProjectFile(name, path))
    const f = await absoluteFile(name, path)
    c.header('Content-Type', f.mime)
    c.header('Content-Length', String(f.size))
    c.header('Content-Disposition', `inline; filename="${encodeURIComponent(path.split('/').pop() ?? 'file')}"`)
    return stream(c, async (s) => {
      await s.pipe(Readable.toWeb(streamFile(f.abs)) as ReadableStream)
    })
  })
  api.put('/projects/:project/files/*', async (c) => {
    const name = c.req.param('project')
    const path = decodeURIComponent(c.req.path.split(`/projects/${name}/files/`)[1] ?? '')
    const type = c.req.header('content-type') ?? ''
    if (type.includes('application/json')) {
      const input = await body<{ content?: string; encoding?: 'utf8' | 'base64' }>(c)
      if (typeof input.content !== 'string') throw new ApiError(400, 'content is required')
      const data = input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : input.content
      return c.json(await writeProjectFile(name, path, data))
    }
    const bytes = Buffer.from(await c.req.arrayBuffer())
    return c.json(await writeProjectFile(name, path, bytes))
  })
  api.delete('/projects/:project/files/*', async (c) => {
    const name = c.req.param('project')
    const path = decodeURIComponent(c.req.path.split(`/projects/${name}/files/`)[1] ?? '')
    await deleteProjectPath(name, path)
    return c.body(null, 204)
  })
  api.post('/projects/:project/upload', async (c) => {
    const name = c.req.param('project')
    const form = await c.req.formData()
    const file = form.get('file')
    const path = form.get('path')
    if (!(file instanceof File)) throw new ApiError(400, 'multipart field "file" is required')
    const dest = typeof path === 'string' && path ? path : `assets/${file.name}`
    return c.json(await writeProjectFile(name, dest, Buffer.from(await file.arrayBuffer())))
  })
  api.post('/projects/:project/fetch', async (c) => {
    const input = await body<{ url: string; path: string }>(c)
    if (typeof input.url !== 'string' || typeof input.path !== 'string') throw new ApiError(400, 'url and path are required')
    return c.json(await fetchIntoProject(c.req.param('project'), input.url, input.path))
  })

  api.post('/projects/:project/lint', async (c) => {
    const input = await body<{ verbose?: boolean }>(c)
    return c.json(await lintProject(c.req.param('project'), input.verbose))
  })
  api.post('/projects/:project/check', async (c) => c.json(await checkProject(c.req.param('project'), await body(c))))
  api.post('/projects/:project/snapshot', async (c) => c.json(await snapshotProject(c.req.param('project'), { ...(await body(c)), describe: false })))
  api.get('/projects/:project/timeline', async (c) => c.json(await projectJson(c.req.param('project'), ['timeline'])))
  api.get('/projects/:project/info', async (c) => c.json(await projectJson(c.req.param('project'), ['info'])))
  api.post('/projects/:project/catalog/add', async (c) => {
    const input = await body<{ name: string }>(c)
    if (typeof input.name !== 'string') throw new ApiError(400, 'name is required')
    return c.json(await catalogAdd(c.req.param('project'), input.name))
  })
  api.get('/catalog', async (c) =>
    c.json(
      await catalogSearch({
        query: c.req.query('query') ?? undefined,
        type: (c.req.query('type') as 'block' | 'component' | undefined) ?? undefined,
        tag: c.req.query('tag') ?? undefined,
      }),
    ),
  )

  api.get('/projects/:project/renders', (c) => c.json(listJobs(c.req.param('project')).map(jobView)))
  api.post('/projects/:project/renders', async (c) => {
    const input = await body<Omit<RenderRequest, 'project'>>(c)
    return c.json(jobView(await submitRender({ ...input, project: c.req.param('project') })), 202)
  })
  api.get('/renders', (c) => c.json(listJobs(c.req.query('project') ?? undefined).map(jobView)))
  api.get('/renders/:id', async (c) => {
    const job = getJob(c.req.param('id'))
    return c.json({ ...jobView(job), ...(c.req.query('log') ? { log: await jobLog(job.id) } : {}) })
  })
  api.delete('/renders/:id', async (c) => c.json(jobView(await cancelRender(c.req.param('id')))))
  api.get('/renders/:id/download', async (c) => {
    const job = getJob(c.req.param('id'))
    if (job.status !== 'succeeded') throw new ApiError(409, `job is ${job.status}`)
    if (job.outputIsDirectory) throw new ApiError(409, 'this render produced a directory; list it over the files route')
    const f = await absoluteFile(job.project, job.output)
    c.header('Content-Type', f.mime)
    c.header('Content-Length', String(f.size))
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(job.output.split('/').pop() ?? 'render')}"`)
    return stream(c, async (s) => {
      await s.pipe(Readable.toWeb(streamFile(f.abs)) as ReadableStream)
    })
  })

  api.get('/studio', async (c) => c.json(await studioStatus()))
  api.post('/studio', async (c) => {
    const input = await body<{ project: string }>(c)
    if (typeof input.project !== 'string') throw new ApiError(400, 'project is required')
    return c.json(await openInStudio(input.project))
  })

  api.post('/cli', async (c) => {
    const input = await body<{ project?: string; args: string[]; timeoutMs?: number }>(c)
    return c.json(await runAllowedCli(input.project, input.args, input.timeoutMs))
  })

  api.get('/skills', async (c) => c.json(await listSkills()))
  api.get('/skills/:skill', async (c) => c.json({ skill: c.req.param('skill'), files: await skillFiles(c.req.param('skill')) }))

  app.route('/api/v1', api)

  // Raw skill files, so an agent can `curl` a SKILL.md or a reference.
  app.get('/skills', requireBearer, async (c) => c.json(await listSkills()))
  app.get('/skills/', requireBearer, async (c) => c.json(await listSkills()))
  app.get('/skills/:skill/*', requireBearer, async (c) => {
    const skill = c.req.param('skill') ?? ''
    const path = decodeURIComponent(c.req.path.split(`/skills/${skill}/`)[1] ?? '') || 'SKILL.md'
    const f = await readSkillFile(skill, path)
    const bytes = await readFile(f.abs)
    c.header('Content-Type', path.endsWith('.md') ? 'text/markdown; charset=utf-8' : mimeFor(path))
    return c.body(bytes)
  })

  return app
}
