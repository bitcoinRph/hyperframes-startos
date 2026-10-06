import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  workers: Value.select({
    name: i18n('Render workers'),
    description: i18n(
      'Chrome instances per render. Each one needs about 256 MB of RAM. Auto weighs cores, memory and frame count.',
    ),
    default: 'auto',
    values: {
      auto: i18n('Auto'),
      '1': '1',
      '2': '2',
      '4': '4',
      '8': '8',
    },
  }),
  lowMemoryMode: Value.select({
    name: i18n('Low memory mode'),
    description: i18n(
      'One worker and screenshot capture. The CLI reads the host RAM, not the container limit, so force it on a small server.',
    ),
    default: 'auto',
    values: {
      auto: i18n('Auto'),
      on: i18n('On'),
      off: i18n('Off'),
    },
  }),
  maxConcurrentRenders: Value.number({
    name: i18n('Concurrent render jobs'),
    description: i18n(
      'How many render jobs the agent API runs at the same time. Jobs beyond this wait in the queue.',
    ),
    required: true,
    default: 1,
    min: 1,
    max: 4,
    step: 1,
    integer: true,
    units: null,
    placeholder: null,
  }),
})

export const configureRendering = sdk.Action.withInput(
  'configure-rendering',

  async () => ({
    name: i18n('Configure Rendering'),
    description: i18n(
      'Worker count, memory profile and render queue size. Studio and the agent API restart to apply them.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => {
    const rendering = await storeJson.read((s) => s.rendering).once()
    return {
      workers: rendering?.workers ?? 'auto',
      lowMemoryMode: rendering?.lowMemoryMode ?? 'auto',
      maxConcurrentRenders: rendering?.maxConcurrentRenders ?? 1,
    }
  },

  async ({ effects, input }) =>
    storeJson.merge(effects, {
      rendering: {
        workers: input.workers,
        lowMemoryMode: input.lowMemoryMode,
        maxConcurrentRenders: input.maxConcurrentRenders,
      },
    }),
)
