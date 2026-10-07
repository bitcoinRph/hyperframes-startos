import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

// The projects root must be set before the server modules read config.
const projectsDir = await mkdtemp(join(tmpdir(), 'hf-projects-'))
process.env.HYPERFRAMES_PROJECTS_DIR = projectsDir
const { importProject } = await import('../src/importer.ts')
const { catalogAddArgs } = await import('../src/ops.ts')
const { resolvePublicHost } = await import('../src/util/net.ts')

// One local server plays GitHub's API, raw and media hosts. `github.test`
// resolves to it; every other name goes through the real policy.
let server: Server
let port = 0
const fontBytes = Buffer.alloc(4096, 7)
const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${fontBytes.length}\n`
const tree = {
  sha: 'abc123',
  truncated: false,
  tree: [
    { path: 'README.md', type: 'blob', size: 10 },
    { path: 'launch/index.html', type: 'blob', size: 40 },
    { path: 'launch/compositions', type: 'tree' },
    { path: 'launch/compositions/scene.html', type: 'blob', size: 20 },
    { path: 'launch/assets/fonts/Brand.woff2', type: 'blob', size: pointer.length },
    { path: 'launch/STORYBOARD.md', type: 'blob', size: 30 },
    { path: 'other/index.html', type: 'blob', size: 5 },
  ],
}
const hits: string[] = []
before(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    const url = req.url ?? ''
    if (url.startsWith('/api/repos/acme/films/git/trees/main')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(tree))
    }
    if (url.startsWith('/api/repos/acme/films/git/trees/huge')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ...tree, truncated: true }))
    }
    if (url === '/raw/acme/films/main/launch/assets/fonts/Brand.woff2') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end(pointer)
    }
    if (url === '/media/acme/films/main/launch/assets/fonts/Brand.woff2') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return res.end(fontBytes)
    }
    if (url.startsWith('/raw/acme/films/main/')) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end(`content of ${url.slice('/raw/acme/films/main/'.length)}`)
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr && typeof addr === 'object') port = addr.port
})
after(() => new Promise<void>((r) => server.close(() => r())))

const internals = () => ({
  hosts: { api: `http://github.test:${port}/api`, raw: `http://github.test:${port}/raw`, media: `http://github.test:${port}/media` },
  resolveHost: async (h: string) => (h === 'github.test' ? '127.0.0.1' : resolvePublicHost(h)),
})

test('import_project copies one directory, resolves LFS pointers and reports the source', async () => {
  const r = await importProject({ name: 'launch-copy', repo: 'acme/films', path: 'launch' }, internals())
  assert.equal(r.name, 'launch-copy')
  assert.equal(r.files, 4)
  assert.equal(r.lfsFiles, 1)
  assert.deepEqual(r.source, { repo: 'acme/films', ref: 'main', path: 'launch', commit: 'abc123' })
  assert.equal(await readFile(join(projectsDir, 'launch-copy', 'index.html'), 'utf8'), 'content of launch/index.html')
  assert.equal(await readFile(join(projectsDir, 'launch-copy', 'STORYBOARD.md'), 'utf8'), 'content of launch/STORYBOARD.md')
  assert.ok((await readFile(join(projectsDir, 'launch-copy', 'assets/fonts/Brand.woff2'))).equals(fontBytes))
  await assert.rejects(stat(join(projectsDir, 'launch-copy', 'README.md')))
  assert.ok(hits.includes('/media/acme/films/main/launch/assets/fonts/Brand.woff2'))
  assert.ok(!hits.some((h) => h.includes('/other/')))
})

test('import_project refuses bad input, missing index.html, truncated trees and existing projects', async () => {
  await assert.rejects(importProject({ name: 'x', repo: 'acme', path: 'launch' }, internals()), /owner\/name/)
  await assert.rejects(importProject({ name: 'x', repo: 'acme/films', path: '../launch' }, internals()), /inside the repository/)
  await assert.rejects(importProject({ name: 'x', repo: 'acme/films', path: 'launch', ref: 'a b' }, internals()), /ref must be/)
  await assert.rejects(importProject({ name: 'x', repo: 'acme/films', path: 'launch/compositions' }, internals()), /no index.html/)
  await assert.rejects(importProject({ name: 'x', repo: 'acme/films', path: 'nothing-here' }, internals()), /holds no files/)
  await assert.rejects(importProject({ name: 'x', repo: 'acme/films', path: 'launch', ref: 'huge' }, internals()), /too large/)
  await assert.rejects(importProject({ name: 'launch-copy', repo: 'acme/films', path: 'launch' }, internals()), /already exists/)
  await assert.rejects(stat(join(projectsDir, 'x')))
})

test('import_project applies the public-host policy to GitHub hosts too', async () => {
  const hosts = { api: `http://127.0.0.1:${port}/api`, raw: `http://127.0.0.1:${port}/raw`, media: `http://127.0.0.1:${port}/media` }
  await assert.rejects(importProject({ name: 'blocked', repo: 'acme/films', path: 'launch' }, { hosts }), /not a public host/)
})

test('catalog_add passes vars and force to the CLI as flags, never through a shell', () => {
  assert.deepEqual(catalogAddArgs('lt-kicker-name', '/p/demo'), ['add', 'lt-kicker-name', '--dir', '/p/demo', '--no-clipboard', '--json'])
  const args = catalogAddArgs('lt-kicker-name', '/p/demo', { vars: { name: 'Jane; rm -rf /', accent: '#ff0000' }, force: true })
  assert.equal(args[args.indexOf('--vars') + 1], JSON.stringify({ name: 'Jane; rm -rf /', accent: '#ff0000' }))
  assert.ok(args.includes('--force'))
  assert.throws(() => catalogAddArgs('Bad Name', '/p'), /slug/)
  assert.throws(() => catalogAddArgs('ok', '/p', { vars: ['x'] as unknown as Record<string, unknown> }), /object/)
})
