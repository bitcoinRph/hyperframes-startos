import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'
import { setApiKey } from '../actions/setApiKey'
import { setStudioPassword } from '../actions/setStudioPassword'

// Studio is unprotected until a password exists, so that task is critical.
// The API server refuses every request while no key is set, so that task
// only needs to be important.
export const watchCredentials = sdk.setupOnInit(async (effects) => {
  const store = await storeJson.read().const(effects)

  if (!store?.studioPassword) {
    await sdk.action.createOwnTask(effects, setStudioPassword, 'critical', {
      reason: i18n('Set the Studio password before opening the web interface'),
    })
  }

  if (!store?.apiKey) {
    await sdk.action.createOwnTask(effects, setApiKey, 'important', {
      reason: i18n(
        'Set an API key so your agents can connect over the API and MCP',
      ),
    })
  }
})
