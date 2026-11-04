import { i18n } from './i18n'
import { sdk } from './sdk'
import { storeJson } from './fileModels/store.json'
import { studioJson } from './fileModels/studio.json'
import {
  apiPort,
  dataDir,
  homeSubpath,
  mcpPath,
  projectsSubpath,
  studioPort,
  voicestudioHostId,
  voicestudioId,
  voicestudioKeyFile,
  voicestudioMount,
  voicestudioPort,
} from './utils'

const mounts = sdk.Mounts.of().mountVolume({
  volumeId: 'main',
  subpath: null,
  mountpoint: dataDir,
  readonly: false,
})

export const main = sdk.setupMain(async ({ effects }) =>
  // `dynamic` so a Studio project switch restarts only the Studio daemon and
  // leaves render jobs on the API server untouched.
  sdk.Daemons.dynamic(effects, async ({ effects }) => {
    const store = await storeJson.read().const(effects)
    const studioProject =
      (await studioJson.read((s) => s.project).const(effects)) ?? ''
    const studioUrls =
      (await sdk.host
        .getOwn(effects, 'studio', (host) =>
          host?.bindings[studioPort]?.interfaces['studio']?.addressInfo.format(
            'urlstring',
          ),
        )
        .const()) ?? []
    const apiUrls =
      (await sdk.host
        .getOwn(effects, 'api', (host) =>
          host?.bindings[apiPort]?.interfaces['api']?.addressInfo.format(
            'urlstring',
          ),
        )
        .const()) ?? []

    // VoiceStudio is optional. `.const()` on the bare address string restarts
    // this service once when VoiceStudio is installed or removed, and not when
    // it updates. Absent means absent: no mount, no env, no placeholder.
    const voicestudioAddress = await sdk.host
      .getBridgeAddress(effects, {
        packageId: voicestudioId,
        hostId: voicestudioHostId,
        internalPort: voicestudioPort,
        ssl: false,
      })
      .const()

    const providers = store?.providers
    const rendering = store?.rendering
    const allowLlmTranslation = store?.voicestudio?.allowLlmTranslation === true

    // Env the HyperFrames CLI reads, shared by Studio and the API server.
    const sharedEnv: Record<string, string> = {
      HOME: `${dataDir}/${homeSubpath}`,
      HYPERFRAMES_NO_TELEMETRY: '1',
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      HYPERFRAMES_SKIP_SKILLS: '1',
      HYPERFRAMES_PROJECTS_DIR: `${dataDir}/${projectsSubpath}`,
      CONTAINER: 'true',
    }
    if (providers?.heygenApiKey)
      sharedEnv.HEYGEN_API_KEY = providers.heygenApiKey
    if (providers?.elevenlabsApiKey)
      sharedEnv.ELEVENLABS_API_KEY = providers.elevenlabsApiKey
    if (providers?.geminiApiKey)
      sharedEnv.GEMINI_API_KEY = providers.geminiApiKey
    if (providers?.openrouterApiKey)
      sharedEnv.OPENROUTER_API_KEY = providers.openrouterApiKey
    if (providers?.figmaToken) sharedEnv.FIGMA_TOKEN = providers.figmaToken
    if (rendering?.lowMemoryMode === 'on')
      sharedEnv.PRODUCER_LOW_MEMORY_MODE = '1'
    if (rendering?.lowMemoryMode === 'off')
      sharedEnv.PRODUCER_LOW_MEMORY_MODE = '0'

    return sdk.Daemons.of(effects)
      .addDaemon('studio', {
        subcontainer: sdk.SubContainer.of(
          effects,
          { imageId: 'hyperframes' },
          mounts,
          'studio',
        ),
        exec: {
          command: ['hf-studio'],
          env: {
            ...sharedEnv,
            HYPERFRAMES_PREVIEW_HOST: '0.0.0.0',
            STUDIO_PORT: String(studioPort),
            STUDIO_PROJECT: studioProject,
          },
        },
        ready: {
          display: i18n('Studio'),
          fn: () =>
            sdk.healthCheck.checkPortListening(effects, studioPort, {
              successMessage: i18n('Studio is ready'),
              errorMessage: i18n('Studio is not ready'),
            }),
          gracePeriod: 60_000,
        },
        requires: [],
      })
      .addDaemon('server', {
        subcontainer: sdk.SubContainer.of(
          effects,
          { imageId: 'hyperframes' },
          voicestudioAddress
            ? mounts.mountDependency({
                dependencyId: voicestudioId,
                volumeId: 'public',
                subpath: null,
                mountpoint: voicestudioMount,
                readonly: true,
              })
            : mounts,
          'server',
        ),
        exec: {
          command: ['hf-server'],
          env: {
            ...sharedEnv,
            PORT: String(apiPort),
            HF_API_KEY: store?.apiKey ?? '',
            HF_STUDIO_PORT: String(studioPort),
            HF_STUDIO_URLS: JSON.stringify(studioUrls),
            HF_API_URLS: JSON.stringify(apiUrls),
            HF_MCP_PATH: mcpPath,
            HF_RENDER_WORKERS: rendering?.workers ?? 'auto',
            HF_MAX_CONCURRENT_RENDERS: String(
              rendering?.maxConcurrentRenders ?? 1,
            ),
            ...(voicestudioAddress
              ? {
                  VOICESTUDIO_URL: `http://${voicestudioAddress}`,
                  VOICESTUDIO_KEY_FILE: voicestudioKeyFile,
                  ...(allowLlmTranslation
                    ? { VOICESTUDIO_ALLOW_LLM_TRANSLATION: '1' }
                    : {}),
                }
              : {}),
          },
        },
        ready: {
          display: i18n('Agent API and MCP'),
          fn: () =>
            sdk.healthCheck.checkPortListening(effects, apiPort, {
              successMessage: i18n('The agent API and MCP server are ready'),
              errorMessage: i18n('The agent API and MCP server are not ready'),
            }),
        },
        requires: [],
      })
  }),
)
