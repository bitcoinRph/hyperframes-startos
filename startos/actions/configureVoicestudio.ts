import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  allowLlmTranslation: Value.toggle({
    name: i18n('Allow LLM translation'),
    description: i18n(
      'When on, agents may send dub transcripts to the LLM provider configured in VoiceStudio, which may be a cloud service. A local LLM keeps the text on this server. When off, dubbing translates only with the Argos or NLLB models on this server.',
    ),
    default: false,
  }),
})

export const configureVoicestudio = sdk.Action.withInput(
  'configure-voicestudio',

  async () => ({
    name: i18n('VoiceStudio Dubbing'),
    description: i18n(
      'Choose whether agents may use LLM translation when dubbing with VoiceStudio. The agent API restarts to apply it.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    // Harmless without VoiceStudio, so it is always visible.
    visibility: 'enabled',
  }),

  inputSpec,

  async () => {
    const voicestudio = await storeJson.read((s) => s.voicestudio).once()
    return { allowLlmTranslation: voicestudio?.allowLlmTranslation ?? false }
  },

  async ({ effects, input }) =>
    storeJson.merge(effects, {
      voicestudio: { allowLlmTranslation: input.allowLlmTranslation },
    }),
)
