# Community skills: StartOS adaptations

Upstream: `heygen-com/hyperframes-community-skills`, pinned by the existing
`community-skills/` submodule at `ba7a0bb6d3567d124c51f6074625043bfe0b32eb`.
All eight skills are packaged once. Six were already served; this change adds
`day-in-my-life` and `session-story`. The pin already equals upstream HEAD.

## Exact edits

`day-in-my-life.SKILL.md` and `session-story.SKILL.md` are upstream instructions
with one deployment-rules section inserted before “When to use / when not”.
Docker copies the original full tree, then replaces those two SKILL.md files
in place. No additional skill root or renamed duplicate is introduced.
All original scripts, assets, references, licenses and creative instructions
remain unchanged. These overlays are instruction gates, not code enforcement.

The inserted section requires explicit source consent, no automatic harvesting,
owner review before preview/scoring/render, real receipts, private local files,
no private-history uploads, `--describe false` for snapshots, isolated writable
job directories, approved dependencies, compatible Python environments, and
Linux soundfont setup. It preserves upstream's personal/internal-demo scope
and no-marketing restriction; it does not invent a native Hermes harvester.

## Shared execution rules for all eight

Read the selected scripts before running them. Copy the complete skill and any
referenced helper skills into a fresh private writable per-job workspace.
Never install into or execute output-mutating scripts from the served tree.
In particular, p5-paint-animation and the camera-3d-captions hand helper use
shared engine output directories and remove temporary frames; a per-job copy
avoids read-only failures and cross-job collisions. Use safe basename IDs.

Downloads, Chrome installs, external fonts/CDNs, transcription models, network
samples and third-party profile lookups need the appropriate consent. Review
Strudel JavaScript before executing it. Keep its recorder on loopback in an
isolated trusted workspace, not a network-facing shared directory; do not rely
on its simple path-prefix checks as a security boundary. prod-by-claude has no
lockfile; do not claim every helper's dependencies are locked or offline.

Check Linux Chrome availability; supply CHROME_PATH where supported. Do not
blindly replace older CLI pins or mutable upstream commands. Report versions,
missing tools and outbound dependencies before execution. Server/API discovery
is verified separately from any end-to-end film render.

## Refresh

Inspect upstream changes before moving the submodule pin. Regenerate the two
overlays from the new original SKILL.md files, preserving only the deployment
section above. Run the complete skill-library test: it checks Docker assembly,
eight community skills, unique names, complete files, overlay equality and
REST/MCP delivery. Preserve all license notices. Never harvest real transcripts
as part of integration tests or CI.
