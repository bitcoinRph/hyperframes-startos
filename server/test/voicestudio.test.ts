import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const root = await mkdtemp(join(tmpdir(), 'hf-vs-'))
const projects = join(root, 'projects')
const keyFile = join(root, 'credentials.json')
process.env.HYPERFRAMES_PROJECTS_DIR = projects
process.env.HF_STATE_DIR = join(root, 'state')
process.env.HF_API_KEY = 'vs-test-only'
process.env.VOICESTUDIO_POLL_MS = '20'
delete process.env.VOICESTUDIO_URL
delete process.env.VOICESTUDIO_KEY_FILE

const vs = await import('../src/voicestudio.ts')
const { createApp } = await import('../src/api.ts')

function wav(seconds = 1): Buffer {
  const data = Buffer.alloc(24000 * 2 * seconds)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(24000, 24)
  h.writeUInt32LE(48000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const seen: { method: string; path: string; auth: string | undefined; origin: string | undefined; body: string }[] = []
let mode: 'ok' | 'asr-missing' | 'busy' = 'ok'
let busyCount = 0
let providerSeen = ''
let dubPollsLeft = 2

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks).toString('latin1')
  const url = new URL(req.url ?? '/', 'http://x')
  seen.push({ method: req.method ?? '', path: url.pathname, auth: req.headers.authorization, origin: (req.headers.origin ?? req.headers['sec-fetch-site'] ?? req.headers.referer) as string | undefined, body })
  const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
    const isBuf = Buffer.isBuffer(payload)
    res.writeHead(status, { 'Content-Type': isBuf ? 'audio/wav' : 'application/json', ...headers })
    res.end(isBuf ? payload : typeof payload === 'string' ? payload : JSON.stringify(payload))
  }
  const p = url.pathname
  if (p === '/health') return send(200, { status: 'ok', device: 'cpu', version: '0.5.7' })
  if (req.headers.authorization !== 'Bearer key-1' && req.headers.authorization !== 'Bearer key-2') return send(401, { detail: 'API key required' })
  if (p === '/engines/tts') return send(200, { active: 'omnivoice', backends: [{ id: 'omnivoice', available: true }] })
  if (p === '/engines/asr') return send(200, { active: 'whisper', backends: [{ id: 'whisper', available: true }] })
  if (p === '/engines/translation') return send(200, { active: 'argos', engines: [{ id: 'argos', ready: true }, { id: 'google', ready: true }] })
  if (p === '/models') {
    return send(200, { models: [
      { repo_id: 'k2-fsa/OmniVoice', role: 'TTS', installed: true, license_acceptance: { required: true, accepted: true } },
      { repo_id: 'openai/whisper', role: 'ASR', installed: true },
    ] })
  }
  if (p === '/profiles' && req.method === 'GET') return send(200, [{ id: 'abc12345', name: 'Narrator', kind: 'clone', language: 'en', ref_text: 'secret' }])
  if (p === '/profiles/abc12345') return send(200, { id: 'abc12345', name: 'Narrator', language: 'en' })
  if (p.startsWith('/profiles/') && !p.includes('/', 10)) return send(404, { detail: 'Profile not found' })
  if (p === '/profiles' && req.method === 'POST') return send(200, { id: body.includes('design') ? 'des00001' : 'new00001', name: 'N', kind: body.includes('design') ? 'design' : 'clone', language: 'en' })
  if (p === '/profiles/new00001/attestation') return send(200, { id: 'new00001', consent_basis: 'own_voice' })
  if (p === '/profiles/des00001/audio') return send(200, wav(1))
  if (p === '/design/describe') {
    const d = JSON.parse(body).description as string
    return send(200, d.includes('raspy') ? { attrs: {}, instruct: '', matched: [], unmatched: ['raspy'] } : { attrs: { Gender: 'female' }, instruct: 'female', matched: [{ category: 'Gender', token: 'female' }], unmatched: [] })
  }
  if (p === '/generate') {
    if (mode === 'busy' && busyCount++ < 5) return send(503, { detail: 'engine busy' }, { 'Retry-After': '0' })
    return send(200, wav(2), { 'X-Audio-Id': 'aa11bb22', 'X-Audio-Duration': '2.0' })
  }
  if (p === '/v1/audio/transcriptions') {
    if (mode === 'asr-missing') return send(409, { error: { code: 'asr_model_missing' }, detail: { error: 'asr_model_missing', recommended: { repo_id: 'openai/whisper', label: 'Whisper small', size_gb: 1 } } })
    return send(200, { language: 'en', duration: 2, text: 'hello big world', segments: [{ start: 0, end: 2, text: 'hello big world' }], words: [{ word: 'hello', start: 0, end: 0.5 }, { word: 'big', start: 0.5, end: 1 }, { word: 'world', start: 1, end: 2 }] })
  }
  if (p === '/dub/upload') return send(202, { job_id: 'j1', task_id: 'prep_j1', filename: 'in.mp4' })
  if (p === '/jobs/prep_j1' || p === '/jobs/dub_j1_1') return send(200, { id: p.slice(6), status: dubPollsLeft-- > 0 ? 'running' : 'done' })
  if (p === '/dub/transcribe-stream/j1') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('event: start\ndata: {}\n\n')
    const final = JSON.stringify({ segments: [{ id: 's1', start: 0, end: 2, text: 'hello', speaker_id: 'S1', profile_id: 'auto:s1' }], source_lang: 'en' })
    res.write(`event: final\ndata: ${final.slice(0, 20)}`)
    res.write(`${final.slice(20)}\n\nevent: done\ndata: {}\n\n`)
    return res.end()
  }
  if (p === '/dub/translate') {
    const j = JSON.parse(body)
    providerSeen = j.provider
    return send(200, { translated: [{ id: 's1', text: 'hola' }] })
  }
  if (p === '/dub/generate/j1') {
    const j = JSON.parse(body)
    assert.equal(j.segments[0].text, 'hola')
    assert.equal(j.segments[0].profile_id, 'auto:s1')
    dubPollsLeft = 1
    return send(202, { task_id: 'dub_j1_1' })
  }
  if (p === '/dub/download/j1') return send(200, Buffer.from('MP4DATA'), { 'Content-Type': 'video/mp4' })
  if (p === '/dub/download-audio/j1') return send(200, wav(1))
  if (p === '/dub/srt/j1') return send(200, '1\n00:00:00,000 --> 00:00:02,000\nhola\n', { 'Content-Type': 'text/plain' })
  send(404, { detail: 'nope' })
})

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  await mkdir(join(projects, 'demo', 'assets'), { recursive: true })
  await writeFile(join(projects, 'demo', 'index.html'), '<html></html>')
  await writeFile(join(projects, 'demo', 'assets', 'in.wav'), wav(1))
  await writeFile(join(projects, 'demo', 'assets', 'in.mp4'), 'fakevideo')
  await writeFile(keyFile, JSON.stringify({ apiKey: 'key-1' }))
})
after(async () => {
  server.close()
  await rm(root, { recursive: true, force: true })
})

const connect = () => {
  process.env.VOICESTUDIO_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.VOICESTUDIO_KEY_FILE = keyFile
}

test('absent VoiceStudio gives a clear result over REST and MCP, not a crash', async () => {
  const app = createApp()
  const headers = { Authorization: 'Bearer vs-test-only', 'Content-Type': 'application/json' }
  const st = (await (await app.request('/api/v1/voicestudio/status', { headers })).json()) as any
  assert.equal(st.configured, false)
  assert.match(st.message, /not installed/)
  const res = await app.request('/api/v1/voicestudio/voices', { headers })
  assert.equal(res.status, 503)
  const mcp = await app.request('/mcp', { method: 'POST', headers: { ...headers, Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  const names = ((await mcp.json()) as any).result.tools.map((t: any) => t.name)
  for (const n of ['voicestudio_status', 'voicestudio_list_voices', 'voicestudio_speak', 'voicestudio_transcribe', 'voicestudio_clone_voice', 'voicestudio_design_voice', 'voicestudio_dub', 'voicestudio_dub_status']) assert.ok(names.includes(n), n)
  const spec = (await (await app.request('/openapi.json', { headers })).json()) as any
  for (const p of ['/api/v1/voicestudio/status', '/api/v1/projects/{project}/voicestudio/speak', '/api/v1/projects/{project}/voicestudio/dub', '/api/v1/voicestudio/dubs/{id}']) assert.ok(spec.paths[p], p)
})

test('key file missing is an actionable error; status reports readiness; bearer sent, no browser headers', async () => {
  connect()
  process.env.VOICESTUDIO_KEY_FILE = join(root, 'nope.json')
  await assert.rejects(vs.listVoices(), /not published its API key/)
  connect()
  const st = (await vs.voicestudioStatus()) as any
  assert.equal(st.reachable, true)
  assert.equal(st.version, '0.5.7')
  assert.deepEqual(st.ready, { speak: true, transcribe: true, dub: true })
  assert.ok(seen.length > 0)
  for (const r of seen.filter((r) => r.path !== '/health')) {
    assert.equal(r.auth, 'Bearer key-1')
    assert.equal(r.origin, undefined)
  }
  assert.equal(JSON.stringify(st).includes('key-1'), false)
})

test('key is re-read after rotation', async () => {
  connect()
  await writeFile(keyFile, JSON.stringify({ apiKey: 'key-2' }))
  seen.length = 0
  await vs.listVoices()
  assert.equal(seen.at(-1)?.auth, 'Bearer key-2')
  await writeFile(keyFile, JSON.stringify({ apiKey: 'key-1' }))
})

test('list voices returns only id, name, language, kind', async () => {
  connect()
  const v = (await vs.listVoices()) as any
  assert.deepEqual(v.voices, [{ id: 'abc12345', name: 'Narrator', language: 'en', kind: 'clone' }])
})

test('speak writes a WAV inside the project and refuses traversal', async () => {
  connect()
  const r = (await vs.speak({ project: 'demo', text: 'Hello brave new world today', voice: 'abc12345' })) as any
  assert.equal(r.path, 'assets/voice/hello-brave-new-world-1.wav')
  assert.equal(r.duration, 2)
  const s = await stat(join(projects, 'demo', r.path))
  assert.equal(s.size, wav(2).length)
  const second = (await vs.speak({ project: 'demo', text: 'Hello brave new world today', voice: 'Narrator' })) as any
  assert.equal(second.path, 'assets/voice/hello-brave-new-world-2.wav')
  for (const output of ['../escape.wav', '/etc/evil.wav', 'assets/x.mp3']) {
    await assert.rejects(vs.speak({ project: 'demo', text: 'x', voice: 'abc12345', output }), /path|\.wav|project-relative/)
  }
  await assert.rejects(vs.speak({ project: 'demo', text: 'x', voice: 'zzz99999' }), /not a VoiceStudio profile/)
  assert.deepEqual(await stat(join(root, 'escape.wav')).catch(() => 'none'), 'none')
})

test('503 busy is retried, then surfaced with an actionable message', async () => {
  connect()
  mode = 'busy'
  busyCount = 0
  await assert.rejects(vs.speak({ project: 'demo', text: 'again', voice: 'abc12345', output: 'assets/voice/b.wav' }), /busy or still loading/)
  mode = 'ok'
})

test('transcribe writes files, returns only a summary; missing ASR model is actionable', async () => {
  connect()
  const r = (await vs.transcribe({ project: 'demo', input: 'assets/in.wav', words: true, formats: ['srt', 'vtt'] })) as any
  assert.equal(r.segments, 1)
  assert.equal(r.words, 3)
  assert.deepEqual(r.files.map((f: any) => f.path), ['assets/in.transcript.json', 'assets/in.transcript.words.json', 'assets/in.transcript.srt', 'assets/in.transcript.vtt'])
  const words = JSON.parse(await readFile(join(projects, 'demo', 'assets/in.transcript.words.json'), 'utf8'))
  assert.deepEqual(words[1], { id: 'w1', text: 'big', start: 0.5, end: 1 })
  assert.match(await readFile(join(projects, 'demo', 'assets/in.transcript.srt'), 'utf8'), /00:00:00,000 --> 00:00:02,000/)
  await assert.rejects(vs.transcribe({ project: 'demo', input: '../x.wav' }), /escapes|must be/)
  mode = 'asr-missing'
  await assert.rejects(vs.transcribe({ project: 'demo', input: 'assets/in.wav' }), /no speech-recognition \(ASR\) model installed.*Whisper small/)
  mode = 'ok'
})

test('clone and design', async () => {
  connect()
  const c = (await vs.cloneVoice({ project: 'demo', reference: 'assets/in.wav', name: 'Me', consent: 'own_voice' })) as any
  assert.equal(c.id, 'new00001')
  assert.equal(c.consentRecorded, true)
  const d = (await vs.designVoice({ description: 'female voice', name: 'Anna' })) as any
  assert.equal(d.id, 'des00001')
  await assert.rejects(vs.designVoice({ description: 'raspy', name: 'X' }), /No supported voice trait/)
})

test('dub job runs the pipeline, writes outputs, rejects cloud providers', async () => {
  connect()
  await assert.rejects(vs.submitDub({ project: 'demo', input: 'assets/in.mp4', target_language: 'es', translation_provider: 'google' as never }), /translation_provider/)
  await assert.rejects(vs.submitDub({ project: 'demo', input: 'assets/in.wav', target_language: 'es', outputs: ['video'] }), /video input/)
  const job = await vs.submitDub({ project: 'demo', input: 'assets/in.mp4', target_language: 'es', outputs: ['video', 'audio', 'srt'] })
  assert.equal(job.request.translation_provider, 'argos')
  for (let i = 0; i < 200 && !['succeeded', 'failed', 'cancelled'].includes(vs.getDub(job.id).status); i++) await new Promise((r) => setTimeout(r, 25))
  const done = vs.getDub(job.id)
  assert.equal(done.status, 'succeeded', done.error ?? '')
  assert.equal(providerSeen, 'argos')
  assert.deepEqual(done.outputs.map((o) => o.path), ['assets/dub/in.es.mp4', 'assets/dub/in.es.wav', 'assets/dub/in.es.srt'])
  assert.equal(await readFile(join(projects, 'demo', 'assets/dub/in.es.mp4'), 'utf8'), 'MP4DATA')
  assert.equal(vs.listDubs('demo')[0].id, job.id)
})
