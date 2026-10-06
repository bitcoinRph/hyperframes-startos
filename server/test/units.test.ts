import assert from 'node:assert/strict'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildRenderArgs } from '../src/jobs.ts'
import { assertAllowedCli, parseJsonOutput } from '../src/util/cli.ts'
import { assertProjectName, resolveInside } from '../src/util/paths.ts'

test('project names are constrained', () => {
  assert.equal(assertProjectName('my-video_2'), 'my-video_2')
  for (const bad of ['', '-x', 'A', 'a b', '../x', 'a'.repeat(65)]) {
    assert.throws(() => assertProjectName(bad), new RegExp('project name'))
  }
})

test('resolveInside refuses escapes, lexical and via symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'hf-outside-'))
  await writeFile(join(outside, 'secret.txt'), 'x')
  await symlink(outside, join(root, 'link'))
  assert.equal(await resolveInside(root, 'index.html'), join(root, 'index.html'))
  assert.equal(await resolveInside(root, 'a/b/../c.txt'), join(root, 'a/c.txt'))
  await assert.rejects(resolveInside(root, '../x'), /escapes/)
  // A leading slash is treated as project-relative, so REST paths like /files/index.html work.
  assert.equal(await resolveInside(root, '/etc/passwd'), join(root, 'etc/passwd'))
  await assert.rejects(resolveInside(root, 'link/secret.txt'), /outside/)
})

test('render args are validated and quoted-free', () => {
  const { args, output, isDir } = buildRenderArgs(
    { project: 'demo', format: 'webm', fps: '30000/1001', quality: 'delivery', outputName: 'final', variables: { title: 'Q4' } },
    '/p/demo',
  )
  assert.equal(output, 'renders/final.webm')
  assert.equal(isDir, false)
  assert.deepEqual(args.slice(0, 2), ['render', '/p/demo'])
  assert.ok(args.includes('--variables'))
  assert.throws(() => buildRenderArgs({ project: 'demo', outputName: '../x' }, '/p'), /outputName/)
  assert.throws(() => buildRenderArgs({ project: 'demo', fps: '30; rm -rf' }, '/p'), /fps/)
  assert.throws(() => buildRenderArgs({ project: 'demo', extraArgs: ['--docker'] }, '/p'), /not allowed/)
  const seq = buildRenderArgs({ project: 'demo', format: 'png-sequence', outputName: 'frames' }, '/p')
  assert.equal(seq.output, 'renders/frames')
  assert.equal(seq.isDir, true)
})

test('run_cli allowlist blocks hosted and interactive commands', () => {
  assertAllowedCli(['timeline', '--json'])
  for (const cmd of ['publish', 'cloud', 'auth', 'preview', 'init', 'feedback', 'telemetry']) {
    assert.throws(() => assertAllowedCli([cmd]), /not available/)
  }
  assert.throws(() => assertAllowedCli(['render', '--docker']), /--docker/)
})

test('parseJsonOutput finds the trailing JSON document', () => {
  assert.deepEqual(parseJsonOutput('progress 1\nprogress 2\n{"ok":true}\n'), { ok: true })
  assert.equal(parseJsonOutput('no json here'), null)
})
