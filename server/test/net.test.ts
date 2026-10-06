import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { downloadToFile, isPublicAddress, isPublicHostname, resolvePublicHost } from '../src/util/net.ts'

test('private, loopback, link-local, multicast and metadata addresses are not public', () => {
  for (const a of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'fc00::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
  ]) {
    assert.equal(isPublicAddress(a), false, a)
  }
  for (const a of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700:4700::1111', '::ffff:1.1.1.1']) {
    assert.equal(isPublicAddress(a), true, a)
  }
  assert.equal(isPublicAddress('not-an-ip'), false)
})

test('local-only name suffixes and IP literals are classified before any DNS lookup', async () => {
  for (const h of ['localhost', 'LOCALHOST.', 'router.local', 'startos.local', 'db.internal', 'nas.lan', 'box.home.arpa', '[::1]', '127.0.0.1', '']) {
    assert.equal(isPublicHostname(h), false, h)
  }
  for (const h of ['example.com', 'cdn.jsdelivr.net', 'localhost.example.com', '[2606:4700:4700::1111]']) {
    assert.equal(isPublicHostname(h), true, h)
  }
  await assert.rejects(resolvePublicHost('localhost'), /not a public host/)
  await assert.rejects(resolvePublicHost('169.254.169.254'), /not a public host/)
  assert.equal(await resolvePublicHost('[2606:4700:4700::1111]'), '2606:4700:4700::1111')
})

// A local server stands in for the internet. The test resolver lets the name
// `public.test` through to it and applies the real policy to everything else,
// so a redirect to 127.0.0.1 is judged the way a redirect to the LAN would be.
let server: Server
let port = 0
const body = Buffer.alloc(64 * 1024, 'a')
before(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/ok':
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return res.end(body)
      case '/hop':
        res.writeHead(302, { location: '/ok' })
        return res.end()
      case '/to-loopback':
        res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` })
        return res.end()
      case '/to-metadata':
        res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' })
        return res.end()
      case '/loop':
        res.writeHead(301, { location: '/loop' })
        return res.end()
      case '/big-header':
        res.writeHead(200, { 'content-length': String(10 * 1024 * 1024) })
        return res.end()
      case '/chunked-big':
        // No content-length: only the bytes that actually arrive can be counted.
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.write(body)
        return res.end(body)
      case '/missing':
        res.writeHead(404)
        return res.end()
      default:
        res.writeHead(500)
        return res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr && typeof addr === 'object') port = addr.port
})
after(() => new Promise<void>((r) => server.close(() => r())))

const resolveHost = async (hostname: string) => (hostname === 'public.test' ? '127.0.0.1' : resolvePublicHost(hostname))
const publicUrl = (path: string) => new URL(`http://public.test:${port}${path}`)

test('downloadToFile streams a body to disk and follows same-host redirects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-net-'))
  const dest = join(dir, 'a.bin')
  const r = await downloadToFile(publicUrl('/hop'), dest, { maxBytes: 1024 * 1024, resolveHost })
  assert.equal(r.bytes, body.length)
  assert.equal(r.finalUrl, publicUrl('/ok').href)
  assert.equal((await stat(dest)).size, body.length)
  assert.ok((await readFile(dest)).equals(body))
})

test('downloadToFile refuses private targets, before the first hop and after a redirect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-net-'))
  const dest = join(dir, 'b.bin')
  await assert.rejects(downloadToFile(new URL(`http://127.0.0.1:${port}/ok`), dest, { maxBytes: 1024, resolveHost }), /not a public host/)
  await assert.rejects(downloadToFile(new URL(`http://localhost:${port}/ok`), dest, { maxBytes: 1024, resolveHost }), /not a public host/)
  await assert.rejects(downloadToFile(publicUrl('/to-loopback'), dest, { maxBytes: 1024 * 1024, resolveHost }), /not a public host/)
  await assert.rejects(downloadToFile(publicUrl('/to-metadata'), dest, { maxBytes: 1024 * 1024, resolveHost }), /not a public host/)
  await assert.rejects(downloadToFile(new URL('ftp://public.test/x'), dest, { maxBytes: 1024, resolveHost }), /http or https/)
  await assert.rejects(stat(dest))
})

test('downloadToFile caps redirects and bytes, declared or actual', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-net-'))
  const dest = join(dir, 'c.bin')
  await assert.rejects(downloadToFile(publicUrl('/loop'), dest, { maxBytes: 1024, maxRedirects: 3, resolveHost }), /too many redirects/)
  await assert.rejects(downloadToFile(publicUrl('/big-header'), dest, { maxBytes: 1024 * 1024, resolveHost }), /exceeds/)
  await assert.rejects(downloadToFile(publicUrl('/chunked-big'), dest, { maxBytes: 1024, resolveHost }), /exceeds/)
  await assert.rejects(downloadToFile(publicUrl('/missing'), dest, { maxBytes: 1024, resolveHost }), /HTTP 404/)
})
