---
name: hyperframes-production-checklist
description: >
  The gates a HyperFrames video passes before a delivery render and before hand-off, written
  for the StartOS server workflow: lint and check clean, frames reviewed, media present and
  licensed, audio mixed, variables resolved, output format and quality chosen, the user's
  final look in Studio, and the delivery note. Use before calling render_video with
  quality "delivery" and before telling the user a video is done.
---

# Production checklist

Work the list top to bottom. A gate that cannot be checked is reported, not skipped silently.

## Before the first real render

- [ ] **Brief answered.** `BRIEF.md` (or the user's message) names the audience, the message,
      the length, the aspect ratio and the delivery format. Unknown → ask once, then proceed
      with stated assumptions.
- [ ] **Project scaffolded** with `create_project` at the right `resolution`; the root
      `data-width`/`data-height` match the brief.
- [ ] **Storyboard modeled on a finished one.** For a launch, promo or announcement, the
      storyboard follows the shape of a `hyperframes-launches` storyboard (format line, VO
      and music direction, guardrails, timecoded beats); see `/hyperframes-launch-references`.
- [ ] **Registry first.** For every named look, effect or transition, `catalog_search` ran
      before hand-building, `catalog_item` was read for the variables, and `catalog_add` set
      them with `vars` (brand name, colors, logo paths) instead of editing the installed file.
      Installs happened before parallel work.
- [ ] **Imported material re-branded.** A project from `import_project` has no HeyGen marks,
      screenshots or commercial fonts left unless the user owns the rights; see the license
      section of `/hyperframes-launch-references`.
- [ ] **Media present.** Every `src` in the composition points at a file inside the project
      (`list_files` shows it) or at a URL the server can fetch. Footage with sound carries
      `data-has-audio="true"`; silent footage is `muted`. Every `<video>`/`<audio>` has an `id`.
- [ ] **Licensing stated.** Music, footage and fonts you added are either the user's, from the
      HeyGen catalog through `media-use`, or clearly licensed. Say so in the delivery note.
- [ ] **Lint clean.** `lint` returns `errorCount: 0`. Warnings are read, not ignored; fix the
      ones about duration sources, missing ids and nested structure.
- [ ] **Check clean.** `check` returns `ok: true` with `browserSkipped: false`. Layout findings
      that are deliberate carry the `data-layout-allow-*` marker, with a reason in a comment.
      A fresh `create_project` scaffold fails this gate on purpose: it is 10 s long with an
      empty timeline, and `check` reports `sweep_static` for any composition of 3 s or more
      whose sampled frames do not change. Animate the composition before running `check`, or,
      for a deliberately still card, put `data-no-timeline` on the root element. Never work
      around `sweep_static` any other way; it is the gate that catches a video whose motion
      silently failed to run.
- [ ] **Frames reviewed.** `snapshot` at each scene midpoint and at the last 0.2 s. Look for
      clipped text, type too small for the medium (body copy under about 36 px at 1080p is
      a flag), empty web-page layouts, overlap, unreadable contrast.
- [ ] **Motion verified.** Entrances land before `data-duration`; nothing is still animating at
      the final frame unless intended; a `*.motion.json` sidecar exists for sequences where
      order matters.
- [ ] **Audio mixed.** Narration sits above the bed (carve or duck when both play); levels
      peak below 0 dBFS; audio ends with the picture.
- [ ] **Variables resolved.** Compositions with `data-composition-variables` render with the
      intended `variables`; a `--strict-variables` run (`extraArgs`) catches typos.
- [ ] **Draft render watched.** A `quality: "draft"` render succeeded and was downloaded or
      checked with `run_cli ["info", "--json"]`; its duration matches the brief.

## Before the delivery render

- [ ] **Final look.** `studio_open` for the project, URL handed to the user, approval received
      (or the brief is autonomous and the summary was posted).
- [ ] **Format chosen.** `mp4` to share; `webm` or `mov` for transparency; `gif` only for docs
      (`fps: 15`); `png-sequence` for compositing; `hls` for streaming. `fps` matches the
      brief (30 unless asked; 60 doubles render time).
- [ ] **Quality.** `quality: "delivery"` for the final file. `resolution` only when the brief
      asks for 4K and the composition's aspect ratio matches.
- [ ] **Output name set** (`outputName`) so the file is recognisable in `renders/`.
- [ ] **Server capacity.** `list_renders` shows no other running job that this render would
      wait behind, or the user knows it will queue.

## Before saying "done"

- [ ] `get_render_status` is `succeeded`; `outputSize` is plausible for the duration.
- [ ] `run_cli ["info", "--json"]` or the download's `ffprobe` duration equals the composition
      duration (to within one frame).
- [ ] The delivery note has: the download link, the file path in the project, duration, size,
      format, the Studio URL, what media was used and its source, and anything not done
      (no narration because no TTS provider, a CDN script that had to be inlined, and so on).
- [ ] The project is left in a state the user can keep editing in Studio: no half-written
      files, snapshots in `snapshots/`, renders in `renders/`.
