import { config } from './config.js'
import { badRequest, notFound } from './util/errors.js'
import { downloadToBuffer } from './util/net.js'

// The registry manifest the CLI lists (`catalog --json`) carries no variables,
// so an agent cannot see what an item lets it change before installing it.
// The item's own manifest does; it lives beside the item's files in the
// registry the CLI installs from.

export const catalogItemTypes = ['block', 'component', 'example'] as const
export type CatalogItemType = (typeof catalogItemTypes)[number]

const typeDirs: Record<CatalogItemType, string> = { block: 'blocks', component: 'components', example: 'examples' }
const MAX_MANIFEST = 2 * 1024 * 1024

export type CatalogItem = {
  name: string
  type: CatalogItemType
  manifest: unknown
  manifestUrl: string
  /** How to bring the item into a project on this server. */
  installWith: string
}

export async function catalogItem(name: string, type?: CatalogItemType): Promise<CatalogItem> {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)) throw badRequest('name must be a registry item slug')
  const candidates = type ? [type] : catalogItemTypes
  for (const t of candidates) {
    const url = new URL(`${config.registryUrl}/${typeDirs[t]}/${name}/registry-item.json`)
    let body: Buffer
    try {
      body = (await downloadToBuffer(url, { maxBytes: MAX_MANIFEST, timeoutMs: 30_000, headers: { accept: 'application/json' } })).buffer
    } catch (err) {
      // A missing manifest at this type is the normal "try the next type";
      // anything else (policy, network, size) is reported as is.
      if (err instanceof Error && /HTTP 404/.test(err.message)) continue
      throw err
    }
    let manifest: unknown
    try {
      manifest = JSON.parse(body.toString('utf8'))
    } catch {
      throw badRequest(`registry item "${name}" has an unreadable manifest`)
    }
    return {
      name,
      type: t,
      manifest,
      manifestUrl: url.href,
      installWith: t === 'example' ? `create_project with example: "${name}"` : `catalog_add with name: "${name}" (and vars for the variables above)`,
    }
  }
  throw notFound(`registry item "${name}" not found${type ? ` as a ${type}` : ''}`)
}
