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
