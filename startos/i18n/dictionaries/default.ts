export const DEFAULT_LANG = 'en_US'

const dict = {
  // main.ts
  Studio: 0,
  'Studio is ready': 1,
  'Studio is not ready': 2,
  'Agent API and MCP': 3,
  'The agent API and MCP server are ready': 4,
  'The agent API and MCP server are not ready': 5,

  // interfaces.ts
  'HyperFrames Studio: preview, edit and render the selected project in the browser': 6,
  'Agent API': 7,
  'REST API for agents: projects, files, lint, check, snapshots and render jobs. Send the API key as a bearer token.': 8,
  'MCP Server': 9,
  'Model Context Protocol endpoint (streamable HTTP) for Claude Code, Codex, Hermes Agent, OpenClaw and other MCP clients': 10,

  // actions/setApiKey.ts
  'Set API Key': 11,
  'Generate a new API key for the agent API and MCP server. Replaces any existing key.': 12,
  'Replaces the current API key. Connected agents must be updated.': 13,
  'Agent API Key': 14,
  'Send this key as "Authorization: Bearer <key>" to the Agent API and to the MCP Server interface. The MCP endpoint is the Agent API address plus the path below.': 15,
  'API key': 16,
  'MCP path': 17,

  // actions/setStudioPassword.ts
  'Set Studio Password': 18,
  'Generate a new password for the Studio web interface. Replaces any existing password.': 19,
  'Replaces the current Studio password.': 20,
  'Studio Login': 21,
  'Your browser asks for these when you open Studio.': 22,
  Username: 23,
  Password: 24,

  // actions/configureProviders.ts
  'HeyGen API key': 25,
  'Hosted voices, music and sound effects, and HeyGen cloud rendering (HEYGEN_API_KEY).': 26,
  'ElevenLabs API key': 27,
  'Text-to-speech when no HeyGen key is present (ELEVENLABS_API_KEY).': 28,
  'Gemini API key': 29,
  'Frame descriptions for snapshots, website capture captions, Gemini voices and Lyria music (GEMINI_API_KEY).': 30,
  'OpenRouter API key': 31,
  'Vision model for website capture descriptions; wins over Gemini for that step (OPENROUTER_API_KEY).': 32,
  'Figma token': 33,
  'Lets the hyperframes figma commands import assets, tokens and components (FIGMA_TOKEN).': 34,
  'Configure Provider Keys': 35,
  'Optional API keys for voice, music, vision and Figma. Studio and the agent API restart to apply them.': 36,

  // actions/configureRendering.ts
  'Render workers': 37,
  'Chrome instances per render. Each one needs about 256 MB of RAM. Auto weighs cores, memory and frame count.': 38,
  Auto: 39,
  'Low memory mode': 40,
  'One worker and screenshot capture. The CLI reads the host RAM, not the container limit, so force it on a small server.': 41,
  On: 42,
  Off: 43,
  'Concurrent render jobs': 44,
  'How many render jobs the agent API runs at the same time. Jobs beyond this wait in the queue.': 45,
  'Configure Rendering': 46,
  'Worker count, memory profile and render queue size. Studio and the agent API restart to apply them.': 47,

  // actions/openStudioProject.ts
  Project: 48,
  'Studio shows one project at a time. Agents can also switch it through the API.': 49,
  'No projects yet. Create one with the agent API or wait for the welcome project.': 50,
  'Open Project in Studio': 51,
  'Choose which project the Studio interface serves. Only Studio restarts.': 52,

  // init/watchCredentials.ts
  'Set the Studio password before opening the web interface': 53,
  'Set an API key so your agents can connect over the API and MCP': 54,

  // manifest/index.ts
  'Optional. Lets agents narrate, transcribe, clone voices and dub video with VoiceStudio, saving the audio straight into HyperFrames projects.': 55,
  'VoiceStudio Dubbing': 56,
  'Choose whether agents may use LLM translation when dubbing with VoiceStudio. The agent API restarts to apply it.': 57,
  'Allow LLM translation': 58,
  'When on, agents may send dub transcripts to the LLM provider configured in VoiceStudio, which may be a cloud service. A local LLM keeps the text on this server. When off, dubbing translates only with the Argos or NLLB models on this server.': 59,
} as const

/**
 * Plumbing. DO NOT EDIT.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
