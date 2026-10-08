import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { config } from './config.js'
import { notFound } from './util/errors.js'
import { resolveInside } from './util/paths.js'

export type SkillSummary = {
  name: string
  description: string
  source: string
  files: number
}

type Located = { name: string; dir: string; source: string }

async function locate(): Promise<Located[]> {
  const found = new Map<string, Located>()
  for (const base of config.skillsDirs) {
    const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const skillFile = join(base, e.name, 'SKILL.md')
      const ok = await stat(skillFile).then((s) => s.isFile(), () => false)
      if (!ok || found.has(e.name)) continue
      found.set(e.name, { name: e.name, dir: join(base, e.name), source: base })
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The `description:` of a SKILL.md frontmatter as one line: plain, folded (`>`) or literal (`|`) YAML scalars. */
export function frontmatterDescription(markdown: string): string {
  const m = markdown.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return ''
  const fm = m[1]
  // The block ends at the next unindented line (the next key) or at the end of the frontmatter.
  const desc = fm.match(/^description:\s*[>|]?-?\s*\n?([\s\S]*?)(?=\n\S|$(?![\s\S]))/m)
  if (!desc) return ''
  return desc[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^["']|["']$/g, '')
}

async function countFiles(dir: string): Promise<number> {
  let n = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.isDirectory()) n += await countFiles(join(dir, e.name))
    else n++
  }
  return n
}

export async function listSkills(): Promise<SkillSummary[]> {
  const out: SkillSummary[] = []
  for (const s of await locate()) {
    const md = await readFile(join(s.dir, 'SKILL.md'), 'utf8').catch(() => '')
    out.push({
      name: s.name,
      description: frontmatterDescription(md),
      source: s.source,
      files: await countFiles(s.dir),
    })
  }
  return out
}

export async function skillFiles(name: string): Promise<string[]> {
  const skill = (await locate()).find((s) => s.name === name)
  if (!skill) throw notFound(`skill "${name}" not found`)
  const files: string[] = []
  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else files.push(relative(skill!.dir, abs).split('\\').join('/'))
    }
  }
  await walk(skill.dir)
  return files.sort()
}

export async function readSkillFile(name: string, path = 'SKILL.md'): Promise<{ abs: string; path: string }> {
  const skill = (await locate()).find((s) => s.name === name)
  if (!skill) throw notFound(`skill "${name}" not found`)
  const abs = await resolveInside(skill.dir, path)
  const ok = await stat(abs).then((s) => s.isFile(), () => false)
  if (!ok) throw notFound(`"${path}" not found in skill "${name}"`)
  return { abs, path }
}
