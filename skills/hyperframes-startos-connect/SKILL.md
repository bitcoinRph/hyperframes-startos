---
name: hyperframes-startos-connect
description: >
  Connect an agent or chat client to a HyperFrames StartOS service: Claude Code, Codex CLI,
  Hermes Agent, OpenClaw, Claude.ai custom connectors, Cursor, and any MCP client that speaks
  streamable HTTP with a bearer header, plus plain REST with curl. Covers the API key, the two
  interface addresses (Agent API and MCP Server), the StartOS root certificate, Tor and LAN
  reachability, and how to verify the connection. Use when a user says "connect my agent to my
  HyperFrames server" or an MCP client cannot reach the endpoint.
---

# Connect to HyperFrames on StartOS

The service exposes three interfaces in StartOS. The owner finds their addresses on the
service's **Interfaces** tab and decides where each is reachable (LAN, Tor, a domain).

| Interface      | What it is                                             | Auth                                              |
| -------------- | ------------------------------------------------------ | ------------------------------------------------- |
| **Studio**     | The browser editor and preview                         | HTTP basic: user `studio`, password from **Set Studio Password** |
| **Agent API**  | REST, `/api/v1/...`, `/openapi.json`, `/skills/...`    | `Authorization: Bearer <api key>` from **Set API Key**           |
| **MCP Server** | The Agent API address plus `/mcp`                      | the same bearer token                              |

StartOS enforces both credentials at its reverse proxy, and the API checks the bearer token
again itself. The MCP transport is **streamable HTTP, stateless**: every request is
self-contained, so there is no session to resume and clients may reconnect freely.

## 1. Get the two values

Ask the owner for:

1. The **Agent API** address, for example `https://hyperframes-api.<server>.local` (LAN) or an
   `.onion` address (Tor). The MCP URL is that address plus `/mcp`.
2. The **API key**, from the **Set API Key** action. Running the action again rotates the key and
   every client must be updated.

Verify before configuring anything:

```bash
curl -sS "$HF_URL/health"                                   # no auth: {"ok":true,...,"apiKeyConfigured":true}
curl -sS -H "Authorization: Bearer $HF_API_KEY" "$HF_URL/api/v1/server"
```

`apiKeyConfigured: false` means the owner has not run **Set API Key**; nothing else works yet.

## 2. Certificates, LAN and Tor

- LAN addresses (`*.local`) carry a certificate from the **StartOS root CA**, not a public CA.
  Either install that root certificate on the machine running the client (StartOS: **System →
  Root CA**), or point Node-based clients at it: `NODE_EXTRA_CA_CERTS=/path/to/startos-root-ca.crt`.
  Do not disable TLS verification.
- A public domain with a Let's Encrypt certificate needs nothing extra.
- `.onion` addresses need the client to go through Tor (`ALL_PROXY=socks5h://127.0.0.1:9050`
  for curl; many MCP clients cannot, so prefer LAN or a domain for agents).
- Mobile and remote agents (Hermes Agent on a VPS, OpenClaw on another box) need network reach
  to the server: same LAN, a VPN, Tor, or a public domain the owner enabled on that interface.

## 3. Client configuration

### Claude Code

```bash
claude mcp add --transport http hyperframes "$HF_URL/mcp" \
  --header "Authorization: Bearer $HF_API_KEY"
```

Then in a session: `/mcp` lists the server; tools appear as `mcp__hyperframes__<tool>`. Install
the skills locally too, so the router and domain knowledge are present:
`npx skills add heygen-com/hyperframes` and `npx skills add bitcoinRph/hyperframes-startos`.

### Codex CLI

Codex configures MCP servers in `~/.codex/config.toml`; a streamable HTTP server takes `url`
and reads its bearer token from an environment variable:

```bash
codex mcp add hyperframes --url "https://hyperframes-api.<server>.local/mcp" \
  --bearer-token-env-var HF_API_KEY
```

which writes:

```toml
[mcp_servers.hyperframes]
url = "https://hyperframes-api.<server>.local/mcp"
bearer_token_env_var = "HF_API_KEY"
```

Export `HF_API_KEY` in the shell that starts Codex, then `codex mcp list`. Install the skills
for Codex with `npx skills add heygen-com/hyperframes -a codex` and
`npx skills add bitcoinRph/hyperframes-startos -a codex` (they land in `.agents/skills/` or
`~/.codex/skills/`).

Source: `codex-rs/cli/src/mcp_cmd.rs` and the `mcp_servers` tests in openai/codex.

### Hermes Agent

Hermes reads MCP servers from `~/.hermes/config.yaml`. A remote server is a `url` entry with
`headers`; `${VAR}` placeholders resolve from `~/.hermes/.env` at connect time, so the key
never sits in the config file:

```yaml
mcp_servers:
  hyperframes:
    url: "https://hyperframes-api.<server>.local/mcp"
    headers:
      Authorization: "Bearer ${HF_API_KEY}"
    timeout: 1800          # tool-call timeout in seconds; renders are queued, checks can take minutes
    # ssl_verify: /path/to/startos-root-ca.pem   # when using the LAN address
```

Put `HF_API_KEY=...` in `~/.hermes/.env`. Hermes connects over Streamable HTTP by default. Start
a new session or run `/reload-mcp`. Install the skills with the Hermes target so the production
loop is in context:

```bash
npx skills add heygen-com/hyperframes -a hermes-agent
npx skills add bitcoinRph/hyperframes-startos -a hermes-agent
```

Source: the Hermes Agent MCP docs (`website/docs/user-guide/features/mcp.md` and
`reference/mcp-config-reference.md` in NousResearch/hermes-agent).

### OpenClaw

Server definitions live under `mcp.servers` in the OpenClaw config. Add one from **Settings →
MCP** in the Control UI, from the CLI, or directly in config:

```bash
openclaw mcp add hyperframes \
  --url https://hyperframes-api.<server>.local/mcp \
  --transport streamable-http
openclaw mcp doctor hyperframes --probe
```

Headers are set in config (the CLI adds the URL and transport):

```json5
{
  mcp: {
    servers: {
      hyperframes: {
        url: "https://hyperframes-api.<server>.local/mcp",
        transport: "streamable-http",
        headers: { Authorization: "Bearer <api key>" },
        requestTimeoutMs: 1800000,
      },
    },
  },
}
```

OpenClaw's docs ask that credentials not sit as literals in committed config; use its secret
mechanisms for the header value. `openclaw mcp doctor <name> --probe` proves the connection.
Skills load from `<workspace>/skills/` (highest precedence) and `~/.openclaw/skills/`:

```bash
npx skills add heygen-com/hyperframes -a openclaw
npx skills add bitcoinRph/hyperframes-startos -a openclaw
```

When OpenClaw itself runs on the same StartOS server, services do not share `localhost`; use
the Agent API's LAN address.

Source: `docs/tools/mcp.md`, `docs/cli/mcp/transports.md` and `docs/tools/skills.md` in
openclaw/openclaw.

### Claude.ai (web and desktop)

**Customize → Connectors → Add custom connector**, enter the MCP URL. Claude.ai connectors
authenticate with OAuth, not a static bearer header, so this service's endpoint is reachable
from Claude.ai only through a proxy that injects the header, or by using the hosted HeyGen
connector instead (`https://mcp.heygen.com/mcp/hyperframes/`), which renders on HeyGen's
infrastructure rather than on this server.

### Any other MCP client

Streamable HTTP, URL `<agent api>/mcp`, header `Authorization: Bearer <key>`. Clients that
only speak stdio can bridge with `mcp-remote`:

```bash
npx -y mcp-remote "$HF_URL/mcp" --header "Authorization: Bearer ${HF_API_KEY}"
```

### Plain REST

Read `GET /openapi.json` (authenticated) for the full surface. Minimal loop:

```bash
H="Authorization: Bearer $HF_API_KEY"
curl -sS -H "$H" -X POST -H 'content-type: application/json' -d '{"name":"promo"}' "$HF_URL/api/v1/projects"
curl -sS -H "$H" -X PUT --data-binary @index.html "$HF_URL/api/v1/projects/promo/files/index.html"
curl -sS -H "$H" -X POST "$HF_URL/api/v1/projects/promo/lint"
curl -sS -H "$H" -X POST -d '{}' "$HF_URL/api/v1/projects/promo/check"
JOB=$(curl -sS -H "$H" -X POST -H 'content-type: application/json' -d '{"quality":"looks"}' "$HF_URL/api/v1/projects/promo/renders" | jq -r .id)
curl -sS -H "$H" "$HF_URL/api/v1/renders/$JOB"
curl -sS -H "$H" -o promo.mp4 "$HF_URL/api/v1/renders/$JOB/download"
```

## 4. Verify the MCP connection

A working client lists these tools: `server_info`, `list_projects`, `create_project`,
`write_file`, `lint`, `check`, `snapshot`, `render_video`, `get_render_status`, `studio_open`,
`run_cli`, `list_skills`, `read_skill`. Call `server_info` first; it returns the public URLs
and the render limits. Then read `hyperframes-server` with `read_skill`.

## 5. Troubleshooting

| Problem                                   | Check                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `401` from the proxy before any JSON      | The token differs from the one **Set API Key** produced last. Rotating the key invalidates the old one. |
| `503 no API key is configured`            | Run **Set API Key** in StartOS.                                                                       |
| TLS handshake failure                     | Trust the StartOS root CA or use a domain with a public certificate.                                  |
| Connection refused / timeout              | The interface is not enabled for your network path (LAN vs Tor vs domain) on the Interfaces tab.     |
| Tools list is empty                       | The client reached a different path; the MCP URL must end in `/mcp`.                                   |
| Studio prompts for a login                | Expected: user `studio` and the Studio password. The API key does not open Studio.                     |
