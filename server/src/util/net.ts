import { lookup } from 'node:dns/promises'
import { createWriteStream } from 'node:fs'
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { badRequest } from './errors.js'

/**
 * Outbound network policy for URLs that agents hand to the server. The agent
 * API runs on the StartOS LAN, so a URL that resolves to the box, the LAN or a
 * cloud metadata address is refused before any connection is opened, and the
 * connection is pinned to the address that passed the check.
 */

const blocked = new BlockList()
// IPv4: this-host, private, shared (CGNAT), loopback, link-local (incl. the
// 169.254.169.254 metadata address), IETF protocol, documentation,
// benchmarking, multicast, reserved and broadcast.
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4')
}
// IPv6: unspecified, loopback, NAT64, discard, documentation, unique-local,
// link-local, multicast. IPv4-mapped addresses (::ffff:a.b.c.d) are matched by
// the IPv4 rules above; node's BlockList does that itself.
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6')
}

/** Name suffixes that only ever point at this host or the local network. */
const blockedSuffixes = ['localhost', 'localdomain', 'local', 'internal', 'lan', 'home.arpa', 'in-addr.arpa', 'ip6.arpa']

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/** Strips the brackets `URL.hostname` keeps around an IPv6 literal. */
function bareHost(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
}

export function isPublicHostname(hostname: string): boolean {
  const host = bareHost(hostname)
  if (host.length === 0) return false
  if (isIP(host)) return isPublicAddress(host)
  return !blockedSuffixes.some((s) => host === s || host.endsWith(`.${s}`))
}

export type HostResolver = (hostname: string) => Promise<string>

/**
 * Resolves a URL host to the one address the connection will use, refusing
 * names and addresses that are not public. Every address the name resolves to
 * must pass, so a name that mixes public and private records is refused too.
 */
export const resolvePublicHost: HostResolver = async (hostname) => {
  const host = bareHost(hostname)
  if (!isPublicHostname(host)) throw badRequest(`"${host}" is not a public host`)
  if (isIP(host)) return host
  const records = await lookup(host, { all: true, verbatim: true }).catch(() => [])
  if (records.length === 0) throw badRequest(`"${host}" does not resolve`)
  for (const r of records) {
    if (!isPublicAddress(r.address)) throw badRequest(`"${host}" resolves to a private address`)
  }
  return records[0].address
}

export type FetchOptions = {
  maxRedirects?: number
  timeoutMs?: number
  /** Extra request headers, for example an `accept` for a JSON API. */
  headers?: Record<string, string>
  /** Test seam; defaults to the public-host policy. */
  resolveHost?: HostResolver
}

export type DownloadOptions = FetchOptions & { maxBytes: number }

export type DownloadResult = { bytes: number; contentType: string | null; finalUrl: string }

const redirectStatuses = new Set([301, 302, 303, 307, 308])

/**
 * Opens an http(s) URL and follows redirects. Each hop goes through
 * `resolveHost`, and the socket connects to the address it returned, so a
 * name cannot be re-pointed at a private address between check and use.
 * Resolves with the first non-redirect 2xx response, body unread.
 */
export async function openPublicUrl(url: URL, options: FetchOptions = {}): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  const maxRedirects = options.maxRedirects ?? 5
  const resolveHost = options.resolveHost ?? resolvePublicHost
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000)
  let current = url
  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw badRequest('url must be http or https')
    const address = await resolveHost(current.hostname)
    const res = await open(current, address, signal, options.headers ?? {})
    const status = res.statusCode ?? 0
    if (redirectStatuses.has(status)) {
      res.resume()
      const location = res.headers.location
      if (!location) throw badRequest(`fetch failed with HTTP ${status} and no Location`)
      if (hop >= maxRedirects) throw badRequest(`too many redirects (more than ${maxRedirects})`)
      current = new URL(location, current)
      continue
    }
    if (status < 200 || status >= 300) {
      res.resume()
      throw badRequest(`fetch failed with HTTP ${status}`)
    }
    return { response: res, finalUrl: current }
  }
}

function limitedBody(res: IncomingMessage, maxBytes: number): { limiter: Transform; count: () => number } {
  const declared = Number(res.headers['content-length'] ?? '0')
  if (declared > maxBytes) {
    res.destroy()
    throw badRequest(`remote file exceeds ${maxBytes} bytes`)
  }
  let bytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length
      if (bytes > maxBytes) cb(badRequest(`remote file exceeds ${maxBytes} bytes`))
      else cb(null, chunk)
    },
  })
  return { limiter, count: () => bytes }
}

/**
 * Streams an http(s) URL into a file. The byte limit applies to the body as
 * it arrives, not to a header the remote end chooses.
 */
export async function downloadToFile(url: URL, destination: string, options: DownloadOptions): Promise<DownloadResult> {
  const { response, finalUrl } = await openPublicUrl(url, options)
  const { limiter, count } = limitedBody(response, options.maxBytes)
  await pipeline(response, limiter, createWriteStream(destination))
  return { bytes: count(), contentType: response.headers['content-type'] ?? null, finalUrl: finalUrl.href }
}

/** Reads a small http(s) resource into memory under the same policy and limit. */
export async function downloadToBuffer(url: URL, options: DownloadOptions): Promise<DownloadResult & { buffer: Buffer }> {
  const { response, finalUrl } = await openPublicUrl(url, options)
  const { limiter, count } = limitedBody(response, options.maxBytes)
  const chunks: Buffer[] = []
  await pipeline(response, limiter, async function* (source) {
    for await (const chunk of source) chunks.push(chunk as Buffer)
  })
  return { bytes: count(), buffer: Buffer.concat(chunks), contentType: response.headers['content-type'] ?? null, finalUrl: finalUrl.href }
}

function open(url: URL, address: string, signal: AbortSignal, extraHeaders: Record<string, string>): Promise<IncomingMessage> {
  const family = isIP(address)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const options: RequestOptions = {
    method: 'GET',
    headers: { 'user-agent': 'hyperframes-startos/1.0', accept: '*/*', ...extraHeaders },
    signal,
    // Pins the connection to the vetted address; TLS still verifies the name.
    lookup: (_hostname, opts, cb) => {
      if (opts && typeof opts === 'object' && 'all' in opts && opts.all) {
        cb(null, [{ address, family }])
      } else {
        cb(null, address, family)
      }
    },
  }
  return new Promise((resolve, reject) => {
    const req = request(url, options, resolve)
    req.on('error', reject)
    req.end()
  })
}
