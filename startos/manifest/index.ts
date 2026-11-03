import { setupManifest } from '@start9labs/start-sdk'
import { i18n } from '../i18n'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'hyperframes',
  title: 'HyperFrames',
  license: 'Apache-2.0',
  packageRepo: 'https://github.com/bitcoinRph/hyperframes-startos',
  upstreamRepo: 'https://github.com/heygen-com/hyperframes',
  marketingUrl: 'https://hyperframes.heygen.com/',
  donationUrl: null,
  description: { short, long },
  volumes: ['main'],
  images: {
    hyperframes: {
      source: { dockerBuild: {} },
      arch: ['x86_64', 'aarch64'],
    },
  },
  dependencies: {
    voicestudio: {
      description: i18n(
        'Optional. Lets agents narrate, transcribe, clone voices and dub video with VoiceStudio, saving the audio straight into HyperFrames projects.',
      ),
      optional: true,
      metadata: {
        title: 'VoiceStudio',
        icon: 'https://raw.githubusercontent.com/debpalash/VoiceStudio/main/docs/logo.svg',
      },
    },
  },
})
