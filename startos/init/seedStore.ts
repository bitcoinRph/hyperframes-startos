import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'
import { studioJson } from '../fileModels/studio.json'

// Every `.catch()` default lands on every init, which also repairs a file a
// user edited by hand. Credentials are not seeded here: the user mints them
// through the set-* actions so they are shown once and never guessed.
export const seedStore = sdk.setupOnInit(async (effects) => {
  await storeJson.merge(effects, {})
  await studioJson.merge(effects, {})
})
