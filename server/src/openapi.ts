import { renderFormats, renderQualities, renderResolutions } from './jobs.js'
import { resolutions } from './projects.js'
import { allowedCliCommands } from './util/cli.js'

const projectParam = {
  name: 'project',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
}

const json = (schema: unknown) => ({ 'application/json': { schema } })
const ok = (schema: unknown = { type: 'object' }) => ({ '200': { description: 'OK', content: json(schema) } })

/** Hand-written OpenAPI 3.1 description of the REST surface, served at /openapi.json. */
export function openapi(serverUrls: string[]) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'HyperFrames on StartOS: agent API',
      version: '1',
      description:
        'Create HyperFrames projects, write compositions, lint and check them, capture frames and render video on this server. Every route except /health needs `Authorization: Bearer <api key>`. The same operations are exposed as MCP tools at the MCP path.',
    },
    servers: serverUrls.map((url) => ({ url })),
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' }, details: {} }, required: ['error'] },
        Project: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            title: { type: ['string', 'null'] },
            width: { type: ['number', 'null'] },
            height: { type: ['number', 'null'] },
            duration: { type: ['number', 'null'] },
            fps: { type: ['number', 'null'] },
            compositions: { type: 'array', items: { type: 'string' } },
            renders: { type: 'array', items: { type: 'string' } },
            updatedAt: { type: 'string' },
          },
        },
        FileEntry: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            type: { type: 'string', enum: ['file', 'directory'] },
            size: { type: 'integer' },
            modifiedAt: { type: 'string' },
          },
        },
        RenderRequest: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: [...renderFormats] },
            fps: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
            quality: { type: 'string', enum: [...renderQualities] },
            composition: { type: 'string' },
            outputName: { type: 'string' },
            resolution: { type: 'string', enum: [...renderResolutions] },
            variables: { type: 'object' },
            workers: { oneOf: [{ type: 'integer' }, { const: 'auto' }] },
            strict: { type: 'boolean' },
            gifLoop: { type: 'integer' },
          },
        },
        RenderJob: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            project: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] },
            output: { type: 'string' },
            outputIsDirectory: { type: 'boolean' },
            createdAt: { type: 'string' },
            startedAt: { type: ['string', 'null'] },
            finishedAt: { type: ['string', 'null'] },
            exitCode: { type: ['integer', 'null'] },
            error: { type: ['string', 'null'] },
            logTail: { type: 'string' },
            downloadPath: { type: ['string', 'null'] },
          },
        },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      '/health': { get: { security: [], summary: 'Liveness; says whether an API key is configured', responses: ok() } },
      '/api/v1/server': { get: { summary: 'Server info: versions, URLs, limits', responses: ok() } },
      '/api/v1/doctor': { get: { summary: 'hyperframes doctor --json (cached 5 min)', responses: ok() } },
      '/api/v1/projects': {
        get: { summary: 'List projects', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/Project' } }) },
        post: {
          summary: 'Create a project with hyperframes init',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                resolution: { type: 'string', enum: [...resolutions] },
                example: { type: 'string' },
                tailwind: { type: 'boolean' },
              },
            }),
          },
          responses: { '201': { description: 'Created', content: json({ $ref: '#/components/schemas/Project' }) } },
        },
      },
      '/api/v1/projects/import': {
        post: {
          summary: 'Import a directory of a public GitHub repository as a project (LFS media included)',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['name', 'repo'],
              properties: { name: { type: 'string' }, repo: { type: 'string', example: 'heygen-com/hyperframes-launches' }, path: { type: 'string', example: 'heygen-apple-motion/01-ui-sting' }, ref: { type: 'string', default: 'main' } },
            }),
          },
          responses: { '201': { description: 'Imported', content: json({ $ref: '#/components/schemas/Project' }) } },
        },
      },
      '/api/v1/projects/{project}': {
        parameters: [projectParam],
        get: { summary: 'Project summary plus file tree and Studio status', responses: ok() },
        delete: { summary: 'Delete the project', responses: { '204': { description: 'Deleted' } } },
      },
      '/api/v1/projects/{project}/files': {
        parameters: [projectParam, { name: 'path', in: 'query', schema: { type: 'string' } }],
        get: { summary: 'Recursive listing', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/FileEntry' } }) },
      },
      '/api/v1/projects/{project}/files/{path}': {
        parameters: [projectParam, { name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          summary: 'Download a file (raw bytes). Add ?json=1 for {content, encoding, mime}.',
          responses: { '200': { description: 'File bytes' } },
        },
        put: {
          summary: 'Create or overwrite a file. Body is raw bytes, or JSON {content, encoding: "utf8"|"base64"} with Content-Type application/json.',
          responses: ok({ $ref: '#/components/schemas/FileEntry' }),
        },
        delete: { summary: 'Delete a file or directory', responses: { '204': { description: 'Deleted' } } },
      },
      '/api/v1/projects/{project}/upload': {
        parameters: [projectParam],
        post: {
          summary: 'Multipart upload: field `file` and field `path` (destination)',
          responses: ok({ $ref: '#/components/schemas/FileEntry' }),
        },
      },
      '/api/v1/projects/{project}/fetch': {
        parameters: [projectParam],
        post: {
          summary: 'Download a public http(s) URL into the project (private, loopback and link-local targets are refused, redirects included; 512 MiB limit)',
          requestBody: { required: true, content: json({ type: 'object', required: ['url', 'path'], properties: { url: { type: 'string' }, path: { type: 'string' } } }) },
          responses: ok({ $ref: '#/components/schemas/FileEntry' }),
        },
      },
      '/api/v1/projects/{project}/lint': { parameters: [projectParam], post: { summary: 'hyperframes lint --json', responses: ok() } },
      '/api/v1/projects/{project}/check': {
        parameters: [projectParam],
        post: {
          summary: 'hyperframes check --json',
          requestBody: { content: json({ type: 'object', properties: { snapshots: { type: 'boolean' }, at: { type: 'array', items: { type: 'number' } }, samples: { type: 'integer' }, strict: { type: 'boolean' }, contrast: { type: 'boolean' }, atTransitions: { type: 'boolean' }, range: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, components: { type: 'string', maxLength: 500 }, maxTransitionSamples: { type: 'integer', minimum: 1, maximum: 10000 }, maxIssues: { type: 'integer', minimum: 1, maximum: 1000 }, collapseStatic: { type: 'boolean' } } }) },
          responses: ok(),
        },
      },
      '/api/v1/projects/{project}/snapshot': {
        parameters: [projectParam],
        post: {
          summary: 'Capture PNGs or a review set (beats, seams, phone sheets) into snapshots/; returns upstream JSON metadata, with provider descriptions disabled',
          requestBody: { content: json({ type: 'object', properties: { at: { type: 'array', items: { type: 'number' } }, frames: { type: 'integer' }, zoom: { type: 'string' }, end: { type: 'boolean' }, review: { type: 'boolean' }, range: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, composition: { type: 'string', maxLength: 500 } } }) },
          responses: ok(),
        },
      },
      '/api/v1/projects/{project}/timeline': { parameters: [projectParam], get: { summary: 'hyperframes timeline --json', responses: ok() } },
      '/api/v1/projects/{project}/info': { parameters: [projectParam], get: { summary: 'hyperframes info --json', responses: ok() } },
      '/api/v1/projects/{project}/catalog/add': {
        parameters: [projectParam],
        post: { summary: 'hyperframes add <name> [--vars json] [--force]', requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, vars: { type: 'object' }, force: { type: 'boolean' } } }) }, responses: ok() },
      },
      '/api/v1/projects/{project}/renders': {
        parameters: [projectParam],
        get: { summary: 'Render jobs for this project', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/RenderJob' } }) },
        post: {
          summary: 'Queue a render; returns the job immediately',
          requestBody: { content: json({ $ref: '#/components/schemas/RenderRequest' }) },
          responses: { '202': { description: 'Queued', content: json({ $ref: '#/components/schemas/RenderJob' }) } },
        },
      },
      '/api/v1/catalog/{name}': {
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['block', 'component', 'example'] } },
        ],
        get: { summary: 'One registry item manifest: variables, files, canvas, tags', responses: ok() },
      },
      '/api/v1/catalog': {
        parameters: [
          { name: 'query', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['block', 'component'] } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
        ],
        get: { summary: 'hyperframes catalog --json', responses: ok() },
      },
      '/api/v1/renders': { get: { summary: 'All render jobs, newest first', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/RenderJob' } }) } },
      '/api/v1/renders/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { summary: 'Render job status (add ?log=1 for the full log)', responses: ok({ $ref: '#/components/schemas/RenderJob' }) },
        delete: { summary: 'Cancel the job', responses: ok({ $ref: '#/components/schemas/RenderJob' }) },
      },
      '/api/v1/renders/{id}/download': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { summary: 'Download the finished file', responses: { '200': { description: 'Video bytes' } } },
      },
      '/api/v1/studio': {
        get: { summary: 'Which project Studio serves and its URLs', responses: ok() },
        post: { summary: 'Switch Studio to a project', requestBody: { required: true, content: json({ type: 'object', required: ['project'], properties: { project: { type: 'string' } } }) }, responses: ok() },
      },
      '/api/v1/cli': {
        post: {
          summary: `Run an allowed hyperframes subcommand (${[...allowedCliCommands].sort().join(', ')})`,
          requestBody: { required: true, content: json({ type: 'object', required: ['args'], properties: { project: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, timeoutMs: { type: 'integer' } } }) },
          responses: ok(),
        },
      },
      '/api/v1/skills': { get: { summary: 'Skills library catalog', responses: ok() } },
      '/api/v1/skills/{skill}': {
        parameters: [{ name: 'skill', in: 'path', required: true, schema: { type: 'string' } }],
        get: { summary: 'Files of one skill', responses: ok() },
      },
      '/skills/{skill}/{path}': {
        parameters: [
          { name: 'skill', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'path', in: 'path', required: true, schema: { type: 'string' } },
        ],
        get: { summary: 'Raw skill file (SKILL.md, references, scripts)', responses: { '200': { description: 'File' } } },
      },
    },
  }
}
