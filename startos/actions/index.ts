import { sdk } from '../sdk'
import { setApiKey } from './setApiKey'
import { setStudioPassword } from './setStudioPassword'
import { configureProviders } from './configureProviders'
import { configureRendering } from './configureRendering'
import { configureVoicestudio } from './configureVoicestudio'
import { openStudioProject } from './openStudioProject'

export const actions = sdk.Actions.of()
  .addAction(setStudioPassword)
  .addAction(setApiKey)
  .addAction(openStudioProject)
  .addAction(configureProviders)
  .addAction(configureRendering)
  .addAction(configureVoicestudio)
