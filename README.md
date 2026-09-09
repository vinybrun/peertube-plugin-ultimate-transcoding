# PeerTube Ultimate Transcoding

`peertube-plugin-ultimate-transcoding` is a PeerTube server plugin that exposes the documented transcoding profile controls that PeerTube plugins can configure.

The goal is simple: make PeerTube transcoding easier to tune from the admin UI instead of forcing administrators to edit plugin code for every bitrate, compatibility tweak, or FFmpeg override.

## What It Controls

- VOD bitrate ladder for `144p`, `240p`, `360p`, `480p`, `720p`, `1080p`, `1440p`, and `2160p`
- Generated FFmpeg options such as `-crf`, `-preset`, `-profile:v`, `-pix_fmt`, `-maxrate`, `-bufsize`, `-b:a`, `-ar`, and `-profile:a`
- Audio copy / passthrough, including the PeerTube 8.x split-AAC case where `canCopyAudio` is forced off
- PeerTube transcoding profile `copy` mode when PeerTube says a stream can be copied safely
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

This plugin turns those documented controls into a usable admin interface. The bitrate caps are VOD-specific; the FFmpeg overrides and encoder priorities are also registered for live profiles.

## Requirements

- PeerTube `>= 7.0.0`

## Installation

After publishing to npm:

```bash
npm install peertube-plugin-ultimate-transcoding
```

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
| Encoder speed / compression preset | `-preset` | Slower presets are usually more storage-efficient. |
| Audio bitrate | `-b:a` | Used when audio is re-encoded. Range is 64 to 512 kbps. |
| Audio sample rate | `-ar` | Keep the source rate, or force 44100 / 48000. |
| Rate-control buffer multiplier | `-bufsize` | Computed from each rendition maxrate. |

### Compatibility & Stream Handling

This section keeps the web-playback and pipeline controls together:

- H.264 profile
- Pixel format
- Scale filter override
- Video copy when possible
- Audio copy / passthrough mode (never, only when PeerTube allows it, audio-only / split jobs, or prefer compatible AAC)

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

Higher numbers mean higher priority. Restart PeerTube after changing encoder priority values so the new order is applied.

## High-quality / concert audio

CD quality is 16-bit 44.1 kHz stereo PCM, about 1411 kbps. The PeerTube web player cannot ship that losslessly: HLS and Web Video need AAC. AAC-LC at 320 kbps stereo is already near-transparent; 512 kbps is the practical AAC-LC ceiling this plugin will emit.

PeerTube 8.x has a sharp edge here. When you generate more than one video resolution **and** a separate AAC / audio-only track, PeerTube sets `canCopyAudio=false` so it will not copy video and audio together. If the plugin then returns no audio flags, ffmpeg's native `aac` encoder defaults to **128 kbps**. That is the "I uploaded AAC 320, but the split file is 128" bug.

Recommended pipeline:

1. Pre-encode the concert audio to stereo AAC-LC at 320 or 512 kbps, 44100 Hz (or 48000 Hz if you prefer video-world rates).
2. Mux that audio into the uploaded file. Variable-bitrate AAC is fine; the plugin still treats it as copy-safe.
3. In this plugin, set **Audio copy / passthrough** to **Prefer compatible AAC**.
4. Also enable **Audio bitrate** at 320 or 512 as the fallback for PCM / FLAC / MP3 sources that cannot be copied.
5. In PeerTube, enable HLS split audio if you want one shared audio track across 720p and 1080p.

If the source is still PCM or FLAC, the plugin cannot copy it into a web-safe player. It will re-encode to stereo AAC-LC at the configured bitrate instead of silently falling back to 128 kbps.

Chrome "Stats for nerds" still does not show audio bitrate. Check the result with:

```bash
ffprobe -hide_banner -select_streams a:0 \
  -show_entries stream=codec_name,profile,bit_rate,sample_rate,channels,channel_layout \
  -of default=noprint_wrappers=1 file.mp4
```

## Behavior Notes

- Setting changes affect future transcodes, not jobs that are already running.
- Disabling a rendition does not delete files that already exist.
- The plugin does not upscale above the source resolution.
- Audio-only playback availability still depends on PeerTube HLS audio/video separation support.
- When a stream is copied with `copy: true`, re-encode-specific options for that copied stream do not apply.
- Existing installs that only had "Copy audio when possible" checked are migrated to **Copy only when PeerTube allows it**. Switch them to **Prefer compatible AAC** if you want split-audio jobs to keep a 320+ kbps source.

## Changelog

### 0.7.0

- Host the project on GitHub (`vinybrun/peertube-plugin-ultimate-transcoding`). The previous GitLab remote is gone.
- Add an audio copy / passthrough mode that can keep stereo AAC-LC even when PeerTube disables `canCopyAudio` on split / multi-resolution jobs.
- Raise the AAC bitrate ceiling from 320 to 512 kbps.
- Stop silent 128 kbps fallbacks: re-encodes now always emit an explicit stereo AAC-LC bitrate.
- Add a sample-rate control (source / 44100 / 48000).
- Document the concert / CD-quality pipeline.
