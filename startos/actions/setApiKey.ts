import { utils } from '@start9labs/start-sdk'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'
import { mcpPath } from '../utils'

// One action generates, stores and returns the key, for first set and rotation.
export const setApiKey = sdk.Action.withoutInput(
  'set-api-key',

  async ({ effects }) => ({
    name: i18n('Set API Key'),
    description: i18n(
      'Generate a new API key for the agent API and MCP server. Replaces any existing key.',
    ),
    warning: (await storeJson.read((s) => s.apiKey).const(effects))
      ? i18n('Replaces the current API key. Connected agents must be updated.')
      : null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  async ({ effects }) => {
    const apiKey = utils.getDefaultString({ charset: 'a-z,A-Z,0-9', len: 48 })
    await storeJson.merge(effects, { apiKey })

    return {
      version: '1',
      title: i18n('Agent API Key'),
      message: i18n(
        'Send this key as "Authorization: Bearer <key>" to the Agent API and to the MCP Server interface. The MCP endpoint is the Agent API address plus the path below.',
      ),
      result: {
        type: 'group',
        value: [
          {
            type: 'single',
            name: i18n('API key'),
            description: null,
            value: apiKey,
            masked: true,
            copyable: true,
            qr: false,
          },
          {
            type: 'single',
            name: i18n('MCP path'),
            description: null,
            value: mcpPath,
            masked: false,
            copyable: true,
            qr: false,
          },
        ],
      },
    }
  },
)
