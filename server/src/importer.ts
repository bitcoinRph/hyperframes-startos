import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { config } from './config.js'
import { type ProjectSummary, projectDir, summarize } from './projects.js'
import { ApiError, badRequest, conflict } from './util/errors.js'
import { type HostResolver, downloadToBuffer, downloadToFile } from './util/net.js'
import { assertProjectName, resolveInside } from './util/paths.js'

/**
 * Imports a directory of a public GitHub repository as a project, for example
 * one of HeyGen's launch films (heygen-com/hyperframes-launches). Text files
 * come from the raw host. Files stored in Git LFS come back from the raw host
 * as a small pointer, so those are fetched again from GitHub's media host,
 * which serves the real bytes. Every download goes through the public-host
 * policy in util/net.ts.
 */

export type ImportOptions = {
  name: string
  /** `owner/repo` */
  repo: string
  /** Directory inside the repository; empty imports the whole tree. */
  path?: string
  /** Branch, tag or commit; default `main`. */
  ref?: string
}

export type ImportHosts = { api: string; raw: string; media: string }

export type ImportInternals = {
  hosts?: ImportHosts
  resolveHost?: HostResolver
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
}

export type ImportResult = ProjectSummary & {
  source: { repo: string; ref: string; path: string; commit: string | null }
  files: number
  lfsFiles: number
  bytes: number
}

const defaultHosts: ImportHosts = {
  api: 'https://api.github.com',
  raw: 'https://raw.githubusercontent.com',
  media: 'https://media.githubusercontent.com/media',
}

type TreeEntry = { path: string; type: string; size?: number }
type Tree = { sha?: string; tree: TreeEntry[]; truncated?: boolean }

const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'

function parseLfsPointer(buffer: Buffer): { size: number } | null {
  if (buffer.length > 1024 || !buffer.subarray(0, LFS_POINTER_PREFIX.length).equals(Buffer.from(LFS_POINTER_PREFIX))) return null
  const m = buffer.toString('utf8').match(/^size (\d+)$/m)
  return m ? { size: Number(m[1]) } : null
}

function validate(options: ImportOptions): { name: string; repo: string; path: string; ref: string } {
  const name = assertProjectName(options.name)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo) || options.repo.includes('..')) throw badRequest('repo must be owner/name')
  const path = (options.path ?? '').replace(/^\/+|\/+$/g, '')
  if (path.split('/').some((seg) => seg === '..' || seg === '.') || /[\\\0]/.test(path)) throw badRequest('path must be a directory inside the repository')
  const ref = options.ref ?? 'main'
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,120}$/.test(ref) || ref.includes('..')) throw badRequest('ref must be a branch, tag or commit')
  return { name, repo: options.repo, path, ref }
}

export async function importProject(options: ImportOptions, internals: ImportInternals = {}): Promise<ImportResult> {
  const { name, repo, path, ref } = validate(options)
  const hosts = internals.hosts ?? defaultHosts
  const resolveHost = internals.resolveHost
  const maxFiles = internals.maxFiles ?? 2000
  const maxFileBytes = internals.maxFileBytes ?? 512 * 1024 * 1024
  const maxTotalBytes = internals.maxTotalBytes ?? 2 * 1024 * 1024 * 1024

  await mkdir(config.projectsDir, { recursive: true })
  const dir = projectDir(name)
  if (await stat(dir).then(() => true, () => false)) throw conflict(`project "${name}" already exists`)

  const treeUrl = new URL(`${hosts.api}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  const treeRes = await downloadToBuffer(treeUrl, {
    maxBytes: 32 * 1024 * 1024,
    timeoutMs: 60_000,
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    resolveHost,
  })
  let tree: Tree
  try {
    tree = JSON.parse(treeRes.buffer.toString('utf8')) as Tree
  } catch {
    throw new ApiError(502, 'GitHub returned an unreadable tree')
  }
  if (!Array.isArray(tree.tree)) throw new ApiError(502, 'GitHub returned no tree', { ref, repo })
  if (tree.truncated) throw badRequest('the repository tree is too large to import; choose a deeper path')

  const prefix = path ? `${path}/` : ''
  const blobs = tree.tree.filter((e) => e.type === 'blob' && (prefix === '' || e.path.startsWith(prefix)))
  if (blobs.length === 0) throw badRequest(`"${path || '/'}" holds no files at ${ref}`)
  if (blobs.length > maxFiles) throw badRequest(`"${path || '/'}" holds ${blobs.length} files; the limit is ${maxFiles}`)
  if (!blobs.some((b) => b.path === `${prefix}index.html`)) {
    throw badRequest(`"${path || '/'}" has no index.html at its root; import the directory that holds the composition`)
  }

  await mkdir(dir, { recursive: true })
  let bytes = 0
  let lfsFiles = 0
  try {
    const queue = [...blobs]
    let failed = false
    const worker = async () => {
      for (let entry = queue.shift(); entry && !failed; entry = queue.shift()) {
        const rel = entry.path.slice(prefix.length)
        const abs = await resolveInside(dir, rel)
        await mkdir(dirname(abs), { recursive: true })
        const partial = `${abs}.${process.pid}.part`
        const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
        const rawUrl = new URL(`${hosts.raw}/${repo}/${ref}/${encoded}`)
        const got = await downloadToFile(rawUrl, partial, { maxBytes: maxFileBytes, timeoutMs: 10 * 60_000, resolveHost })
        let size = got.bytes
        if (size <= 1024) {
          const pointer = parseLfsPointer(await readFile(partial))
          if (pointer) {
            if (pointer.size > maxFileBytes) throw badRequest(`${entry.path} is ${pointer.size} bytes; the per-file limit is ${maxFileBytes}`)
            const mediaUrl = new URL(`${hosts.media}/${repo}/${ref}/${encoded}`)
            size = (await downloadToFile(mediaUrl, partial, { maxBytes: maxFileBytes, timeoutMs: 20 * 60_000, resolveHost })).bytes
            lfsFiles++
          }
        }
        bytes += size
        if (bytes > maxTotalBytes) throw badRequest(`import exceeds ${maxTotalBytes} bytes in total`)
        await rename(partial, abs)
      }
    }
    await Promise.all(Array.from({ length: 4 }, () => worker().catch((err) => { failed = true; throw err })))
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }

  return {
    ...(await summarize(name)),
    source: { repo, ref, path, commit: typeof tree.sha === 'string' ? tree.sha : null },
    files: blobs.length,
    lfsFiles,
    bytes,
  }
}
