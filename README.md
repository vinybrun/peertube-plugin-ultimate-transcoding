# PeerTube Ultimate Transcoding

`peertube-plugin-ultimate-transcoding` is a PeerTube server plugin that exposes the documented transcoding profile controls that PeerTube plugins can configure.

The goal is simple: make PeerTube transcoding easier to tune from the admin UI instead of forcing administrators to edit plugin code for every bitrate, compatibility tweak, or FFmpeg override.

## What It Controls

- Per-resolution bitrate caps for `144p`, `240p`, `360p`, `480p`, `720p`, `1080p`, `1440p`, and `2160p`
- Generated FFmpeg options such as `-crf`, `-preset`, `-profile:v`, `-pix_fmt`, `-maxrate`, `-bufsize`, `-b:a`, `-ar`, and `-profile:a`
- Audio copy / passthrough, including the PeerTube 8.x split-AAC case where `canCopyAudio` is forced off
- PeerTube transcoding profile `scaleFilter.name`
- PeerTube transcoding profile `inputOptions`
- PeerTube transcoding profile `outputOptions`
- PeerTube VOD and live encoder priority hints for `libx264`, `aac`, and `libfdk_aac`
- Matching live transcoding profiles for the same encoders

## Why This Plugin Exists

PeerTube's transcoding plugin API is intentionally small and powerful. According to the official PeerTube plugin API, transcoding profiles can return:

- `copy`
- `scaleFilter.name`
- `inputOptions`
- `outputOptions`

PeerTube also lets plugins influence encoder priority with `addVODEncoderPriority(...)`.

This plugin turns those documented controls into a usable admin interface.

Every setting applies to **both VOD and live**, because the same builders are
registered for both. The setting names are prefixed `vod-` for historical
reasons only — a `720p` cap of 2000 kbps comes out as `-maxrate:v:1 2000000` on
a live rung just as it does on a VOD rendition. Leave PeerTube's *live*
transcoding profile set to `default` if you want the plugin to affect uploads
alone.

## Requirements

- PeerTube `>= 7.0.0`

## Installation

From the PeerTube admin UI: **Administration → Plugins → Search plugins**, search
for `ultimate-transcoding`, install. Or from the CLI:

```bash
npm install peertube-plugin-ultimate-transcoding
```

Install **0.7.2 or newer**. The registry served `0.6.2` for a long time, and that
release predates the split-audio fix, the live stream-specifier fix, and the
admin UI working at all on PeerTube 8.x.

If you are testing locally from disk, install it with your normal local PeerTube plugin workflow.

When using PeerTube's local `--plugin-path` install flow for testing, treat source edits as package updates:

- Re-run the plugin install command after changing plugin files
- Restart PeerTube after reinstalling so the updated server code and client scripts are loaded

## Marketplace Name

PeerTube plugin package names must start with `peertube-plugin-`. In practice, PeerTube surfaces the short plugin name in its UI, so this package is named `peertube-plugin-ultimate-transcoding` to show up cleanly as `ultimate-transcoding` in the plugin list.

## Configuration Overview

The admin settings are split into four sections:

- Quality & Bitrate
- Compatibility & Stream Handling
- Max Bitrate Per Resolution
- Expert Options

### Quality & Bitrate

These settings model the common generated FFmpeg flags directly:

| Setting | Generated flag or API field | Notes |
| --- | --- | --- |
| Video quality (CRF) | `-crf` | Lower means higher quality and larger files. |
| Encoder speed / compression preset | `-preset` | `ultrafast` through `veryslow`, including PeerTube’s `veryfast`. |
| Audio bitrate | `-b:a` | Passed when audio is re-encoded; ignored for copied audio. FFmpeg's built-in `aac` encoder produces ~244 kbps whatever is set; `libfdk_aac` reaches ~530 kbps and saturates there. |
| Audio sample rate | `-ar` | Keep the source rate, or force 44100 / 48000. |
| Rate-control buffer multiplier | `-bufsize` | Computed from the active maxrate. A buffer is always emitted, because libx264 ignores `-maxrate` without one; enable this only to move the multiplier off PeerTube's `2`. |

### Compatibility & Stream Handling

This section keeps the web-playback and pipeline controls together:

- H.264 profile
- Pixel format
- Scale filter override
- Audio copy / passthrough mode — whether the uploaded audio is kept as-is or re-encoded

### Max Bitrate Per Resolution

For each resolution, the plugin exposes:

- A checkbox that enables the plugin's bitrate cap override for that resolution
- A maxrate cap for the rendition
- A separate source / non-standard resolution fallback bitrate for cases where PeerTube generates a source-height or other non-standard output

Important:

- These checkboxes do **not** ask PeerTube to generate or suppress a resolution. PeerTube already has native transcoding toggles for that.
- In this plugin, a checked ladder box only means "apply this maxrate override when PeerTube already decided to build this rendition."
- All overrides start disabled by default, so administrators can opt in only to the pieces they actually want.
- Disabled value fields stay visible but are dimmed and non-editable so the current saved value is still visible without implying that it is active.
- Numeric fields snap to their documented range when you leave the field. The server clamps these values anyway, so this keeps the number on screen equal to the number that runs. Clearing a field restores its default.

The default cap values are:

| Resolution | Enabled by default | Default maxrate when enabled |
| --- | --- | --- |
| 144p | No | `250 kb/s` |
| 240p | No | `400 kb/s` |
| 360p | No | `700 kb/s` |
| 480p | No | `1200 kb/s` |
| 720p | No | `2500 kb/s` |
| 1080p | No | `4200 kb/s` |
| 1440p | No | `6500 kb/s` |
| 2160p | No | `10000 kb/s` |

### Expert Options

This section contains the escape hatches and the most technical controls.

If a dedicated setting is missing, add the FFmpeg flag you want in one of the extra input/output fields.

There are four multiline FFmpeg fields:

- Additional video input options
- Additional video output options
- Additional audio input options
- Additional audio output options

Rules:

- Put one complete FFmpeg option per line
- Lines beginning with `#` are ignored
- These options are appended after the plugin's generated defaults
- Later duplicate flags can intentionally override earlier generated flags
- During live transcoding, PeerTube applies input options once per target resolution

Examples:

```text
-movflags +faststart
-x264-params keyint=60:min-keyint=60
```

```text
# Example audio override
-cutoff 18000
```

The plugin also uses PeerTube's documented `addVODEncoderPriority(...)` API for:

- `libx264`
- `aac`
- `libfdk_aac`

Higher numbers mean higher priority, and saving re-applies them without a restart.

PeerTube's own built-in priorities are `libfdk_aac: 200`, `aac: 100`, `libx264: 100`.
A value at or below those changes nothing, so to actually prefer `aac` over
`libfdk_aac` you have to set it above `200`.

## High-quality / concert audio

CD audio is 16-bit 44.1 kHz stereo PCM, about 1411 kbps. PeerTube delivers MP4 and fMP4 HLS, and labels any audio it does not recognise as AAC in the HLS manifest, so a lossless stream is rejected by the player. AAC-LC stereo at 44.1 kHz saturates at about 530 kbps.

PeerTube 8.x has a sharp edge here. When you generate more than one video resolution **and** a separate AAC / audio-only track, PeerTube sets `canCopyAudio=false` so it will not copy video and audio together. If the plugin then returns no audio flags, ffmpeg's native `aac` encoder defaults to **128 kbps**. That is the "I uploaded AAC 320, but the split file is 128" bug.

Recommended pipeline:

1. Pre-encode the concert audio to stereo AAC-LC at 320 or 512 kbps, 44100 Hz (or 48000 Hz if you prefer video-world rates).
2. Mux that audio into the uploaded file. Variable-bitrate AAC is fine; the plugin still treats it as copy-safe.
3. In PeerTube, enable HLS split audio so 720p and 1080p share one audio track.
4. In this plugin, set **Audio copy / passthrough** to **"Keep uploaded audio in MP4 files and the HLS audio track"**.
5. Also enable **Audio bitrate** at 320 or 512 as the fallback for PCM / FLAC / MP3 sources that cannot be copied.

The HLS audio track is a separate file, so copying it cannot desync anything. The
last option in the list additionally keeps audio in files where audio and video
share one track — the pairing PeerTube disabled over
[#6438](https://github.com/Chocobozzz/PeerTube/issues/6438). PeerTube 8.x always
gives HLS a separate audio track, so on 8.x the two options produce the same
result.

If the source is still PCM or FLAC, the plugin cannot copy it into a web-safe player. It will re-encode to stereo AAC-LC at the configured bitrate instead of silently falling back to 128 kbps.

Chrome "Stats for nerds" still does not show audio bitrate. Check the result with:

```bash
ffprobe -hide_banner -select_streams a:0 \
  -show_entries stream=codec_name,profile,bit_rate,sample_rate,channels,channel_layout \
  -of default=noprint_wrappers=1 file.mp4
```

### Which AAC encoder you have

PeerTube tries `libfdk_aac` first and falls back to `aac`. Which one is present
decides what the audio bitrate setting can actually deliver. Measured from the
same music source on PeerTube 8.2.4:

| Requested | `aac` (built-in) | `libfdk_aac` |
| --- | --- | --- |
| 320 kbps | 232067 | 319999 |
| 512 kbps | 227066 | 511999 |
| 576 kbps | — | 529200 |

The built-in encoder ignores the request and settles between 222 and 245 kbps
depending on the material. `libfdk_aac` produces the requested value exactly
until it saturates at about 530 kbps, the AAC-LC ceiling for stereo at 44.1 kHz.

```bash
ffmpeg -encoders | grep -E 'aac|fdk'
```

The official PeerTube Docker image ships only the built-in encoder. Most
distribution FFmpeg packages omit `libfdk_aac` too, because its licence is
incompatible with the GPL builds they distribute.

**Adding `libfdk_aac` only helps if this profile is selected.** PeerTube's own
libfdk profile passes no bitrate at all — it emits `-q:a 5`, a VBR quality
target, which measured 139562 bps on that same source. An instance that installs
libfdk but leaves transcoding on the `default` profile therefore ends up with
*lower* bitrate audio than the built-in encoder was producing.

### If your source is a lossless master

Two routes reach the same place, one lossy encode from the master either way:

- **Encode it yourself, and have the plugin copy it through.** You pick the
  encoder, the upload stays small, and you can confirm the bitrate with ffprobe
  before uploading.
- **Upload the master and let PeerTube encode it.** No local encoding, but the
  upload is large (CD PCM is ~1411 kbps) and it needs `libfdk_aac` on the server
  with this profile selected and a bitrate set.

The difference that matters is how they fail. The first fails visibly — you see
the bitrate before you upload. The second fails silently: without `libfdk_aac`
the audio comes out at ~230 kbps, and with libfdk but the `default` profile at
~140, in both cases with no error.

### Getting the highest bitrate possible

The ceiling is the codec, and it is lower than the numbers you can type. AAC-LC
stereo at 44.1 kHz saturates around **530 kbps** — `libfdk_aac` returns the same
529611 bps whether you ask for 576k or 640k. There is nothing above that short of
a lossless codec, which PeerTube's HLS manifest cannot describe (it labels any
unrecognised audio as AAC, so the player refuses to decode it).

So the maximum is: encode at the ceiling yourself, and have the plugin copy it
through untouched.

```bash
ffmpeg -i master.wav \
  -c:a libfdk_aac -b:a 576k -ar 44100 -ac 2 \
  -c:v copy output.mp4
```

Asking for 576k deliberately overshoots; the encoder gives you the ~530 kbps
ceiling. Then set **Audio copy / passthrough** to *"Keep uploaded audio in MP4 files
and the HLS audio track"*.

Measured end to end on PeerTube 8.2.4: 529611 bps in, 529611 in every Web Video
file, 529200 on the HLS audio track, playing in the browser.

**Your encoder has to be able to reach the target.** FFmpeg's built-in `aac`
encoder saturates near 244 kbps on real music no matter what `-b:a` says, and it
is the only AAC encoder in the official PeerTube Docker image. Use `libfdk_aac`,
or Apple's encoder via `qaac` / `afconvert`, and check the result with ffprobe
before uploading.

### Judge the command, not only the measured bitrate

FFmpeg's native `aac` encoder undershoots its target on simple material. A job
built with `-b:a 320k` routinely measures around 240 kbps when the source is a
sine tone, pink noise, near-silence, or anything else with little for the
encoder to spend bits on. That is the encoder, not a dropped setting: real music
fills the budget much more closely.

So when a test result looks low, confirm what was actually requested before
concluding the plugin ignored you. PeerTube logs the full command at `debug` log
level:

```bash
# server logs, or `docker logs <container>` for a container install
grep -o '"shellCommand": "[^"]*"' /var/www/peertube/storage/logs/peertube.log | tail -5
```

A copied stream is the exception: copying never changes the bitrate, so a copied
track measures whatever the source was. Copying a 128 kbps AAC source gives you
128 kbps — the fallback bitrate only applies when the audio is re-encoded.

## Behavior Notes

- Setting changes affect future transcodes, not jobs that are already running.
- Disabling a rendition does not delete files that already exist.
- Audio-only playback availability still depends on PeerTube HLS audio/video separation support.
- When a stream is copied with `copy: true`, re-encode-specific options for that copied stream do not apply.
- Existing installs that only had "Copy audio when possible" checked are migrated to **Copy only when PeerTube allows it**. Switch them to **Prefer compatible AAC** if you want split-audio jobs to keep a 320+ kbps source.

## Changelog

### 0.7.4

- Document which AAC encoder is present and what it can deliver, in the audio
  bitrate setting and in the README. FFmpeg's built-in `aac` encoder produces
  222–245 kbps whatever bitrate is requested; `libfdk_aac` produces the
  requested value exactly up to the ~530 kbps AAC-LC ceiling.
- Record the trap this creates: PeerTube's own `libfdk_aac` profile passes no
  bitrate at all, only `-q:a 5`, measured at 140 kbps. Installing `libfdk_aac`
  while leaving transcoding on the `default` profile produces *lower* bitrate
  audio than the built-in encoder did.

### 0.7.3

- Rewrite the **Audio copy / passthrough** options. They described PeerTube's
  internals ("only when PeerTube allows it", "audio-only / split jobs") rather
  than the result, and picking correctly required knowing how `canCopyAudio`
  works. Each option now states which outputs keep the uploaded audio, measured
  rather than described:

  | Option | Web Video MP4 | HLS audio |
  | --- | --- | --- |
  | Re-encode audio in every output | 244 | 244 |
  | Keep in MP4 files; re-encode for HLS | **320** | 244 |
  | Keep in MP4 files and the HLS audio track | **320** | **320** |
  | Keep in every output | **320** | **320** |

  Measured from one 320 kbps AAC upload on PeerTube 8.2.4. Stored values are
  unchanged, so existing configurations keep working.
- Remove the 512 kbps limit on the audio bitrate field; the range is now
  64–1024. The encoder decides what it can deliver, and the field says what each
  encoder was measured to produce.

### 0.7.2

- Clamp numeric settings in the admin UI. The server clamps on read, so an
  out-of-range entry used to be stored and displayed as typed while ffmpeg
  silently got something else — a CRF of `99` ran as `30`. Fields now snap to
  their range on blur, and an emptied field falls back to its default.
- Fix the admin settings UI, which had never worked on PeerTube 8.x. The client
  script looked its controls up with `document.getElementsByName()`, but 8.x
  renders plugin settings with an `id` and no `name`, so nothing matched: no
  dimming, no resolution rows, and every value field permanently locked
  regardless of its checkbox.
- Stop suffixing bare FFmpeg flags with the live stream number. `-crf:1` selects
  *output stream index 1*, not video rung 1, and live streams are ordered by
  `-map`: with split audio, index 0 is the audio track. `-crf`, `-preset`, `-bf`,
  `-b_strategy`, `-pix_fmt`, `-channel_layout` and `-ar` are now global, as they
  are in PeerTube's own builders; only `-b:a`, `-maxrate:v`, `-bufsize:v`,
  `-profile:v`, `-profile:a`, `-r:v` and `-b:v` carry the stream number.
- Always emit PeerTube's stock ladder and layer overrides on top of it. Enabling
  one rendition cap used to hand PeerTube an empty builder for every *other*
  rung, which is the same lost-defaults bug 0.7.1 set out to fix.
- Always pair `-maxrate` with `-bufsize`. libx264 drops a ceiling that has no
  buffer (`VBV maxrate specified, but no bufsize, ignored`), so the rendition
  caps did nothing unless the buffer multiplier toggle happened to be on too.
- Always emit `-r` / `-preset`. Nothing else in PeerTube sets output fps, so an
  override used to leave the rendition at the source frame rate while PeerTube
  still derived `-g:v` from the fps it expected.
- Pin `-b:v` on live, as PeerTube's own live builder does.
- Actually migrate the 0.6.x "Copy audio when possible" checkbox. PeerTube
  returns a setting's *registered default* when nothing is stored, so the copy
  mode always read back as `off` and the migration never ran.
- Remove the "Copy video when possible" checkbox. Every video job PeerTube hands
  a plugin carries a resolution, and every one of those gets a scale filter, so
  the setting could never take effect.
- Recommend `audio-only` rather than `prefer-compatible` for the split-audio
  pipeline, and document the desync trade-off.

### 0.7.1

- Do not copy video when PeerTube will apply `scale=w=-2:h=N`. That combination made ffmpeg fail the job (`Filtergraph was specified, but codec copy was selected`).
- Accept the full x264 preset list, including `veryfast` (PeerTube’s own default). Unknown values no longer silently become `slow`.
- When no video override is enabled, emit PeerTube’s stock x264 ladder (`veryfast`, maxrate, bufsize, B-frames) instead of an empty builder.
- Suffix live video/audio flags with the stream index.
- Ignore container bitrate when a video track exists; do not treat HE-AAC as copy-safe.
- Re-apply encoder priorities when settings are saved, without a PeerTube restart.

### 0.7.0

- Host the project on GitHub (`vinybrun/peertube-plugin-ultimate-transcoding`). The previous GitLab remote is gone.
- Add an audio copy / passthrough mode that can keep stereo AAC-LC even when PeerTube disables `canCopyAudio` on split / multi-resolution jobs.
- Raise the AAC bitrate ceiling from 320 to 512 kbps.
- Stop silent 128 kbps fallbacks: re-encodes now always emit an explicit stereo AAC-LC bitrate.
- Add a sample-rate control (source / 44100 / 48000).
- Document the concert / CD-quality pipeline.
