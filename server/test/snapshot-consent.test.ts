import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('generic REST and MCP snapshot require unambiguous provider-description consent at the real spawn boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-snapshot-consent-'))
  process.env.HF_API_KEY = 'snapshot-test-only'
  process.env.HYPERFRAMES_PROJECTS_DIR = root
  process.env.HF_CLI = join(root, 'fake-cli')
  process.env.GEMINI_API_KEY = 'dummy-never-sent'
  const capture = join(root, 'calls.jsonl')
  await writeFile(process.env.HF_CLI, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(args) + '\\n');
console.log(JSON.stringify({ args }));
`, { mode: 0o700 })
  try {
    const { createApp } = await import('../src/api.ts')
    const app = createApp()
    const headers = { Authorization: 'Bearer snapshot-test-only', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    async function invoke(transport: string, args: string[], rejected = false) {
      const response = await app.request(transport === 'REST' ? '/api/v1/cli' : '/mcp', {
        method: 'POST', headers,
        body: JSON.stringify(transport === 'REST' ? { args } : { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_cli', arguments: { args } } }),
      })
      const body = await response.json() as any
      if (rejected) {
        if (transport === 'REST') assert.equal(response.status, 400)
        else assert.equal(body.result.isError, true)
        return
      }
      assert.equal(response.status, 200)
      if (transport === 'MCP') assert.notEqual(body.result.isError, true)
      return JSON.parse((await readFile(capture, 'utf8')).trim().split('\n').at(-1)!) as string[]
    }
    for (const transport of ['REST', 'MCP']) {
      for (const [input, value] of [
        [[], 'false'], [['--describe', 'true'], 'true'], [['--describe=true'], 'true'],
        [['--describe', 'false'], 'false'], [['--describe=false'], 'false'],
        [['--describe', 'Is the logo visible?'], 'Is the logo visible?'],
        [['--describe=Is the logo visible?'], 'Is the logo visible?'],
      ] as [string[], string][]) {
        const forwarded = await invoke(transport, ['snapshot', '--json', ...input])
        assert.deepEqual(forwarded?.slice(-2), ['--describe', value], `${transport}: ${input}`)
      }
      for (const input of [
        ['--describe'], ['--describe='], ['--describe', '--json'], ['--describe', ' '],
        ['--describe', 'true', '--describe=false'], ['--describe=false', '--describe', 'true'],
        ['--describe=false', '--describe=false'], ['--no-describe'], ['--no-describe=true'],
        ['--', '--describe=true'], ['--zoom', '--describe=true'], ['--zoom'],
        ['--zoom', '--no-end'], ['-o'], ['--zoom-scale'],
      ]) {
        const before = await readFile(capture, 'utf8')
        await invoke(transport, ['snapshot', '--json', ...input], true)
        assert.equal(await readFile(capture, 'utf8'), before, 'invalid consent must not spawn')
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
