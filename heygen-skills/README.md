# HeyGen skills (vendored)

A copy of the three agent skills from [heygen-com/skills](https://github.com/heygen-com/skills): `heygen-avatar`, `heygen-video` and `heygen-translate`. They drive HeyGen's hosted avatar, video and translation products from an agent through the `heygen` CLI or the HeyGen MCP server. They are **not** HyperFrames skills; they are served from this service as a fourth skills tree so an agent connected to the server finds every HeyGen-related skill in one place.

- **Upstream commit:** `1bd5e4d33a028dfed3abf504c5e3dd644fb9ea8a` (master, 2026-07-14; v3.2.0 plus the CLI-correctness fixes #92–#98).
- **License:** MIT, see `LICENSE` (copied from upstream).
- **Where they run:** on the agent's own machine, like the community skills. This server never runs `heygen`; the `HEYGEN_API_KEY` set in **Configure Provider Keys** is for HyperFrames' own `tts`/`media-use` providers, not for these skills.

## Why a copy and not a submodule

A few lines are edited for this deployment (below). Upstream ships extra install tooling (`setup`, plugin manifests, `INSTALL_FOR_AGENTS.md`, `platforms/`) that is not served; only `<skill>/SKILL.md`, `references/` and `scripts/` are copied.

## Edits against upstream

Everything not listed here is byte-identical to upstream at the commit above.

| File | Edit | Why |
| --- | --- | --- |
| all three `SKILL.md` | "Report feedback (CLI mode)" → opt-in, off by default | `heygen feedback` sends a report to HeyGen after every task. Owner decides whether anything leaves the machine. |
| `heygen-translate/SKILL.md` | Auth verification no longer asks the user to paste the API key in chat or runs `echo "<key>" \| heygen auth login` | A key in the conversation lands in logs and transcripts. The owner signs in with `heygen auth login` or sets `HEYGEN_API_KEY` in the agent's env file. |
| `heygen-translate/references/troubleshooting.md` | `echo "${HEYGEN_API_KEY:0:8}…"` → set/unset check | Never print any part of a secret. |
| `heygen-avatar/SKILL.md`, `heygen-video/SKILL.md` | `/tmp/openclaw/uploads/` → the host's temp directory | Not every agent is OpenClaw. |
| `heygen-avatar/SKILL.md`, `heygen-video/SKILL.md` | `message(action:send, media:...)` → "the host's media mechanism", with the OpenClaw call and the Hermes Agent `MEDIA:<path>` form | Same reason; Hermes Agent is the agent this instance is built for. |
| `heygen-avatar/SKILL.md` | `SOUL.md` found → "OpenClaw or Hermes Agent environment", noting Hermes keeps it in its home directory | Hermes Agent also has a `SOUL.md`; the skill should treat it the same way. |

Not edited: prompt craft, style blocks, workflows, phase gates, MCP/CLI command references, references other than the one line above.

## Refreshing the copy

```bash
git clone --depth 1 https://github.com/heygen-com/skills /tmp/heygen-skills
cd /tmp/heygen-skills && git rev-parse HEAD        # record it above
cp -r heygen-avatar heygen-video heygen-translate <repo>/heygen-skills/skills/
cp LICENSE <repo>/heygen-skills/LICENSE
```

Then re-apply every edit in the table (`git diff` against the previous commit of this directory shows them), update the commit hash above, and check that `frontmatterDescription` in `server/src/skills.ts` still reads the `description: |` blocks (the unit test covers it).
