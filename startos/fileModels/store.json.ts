import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

// Optional provider keys the HyperFrames CLI reads from the environment.
// An empty string means "not configured"; main.ts leaves such variables unset.
const providersShape = z.object({
  heygenApiKey: z.string().catch(''),
  elevenlabsApiKey: z.string().catch(''),
  geminiApiKey: z.string().catch(''),
  openrouterApiKey: z.string().catch(''),
  figmaToken: z.string().catch(''),
})

const renderingShape = z.object({
  // `auto` lets the CLI weigh cores, memory and frame count.
  workers: z.enum(['auto', '1', '2', '4', '8']).catch('auto'),
  // The CLI reads host RAM, not the container limit, so the operator can force it.
  lowMemoryMode: z.enum(['auto', 'on', 'off']).catch('auto'),
  // Render jobs the API server runs at the same time.
  maxConcurrentRenders: z.number().int().min(1).max(4).catch(1),
})

const voicestudioShape = z.object({
  // Owner opt-in: agents may send dub transcripts to the LLM configured in VoiceStudio, which may be a cloud service.
  allowLlmTranslation: z.boolean().catch(false),
})

const shape = z.object({
  // Bearer token for the agent API and MCP endpoint; set by the set-api-key action.
  apiKey: z.string().optional().catch(undefined),
  // Basic-auth password for Studio; set by the set-studio-password action.
  studioPassword: z.string().optional().catch(undefined),
  providers: providersShape.catch(() => providersShape.parse({})),
  rendering: renderingShape.catch(() => renderingShape.parse({})),
  voicestudio: voicestudioShape.catch(() => voicestudioShape.parse({})),
})

export type Store = z.infer<typeof shape>

export const storeJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: './store.json' },
  shape,
)
