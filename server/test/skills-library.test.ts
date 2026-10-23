import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const community = ['camera-3d-captions', 'day-in-my-life', 'duo', 'p5-paint-animation', 'prod-by-claude', 'session-story', 'vox-explainer', 'x-posting-license']
const adapted = ['day-in-my-life', 'session-story']

async function files(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + e.name
    if (e.isDirectory()) out.push(...await files(join(dir, e.name), name + '/'))
    else out.push(name)
  }
  return out.sort()
}

test('Docker skill assembly serves every current upstream/wrapper skill, all eight community skills, complete assets and documented overlays through REST/MCP', async () => {
  const image = await mkdtemp(join(tmpdir(), 'hf-skills-image-'))
  try {
    const docker = await readFile(join(repo, 'Dockerfile'), 'utf8')
    const ignore = await readFile(join(repo, '.dockerignore'), 'utf8')
    assert.ok(ignore.includes('!community-adaptations/*.SKILL.md'))
    const copies = docker.split('\n').filter(l => /^COPY (hyperframes\/(skills|LICENSE)|skills |community-skills\/|community-adaptations\/|heygen-skills\/)/.test(l))
    assert.ok(copies.includes('COPY community-skills/skills /opt/hyperframes-community/skills'))
    for (const line of copies) {
      const [, source, dest] = line.split(/\s+/)
      const target = join(image, dest)
      await cp(join(repo, source), target, { recursive: true })
    }
    const roots = docker.match(/^ENV HF_SKILLS_DIRS=(.+)$/m)![1].split(':').map(p => join(image, p))
    assert.equal(roots.length, 4)
    const names: string[] = []
    for (const root of roots) {
      for (const e of await readdir(root, { withFileTypes: true })) {
        if (e.isDirectory()) {
          const md = await readFile(join(root, e.name, 'SKILL.md'), 'utf8')
          assert.equal(md.match(/^name:\s*(.+)$/m)?.[1].trim(), e.name)
          names.push(e.name)
        }
      }
    }
    const expected: string[] = []
    for (const source of ['hyperframes/skills', 'skills', 'community-skills/skills', 'heygen-skills/skills']) {
      for (const entry of await readdir(join(repo, source), { withFileTypes: true })) {
        if (entry.isDirectory()) {
          await readFile(join(repo, source, entry.name, 'SKILL.md'))
          expected.push(entry.name)
        }
      }
    }
    assert.deepEqual([...names].sort(), expected.sort())
    const official = ['figma', 'hyperframes', 'hyperframes-cli', 'hyperframes-registry', 'media-use', 'remotion-to-hyperframes', 'slideshow']
    assert.deepEqual((await readdir(join(repo, 'hyperframes/skills'), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort(), official)
    for (const name of official) {
      const source = join(repo, 'hyperframes/skills', name)
      const bundled = join(image, '/opt/hyperframes/skills', name)
      assert.deepEqual(await files(bundled), await files(source))
      for (const path of await files(source)) {
        assert.deepEqual(await readFile(join(bundled, path)), await readFile(join(source, path)), `official skill file changed or missing: ${name}/${path}`)
      }
    }
    assert.equal(new Set(names).size, names.length, 'Duplicate skills must not be hidden by server precedence')
    const builtCommunity = join(image, '/opt/hyperframes-community/skills')
    assert.deepEqual((await readdir(builtCommunity)).sort(), community)
    for (const name of community) {
      const original = join(repo, 'community-skills/skills', name)
      const packed = join(builtCommunity, name)
      const inventory = await files(original)
      assert.deepEqual(await files(packed), inventory)
      for (const file of inventory) {
        const source = await readFile(join(original, file))
        const target = await readFile(join(packed, file))
        if (file === 'SKILL.md' && adapted.includes(name)) {
          const md = target.toString()
          assert.ok(md.includes('Never auto-run `harvest.py`'))
          assert.ok(md.includes('explicit approval before stills'))
          assert.ok(md.includes('--describe false'))
          assert.equal(md.replace(/## StartOS \/ Hermes deployment rules \(local adaptation\)[\s\S]*?(?=## When to use \/ when not)/, ''), source.toString())
        } else assert.deepEqual(target, source, `${name}/${file} changed unexpectedly`)
      }
    }
    assert.deepEqual(await readFile(join(image, '/opt/hyperframes-community/LICENSE')), await readFile(join(repo, 'community-skills/LICENSE')))
    process.env.HF_SKILLS_DIRS = roots.join(':')
    process.env.HF_API_KEY = 'local-library-test-only'
    const { createApp } = await import('../src/api.ts')
    const app = createApp()
    const headers = { Authorization: 'Bearer local-library-test-only' }
    const response = await app.request('/api/v1/skills', { headers })
    assert.equal(response.status, 200)
    const catalog = await response.json() as { name: string; description: string }[]
    assert.equal(catalog.length, expected.length)
    assert.equal(new Set(catalog.map(s => s.name)).size, expected.length)
    for (const name of [...community, 'heygen-avatar', 'heygen-video', 'heygen-translate']) {
      assert.ok(catalog.find(s => s.name === name)?.description)
      const res = await app.request(`/skills/${name}/SKILL.md`, { headers })
      assert.equal(res.status, 200)
      assert.match(await res.text(), new RegExp(`name: ${name}`))
    }
    assert.equal((await app.request('/api/v1/skills')).status, 401)
    async function call(name: string, args: Record<string, string> = {}) {
      const res = await app.request('/mcp', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
      assert.equal(res.status, 200)
      const data = await res.json() as any
      assert.ok(!data.error && !data.result.isError)
      return data.result.content[0].text as string
    }
    const mcpCatalog = JSON.parse(await call('list_skills'))
    assert.equal(mcpCatalog.length, expected.length)
    for (const name of community) {
      const text = await call('read_skill', { skill: name })
      assert.equal(text, await readFile(join(builtCommunity, name, 'SKILL.md'), 'utf8'))
      assert.ok(JSON.parse(await call('list_skill_files', { skill: name })).includes('SKILL.md'))
    }
  } finally {
    await rm(image, { recursive: true, force: true })
  }
})
