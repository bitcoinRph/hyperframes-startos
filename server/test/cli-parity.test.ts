import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkArgs, snapshotArgs } from '../src/ops.ts'
import { assertAllowedCli } from '../src/util/cli.ts'
import { buildRenderArgs } from '../src/jobs.ts'
import { openapi } from '../src/openapi.ts'

test('local diagnostic aliases are allowed without opening hosted/interactive surfaces', () => {
  for (const cmd of ['inspect', 'layout', 'validate']) assertAllowedCli([cmd, '--json'])
  for (const cmd of ['browser', 'benchmark', 'events', 'usage', 'open', 'play', 'present', 'cloud', 'lambda', 'cloudrun']) {
    assert.throws(() => assertAllowedCli([cmd]), /not available/)
  }
  for (const args of [['render', '--docker=true'], ['check', '--file-issue=true']]) {
    assert.throws(() => assertAllowedCli(args), /not available|publishes/)
  }
})

test('check maps scoped diagnostics to actual upstream flags', () => {
  assert.deepEqual(checkArgs({ range: [1, 2.5], components: '#hero, .caption', maxTransitionSamples: 30, maxIssues: 50, collapseStatic: false }),
    ['check', '--range', '1,2.5', '--components', '#hero, .caption', '--max-transition-samples', '30', '--max-issues', '50', '--no-collapse-static'])
  for (const range of [[2, 1], [0, Infinity], [-1, 2], [1]] as [number, number][]) {
    assert.throws(() => checkArgs({ range }), /range|timestamps/)
  }
  assert.throws(() => checkArgs({ components: 'x\0y' }), /components/)
  assert.throws(() => checkArgs({ maxTransitionSamples: 0 }), /integer/)
})

test('snapshot review and JSON preserve the local/provider boundary', () => {
  const args = snapshotArgs('/project', '/project/snapshots/run', { review: true, composition: 'intro' })
  assert.deepEqual(args, ['snapshot', '/project', '--output', '/project/snapshots/run', '--json', '--review', '--composition', 'intro', '--describe', 'false'])
  assert.ok(snapshotArgs('/p', '/o').includes('--describe'), 'No implicit Gemini calls even if a key exists')
  assert.ok(!snapshotArgs('/p', '/o', { describe: true }).includes('--describe'), 'Internal provider opt-in remains explicit')
  assert.ok(snapshotArgs('/p', '/o', { range: [0, 1] }).includes('0,1'))
  for (const options of [{ review: true, at: [0] }, { review: true, range: [0, 1] as [number, number] }, { review: true, zoom: '#hero' }, { composition: 'intro', at: [1] }]) {
    assert.throws(() => snapshotArgs('/p', '/o', options), /picks its own|only one/)
  }
})

test('render rejects invalid rational rates and job-output override bypasses', () => {
  for (const fps of ['0', '30000/0', '241', '1/2']) assert.throws(() => buildRenderArgs({ project: 'demo', fps }, '/p'), /fps/)
  assert.ok(buildRenderArgs({ project: 'demo', fps: '30000/1001' }, '/p').args.includes('30000/1001'))
  for (const flag of ['--docker=true', '--output=/elsewhere', '--batch=rows.json', '--variables-file=/elsewhere']) {
    assert.throws(() => buildRenderArgs({ project: 'demo', extraArgs: [flag] }, '/p'), /not allowed/)
  }
})

test('OpenAPI advertises the same scoped check and review snapshot options', () => {
  const doc = openapi([])
  const check = doc.paths['/api/v1/projects/{project}/check'].post.requestBody.content['application/json'].schema.properties
  const snapshot = doc.paths['/api/v1/projects/{project}/snapshot'].post.requestBody.content['application/json'].schema.properties
  for (const key of ['range', 'components', 'maxTransitionSamples', 'maxIssues', 'collapseStatic']) assert.ok(key in check)
  for (const key of ['review', 'range', 'composition']) assert.ok(key in snapshot)
})
