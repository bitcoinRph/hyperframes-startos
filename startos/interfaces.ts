import { i18n } from './i18n'
import { sdk } from './sdk'
import { storeJson } from './fileModels/store.json'
import { apiPort, mcpPath, studioPort, studioUser } from './utils'

// StartOS enforces both credentials at its reverse proxy, so neither Studio
// (which has no login of its own) nor the API is reachable without them.
// The API server checks the bearer token a second time itself.
export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const studioPassword = await storeJson
    .read((s) => s.studioPassword)
    .const(effects)
  const apiKey = await storeJson.read((s) => s.apiKey).const(effects)

  const studioMulti = sdk.MultiHost.of(effects, 'studio')
  const studioOrigin = await studioMulti.bindPort(studioPort, {
    protocol: 'http',
    addSsl: {
      auth: studioPassword
        ? {
            type: 'basic',
            credentials: [{ username: studioUser, password: studioPassword }],
            realm: 'HyperFrames Studio',
          }
        : null,
    },
  })
  const studio = sdk.createInterface(effects, {
    name: i18n('Studio'),
    id: 'studio',
    description: i18n(
      'HyperFrames Studio: preview, edit and render the selected project in the browser',
    ),
    type: 'ui',
    masked: false,
    schemeOverride: null,
    username: studioUser,
    path: '',
    query: {},
  })
  const studioReceipt = await studioOrigin.export([studio])

  const apiMulti = sdk.MultiHost.of(effects, 'api')
  const apiOrigin = await apiMulti.bindPort(apiPort, {
    protocol: 'http',
    addSsl: {
      auth: apiKey
        ? { type: 'bearer', tokens: [apiKey], realm: 'HyperFrames API' }
        : null,
    },
  })
  const api = sdk.createInterface(effects, {
    name: i18n('Agent API'),
    id: 'api',
    description: i18n(
      'REST API for agents: projects, files, lint, check, snapshots and render jobs. Send the API key as a bearer token.',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })
  const mcp = sdk.createInterface(effects, {
    name: i18n('MCP Server'),
    id: 'mcp',
    description: i18n(
      'Model Context Protocol endpoint (streamable HTTP) for Claude Code, Codex, Hermes Agent, OpenClaw and other MCP clients',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: mcpPath,
    query: {},
  })
  const apiReceipt = await apiOrigin.export([api, mcp])

  return [studioReceipt, apiReceipt]
})
