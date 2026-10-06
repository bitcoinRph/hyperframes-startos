import { utils } from '@start9labs/start-sdk'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'
import { studioUser } from '../utils'

// Studio has no login of its own; StartOS asks for this password at its proxy.
export const setStudioPassword = sdk.Action.withoutInput(
  'set-studio-password',

  async ({ effects }) => ({
    name: i18n('Set Studio Password'),
    description: i18n(
      'Generate a new password for the Studio web interface. Replaces any existing password.',
    ),
    warning: (await storeJson.read((s) => s.studioPassword).const(effects))
      ? i18n('Replaces the current Studio password.')
      : null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  async ({ effects }) => {
    const studioPassword = utils.getDefaultString({
      charset: 'a-z,A-Z,0-9',
      len: 24,
    })
    await storeJson.merge(effects, { studioPassword })

    return {
      version: '1',
      title: i18n('Studio Login'),
      message: i18n('Your browser asks for these when you open Studio.'),
      result: {
        type: 'group',
        value: [
          {
            type: 'single',
            name: i18n('Username'),
            description: null,
            value: studioUser,
            masked: false,
            copyable: true,
            qr: false,
          },
          {
            type: 'single',
            name: i18n('Password'),
            description: null,
            value: studioPassword,
            masked: true,
            copyable: true,
            qr: false,
          },
        ],
      },
    }
  },
)
