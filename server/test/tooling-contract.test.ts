import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('Docker installs hash-pinned official HeyGen for both Linux architectures', async () => {
  const docker = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')
  const installer = await readFile(new URL('../../assets/install-heygen.sh', import.meta.url), 'utf8')
  assert.match(docker, /FROM base AS server-build/)
  assert.match(docker, /FROM base\n/)
  assert.match(docker, /install-heygen.sh \/usr\/local/)
  assert.match(docker, /HEYGEN_NO_ANALYTICS=1 HEYGEN_NO_UPDATE_CHECK=1 HEYGEN_NONINTERACTIVE=1/)
  assert.match(installer, /VERSION=v0\.10\.0/)
  assert.match(installer, /amd64\) SHA256=5edd58ee09ac92aadeea8742523530e7b4051caf100c97eba2fd8399f246ccea/)
  assert.match(installer, /arm64\) SHA256=64f225ed848a5f6d0d5af1d7f7bccd8a8ec014dba0cd6540f9fd1a2ac3ab0e85/)
  assert.match(installer, /sha256sum -c -/)
  assert.ok(installer.indexOf('sha256sum -c -') < installer.indexOf('tar -xzf'))
  assert.doesNotMatch(installer, /curl[^\n]*\|\s*(?:ba)?sh|auth login|heygen update/)
})

// Opt-in real-binary integration, never a fabricated provider response.
// HF_TOOLING_CLI/HF_TOOLING_HEYGEN must point at reviewed local installations.
test('real REST + MCP media-use doctor discovers HeyGen but reports missing credentials', {
  skip: !process.env.HF_TOOLING_CLI || !process.env.HF_TOOLING_HEYGEN,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-tooling-'))
  const old = { ...process.env }
  try {
    const bin = join(root, 'bin')
    const home = join(root, 'home')
    await mkdir(bin); await mkdir(home); await mkdir(join(root, 'demo'))
    await writeFile(join(root, 'demo', 'index.html'), '<html></html>')
    // No curl on PATH: upstream doctor cannot check its remote stable CDN.
    for (const name of ['node', 'ffmpeg', 'ffprobe']) {
      const path = execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim()
      await symlink(path, join(bin, name))
    }
    await symlink(resolve(process.env.HF_TOOLING_HEYGEN!), join(bin, 'heygen'))
    for (const key of Object.keys(process.env)) if (/HEYGEN|HYPERFRAMES|HF_|GEMINI|OPENAI/.test(key)) delete process.env[key]
    Object.assign(process.env, { HF_CLI: resolve(old.HF_TOOLING_CLI!), HF_API_KEY: 'local-tooling-test',
      HYPERFRAMES_PROJECTS_DIR: root, HF_STATE_DIR: join(root, 'state'),
      PATH: bin, HOME: home, HEYGEN_CONFIG_DIR: join(home, '.heygen'),
      HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' })
    const { createApp } = await import('../src/api.ts')
    const app = createApp()
    const headers = { Authorization: 'Bearer local-tooling-test', 'Content-Type': 'application/json' }
    const args = ['media-use', 'resolve', '--doctor', '--json']
    const res = await app.request('/api/v1/cli', { method: 'POST', headers, body: JSON.stringify({ project: 'demo', args }) })
    assert.equal(res.status, 200)
    const rest = await res.json() as any
    function verify(value: any) {
      const checks = value.json.checks as any[]
      assert.equal(checks.find(c => c.name === 'heygen on PATH')?.ok, true)
      assert.match(checks.find(c => c.name === 'heygen version')?.detail, /v0\.10\.0/)
      assert.equal(checks.find(c => c.name === 'heygen authenticated')?.ok, false)
    }
    verify(rest)
    const mcp = await app.request('/mcp', { method: 'POST', headers: { ...headers, Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_cli', arguments: { project: 'demo', args } } }) })
    const result = await mcp.json() as any
    verify(JSON.parse(result.result.content[0].text))
    for (const body of [{ project: '../escape', args }, { project: 'demo', args: ['heygen', 'auth', 'login'] }]) {
      assert.equal((await app.request('/api/v1/cli', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400)
    }
    assert.equal((await app.request('/api/v1/cli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'demo', args }) })).status, 401)
    console.log('Real HeyGen v0.10.0 reached via REST and MCP media-use; provider authentication remains BLOCKED (no credentials).')
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, old)
    await rm(root, { recursive: true, force: true })
  }
})
