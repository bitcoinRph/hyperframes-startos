#!/usr/bin/env node
// Installs the phone overlay into HyperFrames Studio's built bundle at image
// build time: copies studio-mobile.css/js beside index.html and links them from
// its <head>. Refuses when the bundle no longer carries the controls the
// overlay drives, so an upstream change fails the build instead of shipping a
// broken bar. Usage: node patch-studio.mjs <dist/studio dir> [assets dir]
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [distDir, assetsDir = dirname(fileURLToPath(import.meta.url))] = process.argv.slice(2)
const fail = (message) => {
  console.error(`patch-studio: ${message}`)
  process.exit(1)
}
if (!distDir) fail('usage: node patch-studio.mjs <dist/studio dir> [assets dir]')

const indexPath = join(distDir, 'index.html')
if (!existsSync(indexPath)) fail(`${indexPath} not found; is this the hyperframes package's dist/studio?`)
let html = readFileSync(indexPath, 'utf8')
if (!html.includes('</head>') || !html.includes('id="root"')) fail('index.html has no </head> or #root; the Studio shell changed')

// The dock code sits in one of several assets/index-*.js chunks; check them all.
const assetFiles = existsSync(join(distDir, 'assets')) ? readdirSync(join(distDir, 'assets')).filter((f) => f.endsWith('.js')) : []
if (assetFiles.length === 0) fail('no assets/*.js bundles found')
const bundle = assetFiles.map((f) => readFileSync(join(distDir, 'assets', f), 'utf8')).join('\n')
for (const anchor of ['Maximize panel', 'Restore panel', 'Close group', 'Reset layout', 'dv-groupview', 'Window']) {
  if (!bundle.includes(anchor)) fail(`the Studio bundle no longer contains "${anchor}"; re-verify assets/studio-mobile.js against this HyperFrames version`)
}
const bundleName = `${assetFiles.length} bundles`

// The studio server serves the bundle only under /assets/*, with an immutable
// cache header, so each file is named by its content hash and a new release
// never fights a browser cache.
const names = {}
for (const file of ['studio-mobile.css', 'studio-mobile.js']) {
  const source = join(assetsDir, file)
  if (!existsSync(source)) fail(`${source} not found`)
  const content = readFileSync(source)
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 10)
  const target = file.replace(/\.(css|js)$/, `.${hash}.$1`)
  copyFileSync(source, join(distDir, 'assets', target))
  names[file] = target
}

const start = '<!-- hyperframes-startos: studio-mobile -->'
const end = '<!-- /hyperframes-startos: studio-mobile -->'
const block = `    ${start}\n    <link rel="stylesheet" href="/assets/${names['studio-mobile.css']}" />\n    <script defer src="/assets/${names['studio-mobile.js']}"></script>\n    ${end}\n`
if (html.includes(start) && html.includes(end)) {
  html = html.slice(0, html.indexOf(start) - 4) + block + html.slice(html.indexOf(end) + end.length + 1)
} else {
  html = html.replace('</head>', `${block}  </head>`)
}
writeFileSync(indexPath, html)
console.log(`patch-studio: ok (${bundleName}; ${Object.values(names).join(', ')})`)
