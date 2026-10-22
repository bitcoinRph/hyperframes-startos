import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('REST and MCP expose scoped check/review schemas and fail closed before CLI execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-api-parity-'))
  process.env.HF_API_KEY = 'parity-test-only'
  process.env.HYPERFRAMES_PROJECTS_DIR = root
  // Any accidental spawn must fail, never reach a configured provider or browser.
  process.env.HF_CLI = join(root, 'must-not-execute')
  try {
    await mkdir(join(root, 'demo'))
    await writeFile(join(root, 'demo', 'index.html'), '<html></html>')
    const { createApp } = await import('../src/api.ts')
    const app = createApp()
    const headers = { Authorization: 'Bearer parity-test-only', 'Content-Type': 'application/json' }
    async function mcp(method: string, params?: unknown) {
      const res = await app.request('/mcp', { method: 'POST', headers: { ...headers, Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      assert.equal(res.status, 200)
      return await res.json() as any
    }
    const listed = await mcp('tools/list')
    assert.ok(!listed.error)
    const tools = listed.result.tools as any[]
    const check = tools.find(t => t.name === 'check').inputSchema.properties
    const snapshot = tools.find(t => t.name === 'snapshot').inputSchema.properties
    for (const key of ['range', 'components', 'maxTransitionSamples', 'maxIssues', 'collapseStatic']) assert.ok(key in check)
    for (const key of ['review', 'range', 'composition']) assert.ok(key in snapshot)
    assert.equal('describe' in snapshot, false)
    for (const args of [['cloud', 'render'], ['render', '--docker=true'], ['check', '--file-issue=true']]) {
      const res = await app.request('/api/v1/cli', { method: 'POST', headers, body: JSON.stringify({ project: 'demo', args }) })
      assert.equal(res.status, 400)
      const result = await mcp('tools/call', { name: 'run_cli', arguments: { project: 'demo', args } })
      assert.equal(result.result.isError, true)
    }
    const badReview = { review: true, at: [0] }
    const res = await app.request('/api/v1/projects/demo/snapshot', { method: 'POST', headers, body: JSON.stringify(badReview) })
    assert.equal(res.status, 400)
    assert.match(await res.text(), /picks its own/)
    const result = await mcp('tools/call', { name: 'snapshot', arguments: { project: 'demo', ...badReview } })
    assert.equal(result.result.isError, true)
    assert.match(result.result.content[0].text, /picks its own/)
    assert.equal((await app.request('/api/v1/cli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: ['inspect'] }) })).status, 401)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
