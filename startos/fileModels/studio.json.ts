import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

// Which project directory Studio serves. Written by the open-studio-project
// action and by the API server (so agents can switch Studio too); main.ts
// restarts only the Studio daemon when it changes.
const shape = z.object({
  project: z.string().catch(''),
})

export const studioJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: './startos/studio.json' },
  shape,
)
