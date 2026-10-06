import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.135:0',
  releaseNotes: {
    en_US:
      'Initial release for StartOS: HyperFrames Studio, the agent API and MCP server, and the skills library.',
    es_ES:
      'Versión inicial para StartOS: HyperFrames Studio, la API para agentes y el servidor MCP, y la biblioteca de habilidades.',
    de_DE:
      'Erstveröffentlichung für StartOS: HyperFrames Studio, Agenten-API und MCP-Server sowie die Skills-Bibliothek.',
    pl_PL:
      'Pierwsze wydanie dla StartOS: HyperFrames Studio, API dla agentów i serwer MCP oraz biblioteka umiejętności.',
    fr_FR:
      'Version initiale pour StartOS : HyperFrames Studio, l’API agents et le serveur MCP, et la bibliothèque de compétences.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
