import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { badRequest } from './errors.js'

/**
 * Resolve `rel` inside `root` and refuse anything that escapes it. The lexical
 * check runs first; when the parent exists, its real path must also stay inside
 * `root`, so a symlink planted in a project cannot point outside it.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  if (typeof rel !== 'string') throw badRequest('path must be a string')
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (cleaned.includes('\0')) throw badRequest('path contains a NUL byte')
  if (isAbsolute(cleaned)) throw badRequest('path must be relative to the project')
  const normalized = normalize(cleaned)
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.startsWith('../')) {
    throw badRequest('path escapes the project directory')
  }
  const absolute = resolve(root, normalized)
  const relToRoot = relative(root, absolute)
  if (relToRoot.startsWith('..') || isAbsolute(relToRoot)) {
    throw badRequest('path escapes the project directory')
  }
  // Walk up to the nearest existing ancestor and check its real location.
  let probe = absolute
  for (;;) {
    try {
      const real = await realpath(probe)
      const rootReal = await realpath(root)
      const relReal = relative(rootReal, real)
      if (relReal.startsWith('..') || isAbsolute(relReal)) {
        throw badRequest('path resolves outside the project directory')
      }
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  return absolute
}

export const projectNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function assertProjectName(name: string): string {
  if (!projectNamePattern.test(name)) {
    throw badRequest(
      'project name must be 1-64 characters of lowercase letters, digits, "_" or "-", and start with a letter or digit',
    )
  }
  return name
}
