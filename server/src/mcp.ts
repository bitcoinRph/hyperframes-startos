import { readFile } from 'node:fs/promises'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { config } from './config.js'
import {
  deleteProjectPath,
  fetchIntoProject,
  listFiles,
  readProjectFile,
  writeProjectFile,
} from './files.js'
import {
  cancelRender,
  getJob,
  jobLog,
  listJobs,
  renderFormats,
  renderQualities,
  renderResolutions,
  submitRender,
  type RenderJob,
} from './jobs.js'
import {
  catalogAdd,
  catalogSearch,
  checkProject,
  doctor,
  lintProject,
  readSnapshotPng,
  runAllowedCli,
  serverInfo,
  snapshotProject,
} from './ops.js'
import { createProject, deleteProject, listProjects, projectJson, resolutions, summarize } from './projects.js'
import { catalogItem, catalogItemTypes } from './catalog.js'
import { importProject } from './importer.js'
import { listSkills, readSkillFile, skillFiles } from './skills.js'
import { openInStudio, studioStatus } from './studio.js'
import {
  cancelDub,
  cloneVoice,
  designVoice,
  dubOutputs,
  getDub,
  listDubs,
  listVoices,
  localProviders,
  speak,
  submitDub,
  timingStrategies,
  transcribe,
  voicestudioStatus,
} from './voicestudio.js'
import { allowedCliCommands } from './util/cli.js'
import { ApiError } from './util/errors.js'

function text(value: unknown): CallToolResult {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text', text: body }] }
}

function failure(err: unknown): CallToolResult {
  const message = err instanceof ApiError ? `${err.message}${err.details ? `\n${JSON.stringify(err.details, null, 2)}` : ''}` : err instanceof Error ? err.message : String(err)
  return { isError: true, content: [{ type: 'text', text: message }] }
}

async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (err) {
    return failure(err)
  }
}

function jobView(job: RenderJob) {
  return {
    ...job,
    downloadPath: job.status === 'succeeded' && !job.outputIsDirectory ? `/api/v1/renders/${job.id}/download` : null,
    outputFilePath: job.status === 'succeeded' ? `/api/v1/projects/${job.project}/files/${job.output}` : null,
  }
}

const project = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).describe('Project name (a directory under the projects root)')

/** Build a fresh McpServer; the transport is stateless so one is made per request. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'hyperframes-startos', version: config.version },
    {
      instructions: [
        'HyperFrames on StartOS: write HTML compositions, check them, and render video on this server.',
        'Workflow: list_skills and read_skill("hyperframes-server") first, then create_project, write_file (index.html), lint, check, snapshot, and render_video; poll get_render_status until it succeeds.',
        'Upstream HyperFrames skills are served as resources (hyperframes://skills/<name>/SKILL.md). Their `npx hyperframes <cmd>` instructions map to run_cli or to the dedicated tools here.',
        'Studio (the browser editor) shows one project at a time; studio_open switches it and returns the URL for the user.',
        'Voice: when VoiceStudio is installed on the server, voicestudio_status says so; voicestudio_speak, _transcribe, _clone_voice, _design_voice and _dub write audio straight into the project.',
      ].join('\n'),
    },
  )

  server.registerTool(
    'server_info',
    {
      title: 'Server info',
      description: 'Versions, public URLs, render limits and where the docs live. Call first when unsure how this server is set up.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => text(serverInfo()),
  )

  server.registerTool(
    'doctor',
    {
      title: 'Environment check',
      description: 'Runs `hyperframes doctor --json`: Chrome, FFmpeg, memory, disk and optional tools (whisper, Kokoro). Cached for five minutes.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(await doctor())),
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'All HyperFrames projects on the server with canvas size, duration, compositions and finished renders.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(await listProjects())),
  )

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Scaffold a new project with `hyperframes init` (a centered blank composition with GSAP wired in). Pick a resolution preset for portrait, square or 4K work. `example` starts from a registry example and needs network access.',
      inputSchema: {
        name: project,
        resolution: z.enum(resolutions).optional().describe('Canvas preset; default keeps the template at 1920x1080'),
        example: z.string().optional().describe('Registry example name, e.g. warm-grain'),
        tailwind: z.boolean().optional().describe('Add the Tailwind v4 browser runtime'),
      },
    },
    async (input) => guard(async () => text(await createProject(input))),
  )

  server.registerTool(
    'import_project',
    {
      title: 'Import a project from GitHub',
      description:
        'Copy a directory of a public GitHub repository into a new project: HTML, compositions, assets, fonts and the production documents beside them. Git LFS media is fetched in full. Built for heygen-com/hyperframes-launches: path "heygen-apple-motion/01-ui-sting" imports a re-brandable template; "hyperframes-launch" imports a whole launch film with its STORYBOARD.md and HANDOFF.md. The directory must hold an index.html. Read the project README before changing anything; bundled fonts and logos keep their own licenses.',
      inputSchema: {
        name: project,
        repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).describe('owner/repo'),
        path: z.string().optional().describe('Directory inside the repository; omit for the root'),
        ref: z.string().optional().describe('Branch, tag or commit; default main'),
      },
    },
    async (input) => guard(async () => text(await importProject(input))),
  )

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'Summary of one project plus its file tree (renders and snapshots included).',
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name }) =>
      guard(async () => text({ ...(await summarize(name)), files: await listFiles(name), studio: await studioStatus() })),
  )

  server.registerTool(
    'delete_project',
    {
      title: 'Delete project',
      description: 'Permanently delete a project directory, including its renders. `confirm` must be true.',
      inputSchema: { project, confirm: z.literal(true) },
      annotations: { destructiveHint: true },
    },
    async ({ project: name }) => guard(async () => (await deleteProject(name), text({ deleted: name }))),
  )

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description: 'Recursive file listing of a project (node_modules and .git skipped), optionally under a subdirectory.',
      inputSchema: { project, path: z.string().optional().describe('Subdirectory, relative to the project') },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name, path }) => guard(async () => text(await listFiles(name, path ?? ''))),
  )

  server.registerTool(
    'read_file',
    {
      title: 'Read file',
      description: 'Read a project file. Text files come back as UTF-8, binaries as base64 (up to 4 MB).',
      inputSchema: { project, path: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name, path }) => guard(async () => text(await readProjectFile(name, path))),
  )

  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description:
        'Create or overwrite a project file. Parent directories are created. Use encoding "base64" for binary media. Always run lint after writing a composition.',
      inputSchema: {
        project,
        path: z.string().describe('Project-relative path, e.g. index.html or compositions/intro.html'),
        content: z.string(),
        encoding: z.enum(['utf8', 'base64']).optional(),
      },
    },
    async ({ project: name, path, content, encoding }) =>
      guard(async () =>
        text(await writeProjectFile(name, path, encoding === 'base64' ? Buffer.from(content, 'base64') : content)),
      ),
  )

  server.registerTool(
    'delete_file',
    {
      title: 'Delete file or directory',
      description: 'Remove a file or directory inside a project.',
      inputSchema: { project, path: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ project: name, path }) => guard(async () => (await deleteProjectPath(name, path), text({ deleted: path }))),
  )

  server.registerTool(
    'fetch_asset',
    {
      title: 'Fetch asset from URL',
      description: 'Download an http(s) URL (image, video, audio, font, Lottie) into the project so a composition can reference it locally. Public hosts only: loopback, LAN, link-local and .local/.internal targets are refused, redirects included; 512 MiB limit.',
      inputSchema: { project, url: z.string().url(), path: z.string().describe('Destination, e.g. assets/music.mp3') },
    },
    async ({ project: name, url, path }) => guard(async () => text(await fetchIntoProject(name, url, path))),
  )

  server.registerTool(
    'lint',
    {
      title: 'Lint composition',
      description: 'Static HTML check (`hyperframes lint --json`). Fast, no browser. Fix every error before check or render.',
      inputSchema: { project, verbose: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name, verbose }) => guard(async () => text(await lintProject(name, verbose))),
  )

  server.registerTool(
    'check',
    {
      title: 'Browser check',
      description:
        'The browser gate (`hyperframes check --json`): lint, runtime, layout, motion, WCAG contrast and craft findings. range scopes runtime sampling; components filters findings without changing full-check status. snapshots=true saves audited frames under .hyperframes/artifacts/snapshots/.',
      inputSchema: {
        project,
        snapshots: z.boolean().optional(),
        at: z.array(z.number()).optional().describe('Explicit timestamps in seconds'),
        samples: z.number().int().optional(),
        strict: z.boolean().optional().describe('Warnings fail too'),
        contrast: z.boolean().optional().describe('false skips the WCAG pass'),
        atTransitions: z.boolean().optional(),
        range: z.tuple([z.number(), z.number()]).optional().describe('Runtime interval [start, end]; static lint stays project-wide'),
        components: z.string().max(500).optional().describe('CSS selector list filters findings, not full-check status'),
        maxTransitionSamples: z.number().int().min(1).max(10000).optional(),
        maxIssues: z.number().int().min(1).max(1000).optional(),
        collapseStatic: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name, ...options }) => guard(async () => text(await checkProject(name, options))),
  )

  server.registerTool(
    'snapshot',
    {
      title: 'Capture frames',
      description:
        'Capture PNG frames, or review=true for beat stills, seam strips and phone sheets. Returns upstream JSON times and review metadata plus project files. Up to three PNGs are inline. Local only: Gemini descriptions are disabled.',
      inputSchema: {
        project,
        at: z.array(z.number()).optional().describe('Timestamps in seconds'),
        frames: z.number().int().optional().describe('Evenly spaced frames instead of `at` (default 5)'),
        zoom: z.string().optional().describe('CSS selector or x,y,w,h crop'),
        review: z.boolean().optional().describe('Scene/beat stills, seam strips and phone sheets; incompatible with at, range or zoom'),
        range: z.tuple([z.number(), z.number()]).optional().describe('Root-timeline interval [start, end]'),
        composition: z.string().max(500).optional().describe('data-composition-id, not a file path'),
        end: z.boolean().optional().describe('false drops the automatic end-of-timeline frame'),
        inlineImages: z.number().int().min(0).max(6).optional().describe('How many PNGs to return inline (default 3)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name, inlineImages, ...options }) =>
      guard(async () => {
        const result = await snapshotProject(name, { ...options, describe: false })
        const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        const limit = inlineImages ?? 3
        for (const f of result.files.filter((f) => f.path.endsWith('.png')).slice(0, limit)) {
          const png = await readSnapshotPng(name, f.path)
          content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
        }
        return { content }
      }),
  )

  server.registerTool(
    'timeline',
    {
      title: 'Timeline',
      description: 'What is on the project timeline (`hyperframes timeline --json`): tracks, clips, absolute start and end, owning file. Prefer this over reading every HTML file.',
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name }) => guard(async () => text(await projectJson(name, ['timeline']))),
  )

  server.registerTool(
    'project_info',
    {
      title: 'Project info',
      description: '`hyperframes info --json`: duration, dimensions, fps, media and compositions as the CLI resolves them.',
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name }) => guard(async () => text(await projectJson(name, ['info']))),
  )

  server.registerTool(
    'catalog_search',
    {
      title: 'Search the catalog',
      description:
        'Search the HyperFrames registry of blocks (scenes) and components (effects) before hand-building a named look. Query in English, describe the effect, not the mechanism.',
      inputSchema: {
        query: z.string().optional(),
        type: z.enum(['block', 'component']).optional(),
        tag: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => guard(async () => text(await catalogSearch(input))),
  )

  server.registerTool(
    'catalog_item',
    {
      title: 'Read a catalog item',
      description:
        'The registry manifest of one block, component or example: title, description, tags, canvas, duration, files and, above all, the variables it exposes (ids, types, defaults). Read it before catalog_add so vars can set brand copy, colors and logos at install time.',
      inputSchema: { name: z.string(), type: z.enum(catalogItemTypes).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ name, type }) => guard(async () => text(await catalogItem(name, type))),
  )

  server.registerTool(
    'catalog_add',
    {
      title: 'Install a catalog item',
      description:
        'Install a registry block, component, or every block with a tag into the project (`hyperframes add`). Returns the written files and the paste snippet. `vars` bakes variable values (see catalog_item) into the snippet as data-variable-values.',
      inputSchema: {
        project,
        name: z.string(),
        vars: z.record(z.string(), z.unknown()).optional().describe('Variable id → value, baked into the snippet'),
        force: z.boolean().optional().describe('Overwrite files edited since the last install'),
      },
    },
    async ({ project: name, name: item, vars, force }) => guard(async () => text(await catalogAdd(name, item, { vars, force }))),
  )

  server.registerTool(
    'render_video',
    {
      title: 'Render video',
      description:
        'Queue a render (`hyperframes render`) and return a job id immediately. Formats: mp4 (default), webm and mov (transparent), gif, png-sequence, hls. Quality: draft while iterating, looks (default), delivery for the final file. Poll get_render_status.',
      inputSchema: {
        project,
        format: z.enum(renderFormats).optional(),
        fps: z.union([z.number().int().min(1).max(240), z.string()]).optional().describe('Integer or rational like 30000/1001; default is the composition data-fps or 30'),
        quality: z.enum(renderQualities).optional(),
        composition: z.string().optional().describe('Composition file instead of index.html'),
        outputName: z.string().optional().describe('File name without extension; default <project>_<timestamp>'),
        resolution: z.enum(renderResolutions).optional().describe('Supersample to a preset'),
        variables: z.record(z.string(), z.unknown()).optional().describe('Overrides for data-composition-variables'),
        workers: z.union([z.number().int().min(1).max(24), z.literal('auto')]).optional(),
        strict: z.boolean().optional().describe('Fail on lint errors'),
        gifLoop: z.number().int().optional(),
      },
    },
    async (input) => guard(async () => text(jobView(await submitRender(input)))),
  )

  server.registerTool(
    'get_render_status',
    {
      title: 'Render status',
      description: 'Status of a render job with the tail of its log and, once finished, the output path and download link.',
      inputSchema: { job_id: z.string(), fullLog: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ job_id, fullLog }) =>
      guard(async () => text({ ...jobView(getJob(job_id)), ...(fullLog ? { log: await jobLog(job_id) } : {}) })),
  )

  server.registerTool(
    'list_renders',
    {
      title: 'List render jobs',
      description: 'Render jobs, newest first, optionally for one project.',
      inputSchema: { project: project.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project: name }) => guard(async () => text(listJobs(name).map(jobView))),
  )

  server.registerTool(
    'cancel_render',
    {
      title: 'Cancel render',
      description: 'Cancel a queued or running render job.',
      inputSchema: { job_id: z.string() },
    },
    async ({ job_id }) => guard(async () => text(jobView(await cancelRender(job_id)))),
  )

  // ── VoiceStudio (optional; tools answer "not installed" when the service is absent) ──
  const rel = z.string().describe('Project-relative path')
  const lang = z.string().max(16).optional().describe('ISO language code such as "en"; omit to let VoiceStudio decide')

  server.registerTool(
    'voicestudio_status',
    {
      title: 'VoiceStudio status',
      description: 'Is VoiceStudio (self-hosted voice, transcription and dubbing) installed and reachable on this server, and are its speech, transcription and translation models ready? Call before any other voicestudio_ tool.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(await voicestudioStatus())),
  )

  server.registerTool(
    'voicestudio_list_voices',
    {
      title: 'List VoiceStudio voices',
      description: 'Saved VoiceStudio voice profiles: id, name, language, kind (clone or design). Pass an id as `voice` to voicestudio_speak or voicestudio_dub.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(await listVoices())),
  )

  server.registerTool(
    'voicestudio_speak',
    {
      title: 'Narrate text into the project',
      description:
        'Synthesize speech with a VoiceStudio voice and write the WAV straight into the project (default assets/voice/<slug>-<n>.wav). Returns path, duration and size, never audio. Long text is fine (one call, can take minutes on CPU). Then add an <audio id class="clip" data-start data-track-index> element pointing at the path.',
      inputSchema: {
        project,
        text: z.string().min(1).max(200000),
        voice: z.string().describe('VoiceStudio profile id (voicestudio_list_voices)'),
        language: lang,
        speed: z.number().min(0.25).max(4).optional(),
        output: rel.optional().describe('Destination .wav; default assets/voice/<slug>-<n>.wav'),
        effect_preset: z.string().max(32).optional().describe('VoiceStudio mastering preset; "raw" disables processing, default is "broadcast"'),
      },
    },
    async (input) => guard(async () => text(await speak(input))),
  )

  server.registerTool(
    'voicestudio_transcribe',
    {
      title: 'Transcribe project audio or video',
      description:
        'Transcribe a project audio/video file with VoiceStudio. Writes the full result next to the input (<input>.transcript.json) and, with words=true, a caption-ready <input>.transcript.words.json ([{id,text,start,end}]); formats adds .srt/.vtt. Returns only a short summary and a text preview, so read the files for caption timing instead of asking for the transcript.',
      inputSchema: {
        project,
        input: rel,
        language: lang,
        words: z.boolean().optional().describe('Word-level timestamps (slower alignment pass)'),
        output: rel.optional().describe('Destination .json; default <input>.transcript.json'),
        formats: z.array(z.enum(['srt', 'vtt'])).optional(),
      },
    },
    async (input) => guard(async () => text(await transcribe(input))),
  )

  server.registerTool(
    'voicestudio_clone_voice',
    {
      title: 'Clone a voice',
      description:
        'Create a VoiceStudio voice profile from a project reference recording (5-30 s, one speaker). Only clone a voice the owner has the right to clone: their own, or one whose speaker gave permission; pass `consent` to record which in VoiceStudio. Returns the profile id.',
      inputSchema: {
        project,
        reference: rel,
        name: z.string().min(1).max(120),
        language: lang,
        reference_text: z.string().max(4000).optional().describe('Exact words in the recording; omit to let VoiceStudio transcribe it'),
        consent: z.enum(['own_voice', 'speaker_permission']).optional(),
      },
    },
    async (input) => guard(async () => text(await cloneVoice(input))),
  )

  server.registerTool(
    'voicestudio_design_voice',
    {
      title: 'Design a voice from a description',
      description:
        'Create a voice profile from words such as "elderly female, low pitch, british accent". VoiceStudio maps only gender, age, pitch, whisper style and English accents or Chinese dialects; a description that maps to nothing is refused with the unmatched words.',
      inputSchema: { description: z.string().min(1).max(2000), name: z.string().min(1).max(120), language: lang },
    },
    async (input) => guard(async () => text(await designVoice(input))),
  )

  server.registerTool(
    'voicestudio_dub',
    {
      title: 'Dub a project video or audio into another language',
      description:
        'Queue a dub: transcribe, translate (local providers only), re-voice and write results into the project (default assets/dub/<name>.<lang>.mp4|wav|srt). voice "clone-original" keeps each original speaker; or give a profile id. Returns a job id at once; poll voicestudio_dub_status (minutes to hours on CPU). Needs ASR, translation and TTS models installed and licences accepted by the owner in VoiceStudio.',
      inputSchema: {
        project,
        input: rel.describe('Project-relative video or audio file'),
        target_language: z.string().max(16),
        translation_provider: z.enum(localProviders).optional().describe('Default argos (needs its language pack); nllb is heavier'),
        voice: z.string().optional().describe('"clone-original" (default) or a VoiceStudio profile id'),
        outputs: z.array(z.enum(dubOutputs)).optional().describe('video (MP4), audio (WAV mix) and/or srt; default video+srt for video input, audio+srt for audio'),
        source_language: lang,
        output_dir: rel.optional().describe('Default assets/dub'),
        timing_strategy: z.enum(timingStrategies).optional().describe('Default smart_fit; concise fails when the translation overflows its slot'),
      },
    },
    async (input) => guard(async () => text(await submitDub(input))),
  )

  server.registerTool(
    'voicestudio_dub_status',
    {
      title: 'Dub job status',
      description: 'Status, stage, warnings and finished output paths of a dub job; omit job_id to list recent dubs.',
      inputSchema: { job_id: z.string().optional(), project: project.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ job_id, project: name }) => guard(async () => text(job_id ? getDub(job_id) : listDubs(name))),
  )

  server.registerTool(
    'voicestudio_dub_cancel',
    {
      title: 'Cancel a dub job',
      description: 'Cancel a queued or running dub job (also asks VoiceStudio to stop).',
      inputSchema: { job_id: z.string() },
    },
    async ({ job_id }) => guard(async () => text(await cancelDub(job_id))),
  )

  server.registerTool(
    'studio_status',
    {
      title: 'Studio status',
      description: 'Which project the Studio web editor is serving and its URLs. Hand the project URL to the user for review.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(await studioStatus())),
  )

  server.registerTool(
    'studio_open',
    {
      title: 'Open project in Studio',
      description: 'Switch the Studio web editor to a project. Studio restarts in a few seconds; renders in progress continue.',
      inputSchema: { project },
    },
    async ({ project: name }) => guard(async () => text(await openInStudio(name))),
  )

  server.registerTool(
    'run_cli',
    {
      title: 'Run a hyperframes CLI command',
      description: `Run an allowed hyperframes subcommand inside a project (or the projects root). Arguments are passed verbatim, no shell. Add --json where the command supports it. Allowed: ${[...allowedCliCommands].sort().join(', ')}. Use render_video for renders.`,
      inputSchema: {
        project: project.optional(),
        args: z.array(z.string()).min(1).describe('e.g. ["timeline", "--json"] or ["tts", "Hello", "--output", "assets/voice.wav"]'),
        timeoutMs: z.number().int().optional(),
      },
    },
    async ({ project: name, args, timeoutMs }) => guard(async () => text(await runAllowedCli(name, args, timeoutMs))),
  )

  server.registerTool(
    'list_skills',
    {
      title: 'List skills',
      description: 'The skills library on this server: the upstream HyperFrames skills, the StartOS-specific ones, the community skills, and the HeyGen avatar/video/translate skills. Read hyperframes-server first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(await listSkills())),
  )

  server.registerTool(
    'read_skill',
    {
      title: 'Read a skill file',
      description: 'Read SKILL.md (default) or any reference file of a skill, e.g. path "references/data-attributes.md". Use list_skill_files to see what a skill contains.',
      inputSchema: { skill: z.string(), path: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ skill, path }) =>
      guard(async () => {
        const f = await readSkillFile(skill, path ?? 'SKILL.md')
        return text(await readFile(f.abs, 'utf8'))
      }),
  )

  server.registerTool(
    'list_skill_files',
    {
      title: 'List skill files',
      description: 'Every file inside one skill directory.',
      inputSchema: { skill: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ skill }) => guard(async () => text(await skillFiles(skill))),
  )

  server.registerResource(
    'skill',
    new ResourceTemplate('hyperframes://skills/{skill}/{+path}', {
      list: async () => ({
        resources: (await listSkills()).map((s) => ({
          uri: `hyperframes://skills/${s.name}/SKILL.md`,
          name: s.name,
          description: s.description,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    { title: 'HyperFrames skills', description: 'SKILL.md and reference files of the skills library', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const skill = String(variables.skill)
      const path = Array.isArray(variables.path) ? variables.path.join('/') : String(variables.path ?? 'SKILL.md')
      const f = await readSkillFile(skill, path)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(f.abs, 'utf8') }] }
    },
  )

  server.registerResource(
    'server-info',
    'hyperframes://server/info',
    { title: 'Server info', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(serverInfo(), null, 2) }] }),
  )

  return server
}
