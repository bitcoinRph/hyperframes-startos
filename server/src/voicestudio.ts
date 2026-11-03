import { randomUUID } from 'node:crypto'
import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from './config.js'
import type { JobStatus } from './jobs.js'
import { requireProject } from './projects.js'
import { ApiError, badRequest, notFound } from './util/errors.js'
import { resolveInside } from './util/paths.js'

/*
 * VoiceStudio integration. The service is an optional StartOS dependency:
 * startos/main.ts passes VOICESTUDIO_URL (its bridge address) and
 * VOICESTUDIO_KEY_FILE (its `public` volume's credentials.json, mounted
 * read-only) only when VoiceStudio is installed. Both come from the StartOS
 * operator, never from an agent, so the URL does not go through util/net.ts.
 * Agents may only pass project-relative paths and the documented parameters.
 *
 * Every call here was checked against the VoiceStudio backend; the comments name
 * the route and the file it lives in (paths relative to voicestudio's backend/).
 *
 * Auth: `Authorization: Bearer <apiKey>` on every request. The key can be
 * rotated, so it is re-read from the file on each request (never cached, never
 * logged, never returned). node:http sends no Origin, Sec-Fetch headers or Referer, which
 * VoiceStudio's cross-site guard would reject (core/browser_guard.py).
 */

// ── Configuration ──────────────────────────────────────────────────────────

type VsEnv = { baseUrl: URL; keyFile: string }

/** Read per call so tests (and a restarted daemon) see the current environment. */
function vsEnv(): VsEnv | null {
  const raw = process.env.VOICESTUDIO_URL?.trim()
  if (!raw) return null
  let baseUrl: URL
  try {
    baseUrl = new URL(raw)
  } catch {
    throw new ApiError(500, 'VOICESTUDIO_URL is not a valid URL; fix the HyperFrames service configuration')
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new ApiError(500, 'VOICESTUDIO_URL must be http or https')
  }
  return { baseUrl, keyFile: process.env.VOICESTUDIO_KEY_FILE?.trim() ?? '' }
}

export function voicestudioConfigured(): boolean {
  try {
    return vsEnv() !== null
  } catch {
    return true
  }
}

const NOT_INSTALLED =
  'VoiceStudio is not installed/connected on this server. The owner can install the VoiceStudio service (version 0.5.7 or newer) on this StartOS server; HyperFrames then reaches it automatically.'

function requireEnv(): VsEnv {
  const env = vsEnv()
  if (!env) throw new ApiError(503, NOT_INSTALLED)
  return env
}

/** Contract: credentials.json on VoiceStudio's `public` volume is `{ "apiKey": "<key>" }`. */
async function readKey(env: VsEnv): Promise<string> {
  if (!env.keyFile) {
    throw new ApiError(503, 'VoiceStudio is connected but VOICESTUDIO_KEY_FILE is not set; restart the HyperFrames service')
  }
  let raw: string
  try {
    raw = await readFile(env.keyFile, 'utf8')
  } catch {
    throw new ApiError(
      503,
      'VoiceStudio has not published its API key yet. Start VoiceStudio (version 0.5.7 or newer) on StartOS and, if it was just updated, wait for it to finish starting.',
    )
  }
  let key: unknown
  try {
    key = (JSON.parse(raw) as { apiKey?: unknown }).apiKey
  } catch {
    key = undefined
  }
  if (typeof key !== 'string' || !key) {
    throw new ApiError(503, 'VoiceStudio has not published an API key yet. The owner may need to run its "Set API Key" style action or update VoiceStudio to 0.5.7 or newer.')
  }
  return key
}

// ── HTTP client ────────────────────────────────────────────────────────────

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

type Req = {
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, string | undefined>
  json?: unknown
  /** A factory, so a retried request gets a fresh body stream. */
  form?: () => Promise<FormData>
  timeoutMs: number
  signal?: AbortSignal
  /** Stream a 2xx body into this file instead of memory. */
  sinkFile?: string
  /** Receive a 2xx body incrementally (SSE). */
  onData?: (chunk: Buffer) => void
  /** Retries for 503/429 (VoiceStudio busy or loading a model), honouring Retry-After. */
  retries?: number
  maxBodyBytes?: number
}

const MAX_BODY = 64 * 1024 * 1024
const MAX_RETRY_WAIT_MS = 120_000

function requestOnce(env: VsEnv, key: string, req: Req, body: Readable | Buffer | null, contentType: string | null): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const url = new URL(env.baseUrl)
    url.pathname = `${env.baseUrl.pathname.replace(/\/$/, '')}${req.path}`
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, v)
    const lib = url.protocol === 'https:' ? https : http
    const signal = AbortSignal.any([AbortSignal.timeout(req.timeoutMs), ...(req.signal ? [req.signal] : [])])
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: '*/*' }
    if (contentType) headers['Content-Type'] = contentType
    if (Buffer.isBuffer(body)) headers['Content-Length'] = String(body.length)
    const r = lib.request(url, { method: req.method ?? 'GET', headers, signal, agent: false }, (res) => {
      const status = res.statusCode ?? 0
      const ok = status >= 200 && status < 300
      if (ok && req.sinkFile) {
        const out = createWriteStream(req.sinkFile)
        pipeline(res, out).then(
          () => resolve({ status, headers: res.headers, body: Buffer.alloc(0) }),
          reject,
        )
        return
      }
      if (ok && req.onData) {
        res.on('data', (c: Buffer) => req.onData?.(c))
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.alloc(0) }))
        res.on('error', reject)
        return
      }
      const limit = ok ? (req.maxBodyBytes ?? MAX_BODY) : 1024 * 1024
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > limit) {
          if (ok) res.destroy(new ApiError(502, 'VoiceStudio response is larger than the allowed size'))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    r.on('error', reject)
    if (body instanceof Readable) body.on('error', reject).pipe(r)
    else r.end(body)
  })
}

function netError(err: unknown, timeoutMs: number): ApiError {
  if (err instanceof ApiError) return err
  const e = err as NodeJS.ErrnoException & { name?: string }
  if (e?.name === 'TimeoutError') return new ApiError(504, `VoiceStudio did not answer within ${Math.round(timeoutMs / 1000)} s`)
  if (e?.name === 'AbortError') return new ApiError(499, 'the request to VoiceStudio was cancelled')
  const code = e?.code ?? (e?.cause as NodeJS.ErrnoException | undefined)?.code
  return new ApiError(503, `VoiceStudio is not reachable${code ? ` (${code})` : ''}. Is the VoiceStudio service running?`)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new ApiError(499, 'cancelled'))), { once: true })
  })

async function send(req: Req): Promise<Reply> {
  const env = requireEnv()
  let key = await readKey(env)
  let retriesLeft = req.retries ?? 2
  let reauthed = false
  for (;;) {
    let body: Readable | Buffer | null = null
    let contentType: string | null = null
    if (req.json !== undefined) {
      body = Buffer.from(JSON.stringify(req.json))
      contentType = 'application/json'
    } else if (req.form) {
      const response = new Response(await req.form())
      contentType = response.headers.get('content-type')
      body = response.body ? Readable.fromWeb(response.body as never) : null
    }
    let reply: Reply
    try {
      reply = await requestOnce(env, key, req, body, contentType)
    } catch (err) {
      throw netError(err, req.timeoutMs)
    }
    if (reply.status >= 200 && reply.status < 300) return reply
    if (reply.status === 401 && !reauthed) {
      // The key may have been rotated since we read it.
      reauthed = true
      const fresh = await readKey(env)
      if (fresh !== key) {
        key = fresh
        continue
      }
    }
    if ((reply.status === 503 || reply.status === 429) && retriesLeft > 0) {
      retriesLeft--
      const wait = Math.min(MAX_RETRY_WAIT_MS, Math.max(0, Number(reply.headers['retry-after'] ?? 2)) * 1000)
      await sleep(Number.isFinite(wait) ? wait : 2000, req.signal)
      continue
    }
    throw vsError(reply)
  }
}

// ── Error mapping ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}...` : s)

/** FastAPI `{detail}`, OpenAI `{error:{message,code}}` and the typed 409/403 payloads. */
export function describeVsError(status: number, bodyText: string, retryAfter?: string): { code: string | null; message: string; payload: Obj | null } {
  let json: unknown = null
  try {
    json = JSON.parse(bodyText)
  } catch {
    /* plain text body */
  }
  const root = isObj(json) ? json : {}
  const detail = root.detail
  const dObj = isObj(detail) ? detail : {}
  const eObj = isObj(root.error) ? root.error : {}
  const strs = (...xs: unknown[]) => xs.find((x): x is string => typeof x === 'string' && x.length > 0) ?? null
  const code = strs(dObj.code, dObj.error, eObj.code, root.code, typeof root.error === 'string' ? root.error : null)
  const message =
    strs(dObj.message, eObj.message, typeof detail === 'string' ? detail : null, root.message) ??
    (isObj(json) ? '' : clip(bodyText.trim()))
  const payload = Object.keys(dObj).length ? dObj : Object.keys(eObj).length ? { ...root, ...eObj } : root
  void status
  void retryAfter
  return { code, message, payload }
}

export function vsError(reply: Reply): ApiError {
  const text = reply.body.toString('utf8')
  const { code, message, payload } = describeVsError(reply.status, text, String(reply.headers['retry-after'] ?? ''))
  const details = { voicestudio: { status: reply.status, code } }
  if (code === 'asr_model_missing') {
    const rec = isObj(payload?.recommended) ? payload.recommended : null
    const hint = rec ? ` Recommended: ${String(rec.label ?? rec.repo_id)}${rec.size_gb ? ` (${String(rec.size_gb)} GB)` : ''}.` : ''
    return new ApiError(409, `VoiceStudio has no speech-recognition (ASR) model installed. Ask the owner to install one in the VoiceStudio Web UI; agents do not install models.${hint}`, details)
  }
  if (code === 'model_licence_required' || reply.status === 403) {
    const models = Array.isArray(payload?.models) ? payload.models.map((m) => (isObj(m) ? String(m.repo_id ?? m.id ?? '') : String(m))).filter(Boolean) : []
    return new ApiError(
      409,
      `VoiceStudio needs its model licence accepted before it can do this${models.length ? ` (${models.join(', ')})` : ''}. The owner must read and accept the licence in the VoiceStudio Web UI; agents never accept licences.${message ? ` VoiceStudio said: ${clip(message, 200)}` : ''}`,
      details,
    )
  }
  if (code === 'argos_pack_missing') {
    const pairs = Array.isArray(payload?.pairs) ? JSON.stringify(payload.pairs) : ''
    return new ApiError(409, `The Argos translation language pack is not installed in VoiceStudio${pairs ? ` for ${pairs}` : ''}. Ask the owner to install that language pack in VoiceStudio, or retry with translation_provider "nllb" if that model is installed.`, details)
  }
  if (code === 'source_language_required') {
    return new ApiError(400, 'VoiceStudio could not detect the source language; pass source_language (an ISO code such as "en").', details)
  }
  if (reply.status === 401) {
    return new ApiError(502, 'VoiceStudio rejected the API key. The owner may have rotated it; retry in a moment, and if it persists restart the HyperFrames service.', details)
  }
  if (reply.status === 503 || reply.status === 429) {
    const wait = reply.headers['retry-after']
    return new ApiError(503, `VoiceStudio is busy or still loading a model${wait ? ` (retry after ${String(wait)} s)` : ''}. Try again shortly.${message ? ` ${clip(message, 200)}` : ''}`, details)
  }
  if (reply.status === 504) {
    return new ApiError(504, `VoiceStudio gave up on this request (its own time budget). Use shorter input.${message ? ` ${clip(message, 200)}` : ''}`, details)
  }
  if (reply.status === 404) return new ApiError(404, `VoiceStudio: not found${message ? ` (${clip(message, 200)})` : ''}`, details)
  const msg = message || `HTTP ${reply.status}`
  return new ApiError(reply.status >= 500 ? 502 : 400, `VoiceStudio refused the request: ${clip(msg)}`, details)
}

/** An SSE `error` event or failed job row, as an actionable ApiError. */
function streamError(data: unknown, fallback: string): ApiError {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? {})
  const status = isObj(data) && typeof data.status === 'number' ? data.status : isObj(data) && data.code === 'asr_model_missing' ? 409 : 500
  const err = vsError({ status, headers: {}, body: Buffer.from(text) })
  return err.message.endsWith('HTTP 500') ? new ApiError(502, `VoiceStudio failed: ${fallback}`) : err
}

const jsonOf = (reply: Reply): unknown => {
  try {
    return JSON.parse(reply.body.toString('utf8'))
  } catch {
    throw new ApiError(502, 'VoiceStudio returned a response that is not JSON')
  }
}

// ── Project path helpers ───────────────────────────────────────────────────

const audioExts = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac'])
const videoExts = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'])

async function projectFile(project: string, rel: string, field: string, exts: Set<string>): Promise<{ root: string; abs: string; size: number }> {
  if (typeof rel !== 'string' || !rel.trim()) throw badRequest(`${field} is required`)
  relativeOnly(rel, field)
  const root = await requireProject(project)
  const abs = await resolveInside(root, rel)
  if (!exts.has(extname(abs).toLowerCase())) throw badRequest(`${field} must be one of ${[...exts].join(', ')}`)
  const s = await stat(abs).catch(() => null)
  if (!s?.isFile()) throw notFound(`"${rel}" not found in project "${project}"`)
  return { root, abs, size: s.size }
}

async function outputPath(root: string, rel: string, field: string, ext?: string): Promise<string> {
  if (typeof rel !== 'string' || !rel.trim()) throw badRequest(`${field} must be a non-empty project-relative path`)
  relativeOnly(rel, field)
  const abs = await resolveInside(root, rel)
  if (abs === root) throw badRequest(`${field} must be a file path`)
  if (ext && extname(abs).toLowerCase() !== ext) throw badRequest(`${field} must end in ${ext}`)
  return abs
}

/** Write via a temp file beside the target so a failure never leaves a half file. */
async function viaTemp<T>(abs: string, fn: (partial: string) => Promise<T>): Promise<T> {
  await mkdir(dirname(abs), { recursive: true })
  const partial = `${abs}.${process.pid}-${Date.now()}.part`
  try {
    const out = await fn(partial)
    await rename(partial, abs)
    return out
  } catch (err) {
    await rm(partial, { force: true })
    throw err
  }
}

/** resolveInside quietly strips a leading slash; agents must send project-relative paths, so refuse absolute ones outright. */
function relativeOnly(value: string, field: string): void {
  if (/^([\\/]|[A-Za-z]:)/.test(value)) throw badRequest(`${field} must be a project-relative path, not an absolute one`)
}

const rel = (root: string, abs: string) => abs.slice(root.length + 1).split('\\').join('/')

function slug(s: string, max = 32): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '')
}

async function fileForm(field: string, abs: string, fields: Record<string, string | undefined>, extraFiles: Record<string, string> = {}): Promise<FormData> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, v)
  form.append(field, await openAsBlob(abs), basename(abs))
  for (const [k, p] of Object.entries(extraFiles)) form.append(k, await openAsBlob(p), basename(p))
  return form
}

const langCode = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/
function lang(value: unknown, field: string, optional = true): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined
    throw badRequest(`${field} is required`)
  }
  if (typeof value !== 'string' || (!langCode.test(value) && value !== 'Auto' && value !== 'auto')) throw badRequest(`${field} must be an ISO language code such as "en" or "es" (or "auto")`)
  return value
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`)
  if (value.length > max) throw badRequest(`${field} is longer than ${max} characters`)
  if (value.includes('\0')) throw badRequest(`${field} contains a NUL byte`)
  return value
}

function profileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw badRequest('voice must be a VoiceStudio profile id (see voicestudio_list_voices)')
  return value
}

// ── Status and voices ──────────────────────────────────────────────────────

const SHORT = 20_000

async function getJson(path: string, timeoutMs = SHORT): Promise<unknown> {
  return jsonOf(await send({ path, timeoutMs, retries: 0 }))
}

type ModelRow = { repo_id: string; role?: string; installed?: boolean; label?: string; license_acceptance?: { required?: boolean; accepted?: boolean; state?: string } }

export async function voicestudioStatus(): Promise<unknown> {
  if (!voicestudioConfigured()) return { configured: false, reachable: false, message: NOT_INSTALLED }
  const out: Obj = { configured: true, reachable: false }
  try {
    // /health is public and answers 503 {"status":"starting"} while VoiceStudio boots (main.py).
    const env = requireEnv()
    const key = await readKey(env)
    const reply = await requestOnce(env, key, { path: '/health', timeoutMs: 10_000 }, null, null).catch((e) => {
      throw netError(e, 10_000)
    })
    const health = jsonOf(reply) as Obj
    out.reachable = true
    out.health = health.status ?? null
    out.version = health.version ?? null
    out.device = health.device ?? null
    if (reply.status !== 200) {
      out.message = `VoiceStudio is starting${health.label ? `: ${String(health.label)}` : ''}. Try again in a few seconds.`
      return out
    }
  } catch (err) {
    if (err instanceof ApiError) out.message = err.message
    else throw err
    return out
  }
  const grab = async (path: string): Promise<Obj | null> => {
    try {
      const v = await getJson(path)
      return isObj(v) ? v : null
    } catch (err) {
      out.notes = [...((out.notes as string[] | undefined) ?? []), `${path}: ${err instanceof ApiError ? err.message : 'failed'}`]
      return null
    }
  }
  const [tts, asr, translation, models] = await Promise.all([grab('/engines/tts'), grab('/engines/asr'), grab('/engines/translation'), grab('/models')])
  const rows = (Array.isArray(models?.models) ? models.models : []) as ModelRow[]
  const installed = (role: string) => rows.filter((m) => m.role === role && m.installed).map((m) => m.repo_id)
  const licencePending = (role: string) =>
    rows.filter((m) => m.role === role && m.installed && m.license_acceptance?.required && !m.license_acceptance.accepted).map((m) => m.repo_id)
  const family = (payload: Obj | null, role: string) => {
    const backends = (Array.isArray(payload?.backends) ? payload.backends : []) as Obj[]
    const active = typeof payload?.active === 'string' ? payload.active : null
    const entry = backends.find((b) => b.id === active)
    return {
      active,
      activeAvailable: entry ? entry.available === true : null,
      reason: typeof entry?.reason === 'string' ? entry.reason : null,
      installedModels: installed(role),
      licenceNotAccepted: licencePending(role),
    }
  }
  const ttsF = family(tts, 'TTS')
  const asrF = family(asr, 'ASR')
  const engines = (Array.isArray(translation?.engines) ? translation.engines : []) as Obj[]
  const local = engines.filter((e) => e.id === 'argos' || e.id === 'nllb').map((e) => ({ id: e.id, ready: e.ready === true, reason: typeof e.availability_reason === 'string' ? e.availability_reason : null }))
  const nllbModel = installed('Translation')
  const speak = ttsF.activeAvailable === true && ttsF.installedModels.length > 0 && ttsF.licenceNotAccepted.length === 0
  const transcribe = asrF.activeAvailable !== false && asrF.installedModels.length > 0
  const translateReady = local.some((e) => e.ready)
  Object.assign(out, {
    tts: ttsF,
    asr: asrF,
    translation: { active: translation?.active ?? null, localEngines: local, installedModels: nllbModel },
    ready: { speak, transcribe, dub: speak && transcribe && translateReady },
    note: 'ready is an estimate from VoiceStudio\'s own listings. Argos also needs a language pack per language pair, which is only checked when a dub runs.',
  })
  return out
}

export async function listVoices(): Promise<unknown> {
  const rows = await getJson('/profiles')
  if (!Array.isArray(rows)) throw new ApiError(502, 'VoiceStudio returned an unexpected voice list')
  const voices = rows.filter(isObj).map((p) => ({ id: p.id, name: p.name, language: p.language ?? null, kind: p.kind ?? null }))
  return { count: voices.length, voices }
}

/** A saved profile by id; falls back to a unique case-insensitive name (profiles.py). */
async function resolveVoice(voice: string): Promise<{ id: string; name: string; language: string | null }> {
  const id = profileId(voice)
  try {
    const p = (await getJson(`/profiles/${encodeURIComponent(id)}`)) as Obj
    return { id: String(p.id), name: String(p.name ?? id), language: typeof p.language === 'string' ? p.language : null }
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err
  }
  const rows = (await getJson('/profiles')) as Obj[]
  const byName = Array.isArray(rows) ? rows.filter((p) => String(p.name).toLowerCase() === voice.toLowerCase()) : []
  if (byName.length === 1) return { id: String(byName[0].id), name: String(byName[0].name), language: typeof byName[0].language === 'string' ? byName[0].language : null }
  throw notFound(`voice "${voice}" is not a VoiceStudio profile id${byName.length > 1 ? ' (several profiles share that name)' : ''}; call voicestudio_list_voices`)
}

// ── Speak ──────────────────────────────────────────────────────────────────

export type SpeakInput = { project: string; text: string; voice: string; language?: string; speed?: number; output?: string; effect_preset?: string }

const GENERATE_TIMEOUT_MS = 30 * 60_000

/** PCM WAV duration from the RIFF header, used when X-Audio-Duration is absent. */
async function wavInfo(abs: string): Promise<{ riff: boolean; seconds: number | null }> {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const head = buf.subarray(0, bytesRead)
    if (head.length < 44 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return { riff: false, seconds: null }
    let p = 12
    let byteRate = 0
    while (p + 8 <= head.length) {
      const id = head.toString('latin1', p, p + 4)
      const size = head.readUInt32LE(p + 4)
      if (id === 'fmt ') byteRate = head.readUInt32LE(p + 16)
      if (id === 'data') {
        const total = (await stat(abs)).size
        const bytes = size === 0xffffffff || p + 8 + size > total ? total - (p + 8) : size
        return { riff: true, seconds: byteRate ? bytes / byteRate : null }
      }
      p += 8 + size + (size % 2)
    }
    return { riff: true, seconds: null }
  } finally {
    await fh.close()
  }
}

async function defaultSpeakPath(root: string, textValue: string): Promise<string> {
  const base = slug(textValue.split(/\s+/).slice(0, 4).join('-')) || 'narration'
  for (let n = 1; n < 10_000; n++) {
    const candidate = `assets/voice/${base}-${n}.wav`
    const abs = await resolveInside(root, candidate)
    if (!(await stat(abs).catch(() => null))) return candidate
  }
  throw new ApiError(409, 'assets/voice has too many files with this name; pass output')
}

export async function speak(input: SpeakInput): Promise<unknown> {
  requireEnv()
  const body = text(input.text, 'text', 200_000)
  const root = await requireProject(input.project)
  const language = lang(input.language, 'language')
  if (input.speed !== undefined && !(typeof input.speed === 'number' && input.speed >= 0.25 && input.speed <= 4)) throw badRequest('speed must be between 0.25 and 4')
  if (input.effect_preset !== undefined && !/^[a-z0-9_-]{1,32}$/.test(input.effect_preset)) throw badRequest('effect_preset is not valid')
  const relOut = input.output ?? (await defaultSpeakPath(root, body))
  const abs = await outputPath(root, relOut, 'output', '.wav')
  // /generate silently ignores an unknown profile_id, so verify it first (generation.py).
  const voice = await resolveVoice(input.voice)
  const reply = await viaTemp(abs, async (partial) => {
    const r = await send({
      method: 'POST',
      path: '/generate',
      timeoutMs: GENERATE_TIMEOUT_MS,
      sinkFile: partial,
      form: async () => {
        const f = new FormData()
        f.append('text', body)
        f.append('profile_id', voice.id)
        if (language) f.append('language', language)
        if (input.speed !== undefined) f.append('speed', String(input.speed))
        if (input.effect_preset) f.append('effect_preset', input.effect_preset)
        return f
      },
    })
    const info = await wavInfo(partial)
    if (!info.riff) throw new ApiError(502, 'VoiceStudio did not return WAV audio')
    return { r, info }
  })
  const s = await stat(abs)
  const header = Number(reply.r.headers['x-audio-duration'])
  const duration = Number.isFinite(header) && header > 0 ? header : reply.info.seconds
  return {
    path: relOut,
    duration: duration === null ? null : Math.round(duration * 1000) / 1000,
    size: s.size,
    voice: { id: voice.id, name: voice.name },
    audioId: reply.r.headers['x-audio-id'] ?? null,
    next: `Reference it in the composition, e.g. <audio id="narration" class="clip" src="${relOut}" data-start="0" data-track-index="2" data-volume="1"></audio>, then run lint.`,
  }
}

// ── Transcribe ─────────────────────────────────────────────────────────────

export type TranscribeInput = { project: string; input: string; language?: string; words?: boolean; output?: string; formats?: ('srt' | 'vtt')[] }

type Segment = { start: number; end: number; text: string }

const ts = (t: number, comma: boolean) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${comma ? ',' : '.'}${p(ms % 1000, 3)}`
}

export function cues(segments: Segment[], format: 'srt' | 'vtt'): string {
  const body = segments
    .filter((s) => s.text.trim())
    .map((s, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${ts(s.start, format === 'srt')} --> ${ts(s.end, format === 'srt')}\n${s.text.trim()}\n`)
    .join('\n')
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body
}

export async function transcribe(input: TranscribeInput): Promise<unknown> {
  requireEnv()
  const file = await projectFile(input.project, input.input, 'input', new Set([...audioExts, ...videoExts]))
  const language = lang(input.language, 'language')
  const words = input.words === true
  const formats = [...new Set(input.formats ?? [])]
  for (const f of formats) if (f !== 'srt' && f !== 'vtt') throw badRequest('formats may contain "srt" and "vtt"')
  const relInput = input.input.replace(/\\/g, '/').replace(/^\/+/, '')
  const stem = relInput.slice(0, relInput.length - extname(relInput).length)
  const relOut = input.output ?? `${stem}.transcript.json`
  const absOut = await outputPath(file.root, relOut, 'output', '.json')
  const outStem = relOut.replace(/\.json$/i, '')
  const wordsRel = `${outStem}.words.json`
  const sidecars = await Promise.all(formats.map(async (f) => ({ format: f, rel: `${outStem}.${f}`, abs: await outputPath(file.root, `${outStem}.${f}`, 'output') })))
  const wordsAbs = words ? await outputPath(file.root, wordsRel, 'output') : null

  // openai_compat.py: verbose_json always has segments; `words` only with timestamp_granularities=word.
  const reply = await send({
    method: 'POST',
    path: '/v1/audio/transcriptions',
    timeoutMs: 20 * 60_000,
    form: async () => {
      const f = await fileForm('file', file.abs, { model: 'whisper-1', response_format: 'verbose_json', language })
      f.append('timestamp_granularities[]', 'segment')
      if (words) f.append('timestamp_granularities[]', 'word')
      return f
    },
  })
  const data = jsonOf(reply) as Obj
  const segments = (Array.isArray(data.segments) ? data.segments : []).filter(isObj).map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text ?? '') }))
  const wordList = (Array.isArray(data.words) ? data.words : []).filter(isObj).map((w, i) => ({ id: `w${i}`, text: String(w.word ?? ''), start: Number(w.start), end: Number(w.end) }))
  const files: { path: string; kind: string; size: number }[] = []
  const put = async (abs: string, relPath: string, kind: string, content: string) => {
    await viaTemp(abs, (p) => writeFile(p, content))
    files.push({ path: relPath, kind, size: (await stat(abs)).size })
  }
  await put(absOut, relOut, 'voicestudio-verbose-json', JSON.stringify(data, null, 2))
  // HyperFrames caption shape: [{ id, text, start, end }] (hyperframes/references/captions.md).
  if (wordsAbs) await put(wordsAbs, wordsRel, 'hyperframes-words', JSON.stringify(wordList, null, 2))
  for (const s of sidecars) await put(s.abs, s.rel, s.format, cues(segments, s.format))
  const full = typeof data.text === 'string' ? data.text : segments.map((s) => s.text).join(' ')
  return {
    language: data.language ?? language ?? null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    segments: segments.length,
    ...(words ? { words: wordList.length } : {}),
    textPreview: clip(full.trim(), 240),
    textCharacters: full.length,
    files,
    note: 'The full transcript is in the files; read only the part you need. The words file matches the HyperFrames caption shape.',
  }
}

// ── Clone and design ───────────────────────────────────────────────────────

export type CloneInput = { project: string; reference: string; name: string; language?: string; reference_text?: string; consent?: 'own_voice' | 'speaker_permission' }

export async function cloneVoice(input: CloneInput): Promise<unknown> {
  requireEnv()
  const file = await projectFile(input.project, input.reference, 'reference', new Set([...audioExts, ...videoExts]))
  const name = text(input.name, 'name', 120).trim()
  const language = lang(input.language, 'language')
  const refText = input.reference_text === undefined ? undefined : text(input.reference_text, 'reference_text', 4000)
  if (input.consent !== undefined && input.consent !== 'own_voice' && input.consent !== 'speaker_permission') throw badRequest('consent must be own_voice or speaker_permission')
  // profiles.py create_profile: clone needs ref_audio; ref_text blank => best-effort local ASR.
  const reply = await send({
    method: 'POST',
    path: '/profiles',
    timeoutMs: 5 * 60_000,
    retries: 0,
    form: () => fileForm('ref_audio', file.abs, { name, kind: 'clone', language, ref_text: refText }),
  })
  const p = jsonOf(reply) as Obj
  if (typeof p.id !== 'string') throw new ApiError(502, 'VoiceStudio did not return a profile id')
  let consentRecorded = false
  if (input.consent) {
    await send({ method: 'POST', path: `/profiles/${encodeURIComponent(p.id)}/attestation`, json: { basis: input.consent }, timeoutMs: SHORT, retries: 0 })
    consentRecorded = true
  }
  return { id: p.id, name: p.name ?? name, kind: p.kind ?? 'clone', language: p.language ?? null, consentRecorded }
}

export type DesignInput = { description: string; name: string; language?: string }

export async function designVoice(input: DesignInput): Promise<unknown> {
  requireEnv()
  const description = text(input.description, 'description', 2000)
  const name = text(input.name, 'name', 120).trim()
  const language = lang(input.language, 'language') ?? 'Auto'
  // design_voice in mcp_server.py: describe, refuse when nothing matched, then POST /profiles kind=design.
  const map = jsonOf(await send({ method: 'POST', path: '/design/describe', json: { description }, timeoutMs: SHORT, retries: 0 })) as Obj
  const matched = Array.isArray(map.matched) ? map.matched : []
  if (!matched.length) {
    throw badRequest(
      'No supported voice trait was found in that description. VoiceStudio maps only gender, age, pitch, whisper style and English accents or Chinese dialects (for example "elderly female, low pitch, british accent"). For other timbres use voicestudio_clone_voice with a reference recording.',
      { unmatched: map.unmatched ?? [] },
    )
  }
  const created = jsonOf(
    await send({
      method: 'POST',
      path: '/profiles',
      timeoutMs: 10 * 60_000,
      retries: 0,
      form: async () => {
        const f = new FormData()
        f.append('name', name)
        f.append('kind', 'design')
        f.append('vd_states', JSON.stringify(map.attrs ?? {}))
        f.append('instruct', String(map.instruct ?? ''))
        f.append('language', language)
        return f
      },
    }),
  ) as Obj
  if (typeof created.id !== 'string') throw new ApiError(502, 'VoiceStudio did not return a profile id')
  // The identity sample renders lazily when the model was not resident at save (profiles.py): trigger it once.
  let sampleReady = Boolean(created.audio_url)
  if (!sampleReady) {
    try {
      await send({ path: `/profiles/${encodeURIComponent(created.id)}/audio`, timeoutMs: 10 * 60_000, retries: 0, maxBodyBytes: 256 * 1024 * 1024 })
      sampleReady = true
    } catch {
      /* the profile is saved; the sample renders on first use */
    }
  }
  return { id: created.id, name: created.name ?? name, kind: 'design', attrs: map.attrs ?? {}, instruct: map.instruct ?? '', unmatched: map.unmatched ?? [], sampleReady }
}

// ── Dubbing jobs ───────────────────────────────────────────────────────────

/** Providers that run on the server. Cloud providers (google, deepl, ...) are never allowed. */
export const localProviders = ['argos', 'nllb'] as const
export const dubOutputs = ['video', 'audio', 'srt'] as const
export const timingStrategies = ['concise', 'smart_fit', 'stretch_video', 'strict_slot'] as const
export type DubOutput = (typeof dubOutputs)[number]

export type DubInput = {
  project: string
  input: string
  target_language: string
  translation_provider?: (typeof localProviders)[number]
  voice?: string
  outputs?: DubOutput[]
  source_language?: string
  output_dir?: string
  timing_strategy?: (typeof timingStrategies)[number]
}

export type DubJob = {
  id: string
  kind: 'dub'
  project: string
  status: JobStatus
  stage: string
  request: Required<Pick<DubInput, 'input' | 'target_language' | 'translation_provider' | 'voice' | 'outputs' | 'output_dir' | 'timing_strategy'>> & { source_language: string | null }
  outputs: { kind: DubOutput; path: string; size: number }[]
  warnings: string[]
  voicestudio: { jobId: string | null; taskId: string | null }
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

const dubs = new Map<string, DubJob>()
const aborters = new Map<string, AbortController>()
let chain: Promise<unknown> = Promise.resolve()

const dubDir = () => join(config.stateDir, 'voicestudio-jobs')
const pollMs = () => Math.max(10, Number(process.env.VOICESTUDIO_POLL_MS) || 3000)

async function persist(job: DubJob): Promise<void> {
  await mkdir(dubDir(), { recursive: true })
  const tmp = join(dubDir(), `${job.id}.json.tmp`)
  await writeFile(tmp, JSON.stringify(job, null, 2))
  await rename(tmp, join(dubDir(), `${job.id}.json`))
}

/** Dub jobs left by a previous process are interrupted: VoiceStudio's side may have finished, ours cannot resume. */
export async function loadDubJobs(): Promise<void> {
  const files = await readdir(dubDir()).catch(() => [])
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const job = JSON.parse(await readFile(join(dubDir(), f), 'utf8')) as DubJob
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'interrupted'
        job.finishedAt = new Date().toISOString()
        job.error = 'the service restarted while this dub was active; submit it again'
        await persist(job)
      }
      dubs.set(job.id, job)
    } catch {
      /* skip a corrupt record */
    }
  }
}

export async function submitDub(input: DubInput): Promise<DubJob> {
  requireEnv()
  const file = await projectFile(input.project, input.input, 'input', new Set([...audioExts, ...videoExts]))
  const isVideo = videoExts.has(extname(file.abs).toLowerCase())
  const target = lang(input.target_language, 'target_language', false) as string
  if (target.toLowerCase() === 'auto') throw badRequest('target_language must be a concrete language code')
  const provider = input.translation_provider ?? 'argos'
  if (!localProviders.includes(provider)) throw badRequest(`translation_provider must be one of ${localProviders.join(', ')}; cloud providers are not allowed because they send the text to third parties`)
  const outputs = [...new Set(input.outputs ?? (isVideo ? ['video', 'srt'] : ['audio', 'srt']))] as DubOutput[]
  if (!outputs.length || outputs.some((o) => !dubOutputs.includes(o))) throw badRequest(`outputs may contain ${dubOutputs.join(', ')}`)
  if (outputs.includes('video') && !isVideo) throw badRequest('a dubbed video needs a video input; ask for "audio" instead')
  const voice = input.voice ?? 'clone-original'
  if (voice !== 'clone-original') profileId(voice)
  const strategy = input.timing_strategy ?? 'smart_fit'
  if (!timingStrategies.includes(strategy)) throw badRequest(`timing_strategy must be one of ${timingStrategies.join(', ')}`)
  const outputDir = (input.output_dir ?? 'assets/dub').replace(/\\/g, '/').replace(/\/+$/, '')
  const stem = slug(basename(file.abs, extname(file.abs)), 80) || 'dub'
  const sourceLanguage = lang(input.source_language, 'source_language') ?? null
  // Validate every destination now so a bad path fails the call, not the job.
  for (const o of outputs) await outputPath(file.root, dubPath(outputDir, stem, target, o), 'output_dir')
  const job: DubJob = {
    id: randomUUID(),
    kind: 'dub',
    project: input.project,
    status: 'queued',
    stage: 'queued',
    request: { input: input.input, target_language: target, translation_provider: provider, voice, outputs, output_dir: outputDir, timing_strategy: strategy, source_language: sourceLanguage },
    outputs: [],
    warnings: [],
    voicestudio: { jobId: null, taskId: null },
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
  }
  dubs.set(job.id, job)
  await persist(job)
  // VoiceStudio has one serial worker, so our dubs run one at a time too.
  chain = chain.then(() => runDub(job)).catch(() => undefined)
  return job
}

const dubExt: Record<DubOutput, string> = { video: 'mp4', audio: 'wav', srt: 'srt' }
const dubPath = (dir: string, stem: string, target: string, kind: DubOutput) => `${dir}/${stem}.${target.toLowerCase()}.${dubExt[kind]}`

class Cancelled extends Error {}

/** Poll a VoiceStudio task row (`GET /jobs/<task id>`, dub_export.py) until it ends. */
async function waitTask(job: DubJob, taskId: string, signal: AbortSignal, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal.aborted) throw new Cancelled()
    const row = (await send({ path: `/jobs/${encodeURIComponent(taskId)}`, timeoutMs: SHORT, signal, retries: 5 }).then(jsonOf)) as Obj
    const status = String(row.status ?? '')
    if (status === 'done') return
    if (status === 'failed' || status === 'cancelled') {
      throw streamError(typeof row.error === 'string' ? safeJson(row.error) : row.error, String(row.error ?? status))
    }
    if (Date.now() > deadline) throw new ApiError(504, `VoiceStudio task ${taskId} did not finish in time`)
    job.stage = `${job.stage.split(' (')[0]} (${status || 'waiting'})`
    await sleep(pollMs(), signal).catch(() => {
      throw new Cancelled()
    })
  }
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** Parse the `final` event of GET /dub/transcribe-stream/<job> (dub_core.py). */
async function transcribeStream(jobId: string, signal: AbortSignal): Promise<Obj> {
  let buffer = ''
  let final: Obj | null = null
  let failure: unknown = null
  const onBlock = (block: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    const parsed = safeJson(data.join('\n'))
    if (event === 'final' && isObj(parsed)) final = parsed
    else if (event === 'error') failure = parsed
  }
  await send({
    path: `/dub/transcribe-stream/${encodeURIComponent(jobId)}`,
    query: { per_segment_refs: 'true' },
    timeoutMs: 2 * 60 * 60_000,
    signal,
    retries: 2,
    onData: (chunk) => {
      buffer += chunk.toString('utf8')
      let i: number
      while ((i = buffer.search(/\r?\n\r?\n/)) >= 0) {
        onBlock(buffer.slice(0, i))
        buffer = buffer.slice(i).replace(/^\r?\n\r?\n/, '')
      }
    },
  })
  if (buffer.trim()) onBlock(buffer)
  if (failure) throw streamError(failure, 'transcription failed')
  if (!final) throw new ApiError(502, 'VoiceStudio ended the transcription without a result')
  return final
}

async function download(job: DubJob, root: string, kind: DubOutput, jobId: string, target: string, signal: AbortSignal): Promise<void> {
  const stem = slug(basename(job.request.input, extname(job.request.input)), 80) || 'dub'
  const relPath = dubPath(job.request.output_dir, stem, target, kind)
  const abs = await outputPath(root, relPath, 'output_dir')
  const common = { timeoutMs: 30 * 60_000, signal, retries: 2 }
  await viaTemp(abs, async (partial) => {
    if (kind === 'video') {
      // dub_export.py: synchronous ffmpeg mux of the original with the dubbed track.
      await send({ ...common, path: `/dub/download/${encodeURIComponent(jobId)}`, query: { include_tracks: target, default_track: target, preserve_bg: 'true', burn_subs: 'false' }, sinkFile: partial })
    } else if (kind === 'audio') {
      await send({ ...common, path: `/dub/download-audio/${encodeURIComponent(jobId)}`, query: { lang: target, preserve_bg: 'true' }, sinkFile: partial })
    } else {
      await send({ ...common, path: `/dub/srt/${encodeURIComponent(jobId)}`, query: { lang: target }, sinkFile: partial })
    }
  })
  job.outputs.push({ kind, path: relPath, size: (await stat(abs)).size })
}

async function runDub(job: DubJob): Promise<void> {
  if (job.status !== 'queued') return
  const ctl = new AbortController()
  aborters.set(job.id, ctl)
  const { signal } = ctl
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  try {
    await persist(job)
    const req = job.request
    const file = await projectFile(job.project, req.input, 'input', new Set([...audioExts, ...videoExts]))
    const isVideo = videoExts.has(extname(file.abs).toLowerCase())
    const target = req.target_language
    // Resolve the chosen voice before spending GPU time (profile ids are not validated by /dub/generate).
    const voiceId = req.voice === 'clone-original' ? null : (await resolveVoice(req.voice)).id

    job.stage = 'upload'
    await persist(job)
    const up = jsonOf(
      await send({
        method: 'POST',
        path: '/dub/upload',
        timeoutMs: 60 * 60_000,
        signal,
        retries: 1,
        // dub_core.py: the file field is literally `video`, audio files are accepted with input_type=audio.
        form: () => fileForm('video', file.abs, { input_type: isVideo ? 'video' : 'audio', source_lang: req.source_language ?? undefined }),
      }),
    ) as Obj
    const vsJob = String(up.job_id ?? '')
    const prepTask = String(up.task_id ?? '')
    if (!vsJob || !prepTask) throw new ApiError(502, 'VoiceStudio did not return a dub job id')
    job.voicestudio = { jobId: vsJob, taskId: prepTask }

    job.stage = 'prep'
    await persist(job)
    await waitTask(job, prepTask, signal, 30 * 60_000)

    job.stage = 'transcribe'
    await persist(job)
    const final = await transcribeStream(vsJob, signal)
    const source = (Array.isArray(final.segments) ? final.segments : []).filter(isObj)
    if (!source.length) throw new ApiError(422, 'VoiceStudio found no speech in the input, so there is nothing to dub')
    const sourceLang = (typeof final.source_lang === 'string' && final.source_lang) || req.source_language || undefined

    job.stage = 'translate'
    await persist(job)
    const tr = jsonOf(
      await send({
        method: 'POST',
        path: '/dub/translate',
        timeoutMs: 30 * 60_000,
        signal,
        retries: 2,
        // Always explicit: VoiceStudio's own default provider is Google (cloud) (dub_translate.py).
        json: {
          job_id: vsJob,
          target_lang: target,
          ...(sourceLang ? { source_lang: sourceLang } : {}),
          provider: req.translation_provider,
          quality: 'fast',
          segments: source.map((s) => ({ id: s.id, text: String(s.text ?? ''), start: s.start, end: s.end })),
        },
      }),
    ) as Obj
    const translated = new Map<string, Obj>()
    for (const t of (Array.isArray(tr.translated) ? tr.translated : []).filter(isObj)) translated.set(String(t.id), t)
    const failed = source.filter((s) => translated.get(String(s.id))?.error || !translated.has(String(s.id))).length
    if (failed === source.length) throw new ApiError(502, 'VoiceStudio could not translate any segment')
    if (failed) job.warnings.push(`${failed} of ${source.length} segments could not be translated and keep the source text`)
    const noVoice = voiceId === null ? source.filter((s) => !s.profile_id).length : 0
    if (noVoice) job.warnings.push(`${noVoice} segments had no extractable original voice and use VoiceStudio's default voice`)

    job.stage = 'generate'
    await persist(job)
    const gen = jsonOf(
      await send({
        method: 'POST',
        path: `/dub/generate/${encodeURIComponent(vsJob)}`,
        timeoutMs: SHORT,
        signal,
        retries: 5,
        json: {
          language: target,
          language_code: target.toLowerCase(),
          timing_strategy: req.timing_strategy,
          ...(voiceId === null ? { voice_match: 'consistent' } : {}),
          segments: source.map((s) => ({
            start: s.start,
            end: s.end,
            text: String(translated.get(String(s.id))?.text ?? s.text ?? ''),
            profile_id: voiceId ?? (typeof s.profile_id === 'string' ? s.profile_id : ''),
            target_lang: target,
          })),
        },
      }),
    ) as Obj
    const genTask = String(gen.task_id ?? '')
    if (!genTask) throw new ApiError(502, 'VoiceStudio did not return a render task id')
    job.voicestudio.taskId = genTask
    await persist(job)
    await waitTask(job, genTask, signal, 4 * 60 * 60_000)

    for (const kind of req.outputs) {
      job.stage = `download ${kind}`
      await persist(job)
      await download(job, file.root, kind, vsJob, target, signal)
    }
    job.status = signal.aborted ? 'cancelled' : 'succeeded'
    job.stage = 'done'
  } catch (err) {
    if (err instanceof Cancelled || signal.aborted) {
      job.status = 'cancelled'
      job.error = 'cancelled by request'
    } else {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
    }
  } finally {
    aborters.delete(job.id)
    job.finishedAt = new Date().toISOString()
    await persist(job).catch(() => undefined)
  }
}

export function getDub(id: string): DubJob {
  const job = dubs.get(id)
  if (!job) throw notFound(`dub job "${id}" not found`)
  return job
}

export function listDubs(project?: string): DubJob[] {
  return [...dubs.values()].filter((j) => !project || j.project === project).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function cancelDub(id: string): Promise<DubJob> {
  const job = getDub(id)
  if (job.status === 'queued') {
    job.status = 'cancelled'
    job.finishedAt = new Date().toISOString()
    await persist(job)
  } else if (job.status === 'running') {
    const taskId = job.voicestudio.taskId
    aborters.get(id)?.abort()
    job.status = 'cancelled'
    job.error = 'cancelled by request'
    // Best effort: stop the work on VoiceStudio's side too (dub_export.py POST /tasks/cancel/<id>).
    if (taskId) await send({ method: 'POST', path: `/tasks/cancel/${encodeURIComponent(taskId)}`, timeoutMs: 10_000, retries: 0 }).catch(() => undefined)
    await persist(job)
  }
  return job
}
