---
name: hyperframes-voicestudio
description: >
  Put VoiceStudio narration, transcripts, cloned or designed voices and dubs into a
  HyperFrames project on this StartOS server. Use when a video needs a voiceover, captions
  timed from real speech, a voice that matches a reference recording, or footage dubbed into
  another language, and the voicestudio_* tools exist. Audio is written straight into the
  project; none of it passes through your context.
---

# VoiceStudio in a HyperFrames project

VoiceStudio is a separate StartOS service (self-hosted voice cloning, text-to-speech, transcription and dubbing). When the owner has installed it, this server exposes `voicestudio_*` tools (MCP) and `/api/v1/.../voicestudio/...` routes (REST). They call VoiceStudio server-side and save results **into the project**. You never see or carry audio bytes, and you never see VoiceStudio's key or address.

Read `/hyperframes-server` first for the project model. If the `voicestudio_*` tools are missing from your tool list, VoiceStudio tooling is not available to you: use the sources in `hyperframes-server` section 4 step 3 instead.

## 1. Preflight (always)

Call `voicestudio_status` (`GET /api/v1/voicestudio/status`).

| Result | Meaning and next step |
| --- | --- |
| `configured: false` | VoiceStudio is not installed on this server. Tell the owner VoiceStudio can be installed on this StartOS server; carry on without it. |
| `configured: true, reachable: false` | Installed but stopped or starting. Tell the owner to start it; retry later. |
| `ready.speak`, `ready.transcribe`, `ready.dub` | Estimates from VoiceStudio's own listings. A `false` means a model is missing or its licence is not accepted. |

Models and licences are the **owner's** job in the VoiceStudio Web UI. The text-to-speech model carries a non-commercial licence the owner must accept. Never try to install a model or accept a licence yourself; report what is missing and stop that branch.

## 2. Narration

1. `voicestudio_list_voices` and pick a profile `id`. No suitable voice: clone or design one (section 5).
2. `voicestudio_speak` with `project`, `text`, `voice` and, for non-English text, `language`. Optional: `speed` (0.25-4), `output` (a project-relative `.wav`), `effect_preset` (`raw` skips VoiceStudio's mastering).
   - Default output: `assets/voice/<first-words>-<n>.wav`. Long text is fine in one call; split by scene instead if you want one clip per scene, so each can be timed and replaced alone.
3. The result gives `path`, `duration` (seconds) and `size`. Use `duration` to set the scene length: the voiceover must fit the composition's `data-duration`, not the reverse.
4. Reference it from the composition as an audio clip. Per the upstream format reference (`/hyperframes`, `references/format.md`): every `<audio>` needs an `id`, `class="clip"`, `data-start` and `data-track-index`, and `data-volume="1"`; no `crossorigin`. For example:

   ```html
   <audio id="narration" class="clip" src="assets/voice/welcome-to-1.wav"
          data-start="0" data-track-index="2" data-volume="1"></audio>
   ```

   `data-start` is local to the composition that contains the element. Music under voice sits near `data-volume="0.14"` (see `references/sound.md`).
5. `lint`, then `check`, as usual. Judge the sound by measuring (`run_cli ["audio", "<video>", "--json"]` after a render), not by assuming.

Latency: the first request after VoiceStudio starts loads a model and may take minutes; on CPU, synthesis is slower than real time. A `busy or still loading` error is retryable. Do not fire many `voicestudio_speak` calls in parallel: VoiceStudio has one serial worker.

## 3. Captions from real speech

1. `voicestudio_transcribe` with `input` (the narration WAV or any project audio/video), `words: true`, optional `language`. Add `formats: ["srt"]` if you want subtitle files.
2. It writes `<input>.transcript.json` (VoiceStudio's full result) and `<input>.transcript.words.json`, already in the shape the captions reference expects: `[{ "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 }, ...]`. The reply is only a summary and a short preview. Read the words file with `read_file` when you build caption groups, and only as much as you need.
3. Build captions as in `/hyperframes` `references/captions.md`: group words, keep one group visible at a time, hard-kill each group after its exit, time to `end` of the last word. Check the transcript against the script you narrated: names and numbers are where recognition slips.
4. For narration you generated yourself you already know the text; transcription is still the way to get true word timing.

## 4. Dubbing

`voicestudio_dub` takes a project video (or audio) and returns a **job id** at once.

- `target_language` (ISO code), optional `source_language` if detection fails.
- `translation_provider`: `argos` (default, fast, needs a language pack per pair) or `nllb` (heavier, better). Only local translators are allowed; the text never goes to a cloud service.
- `voice`: `clone-original` (default) re-voices each original speaker; or a profile id for a single voice.
- `outputs`: any of `video` (dubbed MP4), `audio` (dubbed WAV mix with the original background), `srt`. Written to `assets/dub/<name>.<lang>.mp4|wav|srt` unless `output_dir` is set.
- `timing_strategy`: `smart_fit` (default) tolerates longer translations; `concise` fails when a line overflows its slot; `stretch_video` lengthens the video to fit the speech.

Poll `voicestudio_dub_status` (`GET /api/v1/voicestudio/dubs/<id>`) every 30-60 seconds. `stage` moves upload, prep, transcribe, translate, generate, download. Terminal states are `succeeded`, `failed`, `cancelled`, `interrupted` (the service restarted: resubmit). Read `warnings`: lines that could not be translated, or speakers whose voice could not be extracted. `voicestudio_dub_cancel` stops a job. Dubs run one at a time, and a dub of a few minutes of video can take much longer than the video on CPU. Tell the owner the expected wait; do not resubmit because it is slow.

Use the dubbed MP4 as footage in a composition (`<video ... data-has-audio="true">`) or the WAV as an `<audio>` clip over muted footage.

## 5. Voices: clone and design

- `voicestudio_clone_voice`: a 5-30 second, single-speaker, clean recording already in the project (`upload` or `fetch_asset` it first). **Only clone a voice the owner has the right to clone**: their own, or a speaker who gave permission. Pass `consent: "own_voice"` or `"speaker_permission"` so VoiceStudio records the basis. Never clone a public figure or a voice from third-party footage. If you do not know the right exists, ask the owner.
- `voicestudio_design_voice`: describe a voice in words VoiceStudio understands: gender, age, pitch, whispered style, and English accents or Chinese dialects ("elderly female, low pitch, british accent"). Words such as "raspy" or "warm" map to nothing; a description that maps to nothing is refused and the unmatched words are returned. For other timbres, clone from a recording.
- Both return a profile `id`. Save it in the project notes (`BRIEF.md`) so later sessions reuse the same voice.

## 6. Failure handling

| Message | Cause and what to do |
| --- | --- |
| `VoiceStudio is not installed/connected` | Not installed. Report; continue without voice. |
| `has not published its API key yet` | VoiceStudio is older than 0.5.7, still starting, or stopped. Report to the owner. |
| `no speech-recognition (ASR) model installed` (409) | Owner must install an ASR model in VoiceStudio. The message names the recommended one. |
| `needs its model licence accepted` (409) | Owner must read and accept it in VoiceStudio. |
| `Argos translation language pack is not installed` (409) | Owner installs the pack, or retry with `nllb` if installed. |
| `busy or still loading a model` (503) | Retry in a minute. |
| `not a VoiceStudio profile` | Use an id from `voicestudio_list_voices`. |
| `path ... escapes` / `project-relative` | Use project-relative paths only. |

## 7. Cost and hygiene

- Everything runs on the owner's hardware: no per-minute fees, but GPU or CPU time and a single serial queue. Batch your needs; avoid re-generating unchanged lines.
- Keep generated audio under `assets/voice/` and `assets/dub/`; delete drafts you no longer reference with `delete_file`.
- Do not paste transcripts into chat or into compositions wholesale; reference the files.
