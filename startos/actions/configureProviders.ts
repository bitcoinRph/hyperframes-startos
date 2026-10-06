import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'

const { InputSpec, Value } = sdk

// Every key is optional. HyperFrames works without any of them; they unlock
// hosted voices, music, vision descriptions and Figma import.
export const inputSpec = InputSpec.of({
  heygenApiKey: Value.text({
    name: i18n('HeyGen API key'),
    description: i18n(
      'Hosted voices, music and sound effects, and HeyGen cloud rendering (HEYGEN_API_KEY).',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  elevenlabsApiKey: Value.text({
    name: i18n('ElevenLabs API key'),
    description: i18n(
      'Text-to-speech when no HeyGen key is present (ELEVENLABS_API_KEY).',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  geminiApiKey: Value.text({
    name: i18n('Gemini API key'),
    description: i18n(
      'Frame descriptions for snapshots, website capture captions, Gemini voices and Lyria music (GEMINI_API_KEY).',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  openrouterApiKey: Value.text({
    name: i18n('OpenRouter API key'),
    description: i18n(
      'Vision model for website capture descriptions; wins over Gemini for that step (OPENROUTER_API_KEY).',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  figmaToken: Value.text({
    name: i18n('Figma token'),
    description: i18n(
      'Lets the hyperframes figma commands import assets, tokens and components (FIGMA_TOKEN).',
    ),
    required: false,
    default: null,
    masked: true,
  }),
})

export const configureProviders = sdk.Action.withInput(
  'configure-providers',

  async () => ({
    name: i18n('Configure Provider Keys'),
    description: i18n(
      'Optional API keys for voice, music, vision and Figma. Studio and the agent API restart to apply them.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => {
    const providers = await storeJson.read((s) => s.providers).once()
    return {
      heygenApiKey: providers?.heygenApiKey || null,
      elevenlabsApiKey: providers?.elevenlabsApiKey || null,
      geminiApiKey: providers?.geminiApiKey || null,
      openrouterApiKey: providers?.openrouterApiKey || null,
      figmaToken: providers?.figmaToken || null,
    }
  },

  async ({ effects, input }) =>
    storeJson.merge(effects, {
      providers: {
        heygenApiKey: input.heygenApiKey ?? '',
        elevenlabsApiKey: input.elevenlabsApiKey ?? '',
        geminiApiKey: input.geminiApiKey ?? '',
        openrouterApiKey: input.openrouterApiKey ?? '',
        figmaToken: input.figmaToken ?? '',
      },
    }),
)
