import { sdk } from './sdk'
import { voicestudioId, voicestudioVersionRange } from './utils'

// VoiceStudio is optional: HyperFrames works without it. When it is installed
// the agent API gains the voicestudio_* tools (see main.ts). `running` so
// StartOS tells the owner when VoiceStudio is stopped.
export const setDependencies = sdk.setupDependencies(async () => ({
  [voicestudioId]: {
    kind: 'running',
    versionRange: voicestudioVersionRange,
    healthChecks: [],
  },
}))
