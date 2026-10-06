import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { requireProject } from './projects.js'
import { badRequest, notFound } from './util/errors.js'
import { resolveInside } from './util/paths.js'

export type FileEntry = {
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.hf-tmp'])
const MAX_ENTRIES = 5000
export const MAX_TEXT_READ = 4 * 1024 * 1024
export const MAX_WRITE = 256 * 1024 * 1024

const mimeByExt: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.cube': 'text/plain; charset=utf-8',
  '.lottie': 'application/zip',
}

export function mimeFor(path: string): string {
  return mimeByExt[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('svg') || mime.includes('mpegurl')
}

export async function listFiles(project: string, subpath = ''): Promise<FileEntry[]> {
  const root = await requireProject(project)
  const start = await resolveInside(root, subpath)
  const out: FileEntry[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_ENTRIES) return
      if (SKIP_DIRS.has(e.name)) continue
      const abs = join(dir, e.name)
      const s = await stat(abs).catch(() => null)
      if (!s) continue
      const rel = relative(root, abs).split('\\').join('/')
      if (e.isDirectory()) {
        out.push({ path: rel, type: 'directory', size: 0, modifiedAt: s.mtime.toISOString() })
        await walk(abs)
      } else if (e.isFile()) {
        out.push({ path: rel, type: 'file', size: s.size, modifiedAt: s.mtime.toISOString() })
      }
    }
  }
  const s = await stat(start).catch(() => null)
  if (!s) throw notFound(`"${subpath}" not found`)
  if (s.isFile()) {
    return [{ path: relative(root, start), type: 'file', size: s.size, modifiedAt: s.mtime.toISOString() }]
  }
  await walk(start)
  return out
}

export type ReadResult =
  | { path: string; encoding: 'utf8'; mime: string; size: number; content: string }
  | { path: string; encoding: 'base64'; mime: string; size: number; content: string }

export async function readProjectFile(project: string, path: string): Promise<ReadResult> {
  const root = await requireProject(project)
  const abs = await resolveInside(root, path)
  const s = await stat(abs).catch(() => null)
  if (!s || !s.isFile()) throw notFound(`"${path}" not found`)
  if (s.size > MAX_TEXT_READ) {
    throw badRequest(`"${path}" is ${s.size} bytes; download it over the files endpoint instead`)
  }
  const buffer = await readFile(abs)
  const mime = mimeFor(abs)
  const looksBinary = buffer.subarray(0, 8000).includes(0)
  if (isTextMime(mime) && !looksBinary) {
    return { path, encoding: 'utf8', mime, size: s.size, content: buffer.toString('utf8') }
  }
  return { path, encoding: 'base64', mime, size: s.size, content: buffer.toString('base64') }
}

export async function absoluteFile(project: string, path: string): Promise<{ abs: string; size: number; mime: string }> {
  const root = await requireProject(project)
  const abs = await resolveInside(root, path)
  const s = await stat(abs).catch(() => null)
  if (!s || !s.isFile()) throw notFound(`"${path}" not found`)
  return { abs, size: s.size, mime: mimeFor(abs) }
}

export function streamFile(abs: string) {
  return createReadStream(abs)
}

export async function writeProjectFile(
  project: string,
  path: string,
  data: Buffer | string,
): Promise<FileEntry> {
  const root = await requireProject(project)
  const abs = await resolveInside(root, path)
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  if (buffer.length > MAX_WRITE) throw badRequest(`file exceeds ${MAX_WRITE} bytes`)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, buffer)
  const s = await stat(abs)
  return { path, type: 'file', size: s.size, modifiedAt: s.mtime.toISOString() }
}

export async function deleteProjectPath(project: string, path: string): Promise<void> {
  const root = await requireProject(project)
  const abs = await resolveInside(root, path)
  if (abs === root) throw badRequest('refusing to delete the project root; use delete_project')
  const s = await stat(abs).catch(() => null)
  if (!s) throw notFound(`"${path}" not found`)
  await rm(abs, { recursive: true, force: true })
}

const MAX_FETCH = 512 * 1024 * 1024

/** Download an http(s) URL into the project, for agents that cannot upload bytes themselves. */
export async function fetchIntoProject(project: string, url: string, path: string): Promise<FileEntry> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw badRequest('url is not valid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw badRequest('url must be http or https')
  const res = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw badRequest(`fetch failed with HTTP ${res.status}`)
  const length = Number(res.headers.get('content-length') ?? '0')
  if (length > MAX_FETCH) throw badRequest(`remote file exceeds ${MAX_FETCH} bytes`)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_FETCH) throw badRequest(`remote file exceeds ${MAX_FETCH} bytes`)
  return writeProjectFile(project, path, buffer)
}
