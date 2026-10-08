# HyperFrames

## Documentation

- [HyperFrames documentation](https://hyperframes.heygen.com/introduction) — the upstream guides, Studio manual and CLI reference.
- [HyperFrames repository](https://github.com/heygen-com/hyperframes) — source, skills and release notes.
- [Package README](https://github.com/bitcoinRph/hyperframes-startos/blob/main/README.md) — how this StartOS package differs from running HyperFrames yourself.

## What you get on StartOS

- **Studio**, the HyperFrames browser editor: preview a project, click elements to edit them, trim clips on the timeline, and export video. It shows one project at a time.
- **Agent API**, an authenticated REST API your AI agents use to create projects, write compositions, lint and check them, capture frames and render video on this server.
- **MCP Server**, the same capabilities as a Model Context Protocol endpoint for Claude Code, Codex, Hermes Agent, OpenClaw and other MCP clients.
- A **skills library** served from the service, including the matching HyperFrames skills, StartOS connection and production guides, eight community skills, and HeyGen's avatar, video and translation skills. The HeyGen skills use a separately authorized HeyGen account from the agent's machine; those hosted jobs do not run on your StartOS server.
- Your projects and finished renders live in the service's data and are included in backups.
- Two community skills make private work-session films (`day-in-my-life`, `session-story`). They run locally on the agent host from explicitly approved sources, not by automatically reading your chat history. Their instructions require owner review before preview or render; they are not for marketing or client history.

## Getting set up

1. Run **Set Studio Password**. Keep the username `studio` and the password it shows. Your browser asks for them when you open Studio.
2. Run **Set API Key** and copy the key. This is what your agents send as `Authorization: Bearer <key>` to the Agent API and the MCP Server.
3. Start the service. On the first start it creates a `welcome` project so Studio has something to show.
4. Open **Studio** from the Dashboard and sign in.
5. Connect an agent. Open the **Agent API** interface to see its address; the MCP address is the Agent API address plus `/mcp`. Give the agent that address and the API key. The skill at `/skills/hyperframes-startos-connect/SKILL.md` on the Agent API address has step-by-step settings for Claude Code, Codex, Hermes Agent and OpenClaw.

## Making a video

1. Ask your agent for a video. It creates a project, writes the composition, checks it on the server and queues a render.
2. Review in Studio. When the agent switches Studio to the project, reload the Studio tab, or run **Open Project in Studio** yourself and pick the project.
3. Download the render from the link the agent gives you, or open the project's `renders/` folder in Studio.

Your agent can also start from HeyGen's own launch videos. Ask for "a product sting like HeyGen's, for my brand": the agent imports one of the four re-brandable templates from the public `hyperframes-launches` repository, replaces the logos, copy and colors, and renders. HeyGen's media and fonts are not licensed for reuse, so the agent swaps them out.

Studio shows one project at a time. **Open Project in Studio** changes which one; only Studio restarts, and renders keep going.

### Studio on a phone

Studio was built for a desktop screen. On a phone held upright, this package shows the preview and the timeline full width and adds a bar at the bottom: **Preview** and **Timeline** make that panel fill the screen or put it back, and **Panels** opens Studio's Window menu to show the compositions, catalog, design or render panels and to reset the layout. Turn the phone sideways, or use a tablet, for the full desktop layout.

## Actions

- **Set Studio Password** — makes a new Studio password and shows it once. Running it again replaces the old one.
- **Set API Key** — makes a new API key and shows it once. Running it again replaces the old one, and every connected agent must be updated.
- **Open Project in Studio** — choose the project Studio serves.
- **Configure Provider Keys** — optional keys for hosted voices and music (HeyGen), text-to-speech (ElevenLabs), vision descriptions and Gemini voices (Gemini), capture descriptions (OpenRouter) and Figma import. Leave a field empty to skip that provider.
- **Configure Rendering** — how many Chrome workers a render uses, the low-memory profile for small servers, and how many render jobs run at the same time.

## Limitations

- Local speech-to-text (whisper) and the local Kokoro voice are not installed. Narration needs a HeyGen or ElevenLabs key from **Configure Provider Keys**, or an audio file your agent uploads.
- Compositions that load libraries from a CDN, such as the GSAP script the template uses, need the server to reach the internet during preview and render.
- HeyGen cloud rendering, publishing to hyperframes.dev and the HeyGen desktop app are not part of this package; rendering happens on your server.
