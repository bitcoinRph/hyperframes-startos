import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve(import.meta.dirname, '../../assets/patch-studio.mjs')
const assetsDir = resolve(import.meta.dirname, '../../assets')
const run = (dist: string) => spawnSync(process.execPath, [script, dist, assetsDir], { encoding: 'utf8' })

async function fixture(bundleText: string): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'hf-studio-dist-'))
  await mkdir(join(dist, 'assets'))
  await writeFile(join(dist, 'index.html'), '<!doctype html>\n<html>\n  <head>\n    <title>HyperFrames Studio</title>\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n')
  await writeFile(join(dist, 'assets', 'index-AAAA.js'), 'console.log("other chunk")')
  await writeFile(join(dist, 'assets', 'index-BBBB.js'), bundleText)
  return dist
}

test('patch-studio links the overlay once and copies its files', async () => {
  const dist = await fixture('"Maximize panel","Restore panel","Close group","Reset layout",".dv-groupview","Window"')
  const first = run(dist)
  assert.equal(first.status, 0, first.stderr)
  const second = run(dist)
  assert.equal(second.status, 0, second.stderr)
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  const css = html.match(/\/assets\/studio-mobile\.[0-9a-f]{10}\.css/g) ?? []
  const js = html.match(/\/assets\/studio-mobile\.[0-9a-f]{10}\.js/g) ?? []
  assert.equal(css.length, 1)
  assert.equal(js.length, 1)
  assert.ok(html.indexOf(js[0]) < html.indexOf('</head>'))
  assert.ok((await readFile(join(dist, css[0].slice(1)), 'utf8')).includes('.hf-startos-bar'))
  assert.ok((await readFile(join(dist, js[0].slice(1)), 'utf8')).includes('Maximize panel'))
})

test('patch-studio refuses a Studio bundle without the controls the overlay drives', async () => {
  const dist = await fixture('"Maximize panel","Close group"')
  const result = run(dist)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no longer contains "Restore panel"/)
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  assert.ok(!html.includes('studio-mobile'))
})
