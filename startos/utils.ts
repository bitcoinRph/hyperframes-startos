// Constants shared across the package. Ports are internal to the container;
// StartOS decides where each interface is reachable.

/** HyperFrames Studio (`hyperframes preview`) listens here. */
export const studioPort = 3002

/** The agent API and MCP server written for this package listens here. */
export const apiPort = 3100

/** Where the `main` volume is mounted inside both subcontainers. */
export const dataDir = '/data'

/** Every HyperFrames project is a directory under this path, inside the volume. */
export const projectsSubpath = 'projects'

/** The HyperFrames CLI keeps `~/.hyperframes`, `~/.cache` and `~/.heygen` here. */
export const homeSubpath = 'home'

/** The one username the Studio basic-auth gate accepts. */
export const studioUser = 'studio'

/** Path of the MCP endpoint on the API port. */
export const mcpPath = '/mcp'

// VoiceStudio is an optional dependency. These mirror the stable contract in
// bitcoinRph/voicestudio-startos (deploy/startos/startos/utils.ts: `mainHostId`,
// `apiPort`; fileModels/credentials.json.ts: `credentials.json` = { apiKey } on
// its `public` volume). Keep them in step with that package.

/** The package id of VoiceStudio. */
export const voicestudioId = 'voicestudio'

/** VoiceStudio's host id and internal (plain HTTP) port; it checks the bearer key itself. */
export const voicestudioHostId = 'main'
export const voicestudioPort = 3900

/** First VoiceStudio release that publishes `credentials.json` on its `public` volume. */
export const voicestudioVersionRange = '>=0.5.7:0'

/** Where VoiceStudio's `public` volume is mounted (read-only) in the API server's subcontainer. */
export const voicestudioMount = '/mnt/voicestudio'
export const voicestudioKeyFile = `${voicestudioMount}/credentials.json`
