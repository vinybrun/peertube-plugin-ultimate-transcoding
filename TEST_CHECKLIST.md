# Ultimate Transcoding — test checklist

Use this against PeerTube **8.2.4** with the plugin profile selected: `ultimate-transcoding`.

How to verify a case:

1. Upload or restream the fixture.
2. Wait until every expected Web Video / HLS / live variant exists.
3. Confirm the **ffmpeg command** in PeerTube debug logs (`Apply ffmpeg params from … using ultimate-transcoding profile` and `shellCommand`).
4. Probe the output with ffprobe. Chrome “Stats for nerds” does not show audio bitrate.

```bash
ffprobe -hide_banner -select_streams a:0 \
  -show_entries stream=codec_name,profile,bit_rate,sample_rate,channels,channel_layout \
  -of default=noprint_wrappers=1 FILE

ffprobe -hide_banner -select_streams v:0 \
  -show_entries stream=codec_name,profile,pix_fmt,width,height,bit_rate,avg_frame_rate \
  -of default=noprint_wrappers=1 FILE
```

Mark each item `pass`, `fail`, or `n/a`. Failures should quote the ffmpeg command, not just the output file.

---

## 0. Hunt list — resolved in 0.7.1 / 0.7.2

Kept as the record of what was found and how it was closed. Re-check these after
any change to the builders.

- [x] **Selecting this profile replaces PeerTube's default x264 builder.** Confirmed: `getEncoderBuilderResult()` looks up `encoders[encoder][profile]` and only falls back to `default` when the key is missing, so an empty return drops `-preset veryfast`, `-maxrate`, `-bufsize`, `-b_strategy`, `-bf`. Fixed in 0.7.1 for the no-override case and in 0.7.2 for the partial-override case, where a single enabled rendition cap still handed every *other* rung an empty builder.
- [x] **`Copy video when possible` + a lower rung.** Confirmed a hard job failure: `Filtergraph 'scale=w=-2:h=1080' was specified, but codec copy was selected`. 0.7.1 refused the copy; 0.7.2 removed the setting, since `transcoding-resolutions.ts` only emits the unscaled 0p rung when the input has audio and that rung goes to the audio builder — a video job is never unscaled.
- [x] **Same copy-video checkbox on live.** Same root cause, same fix. Live scales in a filter graph (`[vtempN]scale=…[voutN]`).
- [x] **Live video flags have no stream suffix.** 0.7.1 suffixed them and got it backwards: a bare `-crf:1` is an *output stream index*, not video rung 1. Live output order is `-map` order and `splitAudioAndVideo: true` is hardcoded for live, so index 0 is always the audio track — rung 0's `-crf:0 -preset:0 -bf:0` landed on it every time. 0.7.2 only suffixes flags that already name a stream type. Verified against a real RTMP stream: each rung carries its own `-maxrate:v:N` / `-bufsize:v:N` / `-b:v:N` / `-r:v:N`, while `-preset`, `-crf`, `-bf`, `-b_strategy` stay global.
- [x] **Live audio `-channel_layout stereo` has no stream suffix.** Correct as it was, and correct again now. Verified live: `-c:a:0 aac -channel_layout stereo -b:a:0 256k -ar 48000 -profile:a:0 aac_low`.
- [x] **Preset `veryfast` / `faster` / `ultrafast` are rejected.** Confirmed; `PRESETS` is the full x264 list as of 0.7.1.
- [x] **Encoder priorities do not reload on Save.** Confirmed; `installProfiles()` now re-runs on settings change. Note `removeAllProfilesAndEncoderPriorities()` + re-add is synchronous in one tick, so an in-flight job cannot observe the gap.
- [x] **Container bitrate mistaken for audio bitrate.** Fixed in 0.7.1: `format.bit_rate` is only used when the probe has no video stream.
- [x] **HE-AAC is treated as copy-safe.** Fixed in 0.7.1 via `isHeAacProfile()`. A real fixture is still impossible here: this libfdk build has no SBR encoder (`Unable to set the AOT 5: Invalid config`), so the guard is pinned by unit tests over every profile string ffprobe reports for AAC instead — `LC`, `Main`, `SSR`, `LTP`, `ELD`, `MPEG-2/4 AAC Low` stay copyable, `HE-AAC` / `HE-AACv2` are refused.
- [x] **`package.json` `bugs` must be a URL string.** Confirmed: an object fails install with `PackageJSON is invalid (invalid fields: "bugs")`.

## 0b. Confirmed PeerTube behaviour, not plugin bugs

- [ ] **HLS `copyCodecs` bypasses the plugin.** If PeerTube decides the file is already web-safe at that resolution/fps, HLS uses `presetCopy` and never calls the builders. Plugin settings must not apply on that job. Documented; re-confirm when it fires.
- [ ] **Web Video "optimize" quick-transcode also bypasses the plugin.** Same for the first max-resolution job.
- [x] **`prefer-compatible` copies 128 kbps AAC instead of lifting it to 320.** Intended: copying never invents bits, and the fallback bitrate only applies on re-encode. Documented in the README.
- [x] **ffmpeg native `aac` does not hit `-b:a 320k` on simple tones.** Encoder behaviour on low-complexity material, not a dropped setting. Documented in the README; judge the command line.
- [x] **Debian/Trixie PeerTube image has no `libfdk_aac`.** `chocobozzz/peertube:v8.2.4-trixie` ships `libx264` + `aac` only, so libfdk priority is inert there. Also note PeerTube's own defaults are `libfdk_aac: 200` / `aac: 100`, so a priority at or below those changes nothing.

---

## 1. Install, profile, and process wiring

- [ ] Install from disk (`--plugin-path`) on 8.2.4.
- [ ] Install from npm (once 0.7.2 is published; the registry served 0.6.2 for a long time).
- [ ] Reinstall after editing `main.js` / `audio-policy.js` and restart; new server code is actually loaded.
- [ ] Client script loads on **Administration → Plugins → ultimate-transcoding** (toggles, resolution rows, section save buttons).
- [ ] Plugin appears in **VOD transcoding profile** and **Live transcoding profile**.
- [ ] Profile left on `default`: plugin settings must not affect ffmpeg.
- [ ] Profile set to `ultimate-transcoding`: builders log `using ultimate-transcoding profile`.
- [ ] VOD profile plugin / live profile default (and the reverse): only the selected side uses the plugin.
- [ ] Uninstall: profile disappears, in-flight jobs do not crash the instance, new jobs use `default`.
- [x] Upgrade 0.6.2 → 0.7.2: old “Copy audio when possible” becomes `when-safe`, not `prefer-compatible`. Verified for real — the published 0.6.2 tarball was installed, configured through the API the way an admin would (copy-audio on, CRF 19, a 1080p cap), then upgraded in place: the copy mode resolved to `when-safe`, the removed copy-video setting disappeared, and every other 0.6.2 setting survived. Also verified by seeding the settings row directly: the registered default resolves to `when-safe` and other saved settings survive. The migration must **not** use `settingsManager.setSetting()` — it writes `settings.<name>` through Sequelize and rewrites the whole JSON column, dropping every other setting.
- [ ] Fresh install: audio copy mode defaults to `off`.
- [ ] Settings change applies to the **next** job, not the running one.
- [ ] PeerTube restart keeps saved settings.

---

## 2. Admin UI

- [ ] Every enable-checkbox dims and disables its value field when unchecked; the stored value stays visible.
- [ ] Resolution rows: 144p … 2160p each have a toggle + kbps + “kbps” unit.
- [ ] Source / non-standard bitrate row behaves the same.
- [ ] Audio copy mode is a select (not the old checkbox).
- [ ] Audio sample rate is a select (source / 44100 / 48000).
- [ ] Section save buttons trigger the real “Update plugin settings”.
- [ ] Saving one section does not wipe other sections.
- [ ] Invalid numbers clamp instead of crashing: CRF `<16` / `>30`, audio `<64` / `>512`, maxrate `<100`, priority `0`.
- [ ] Empty extra-option textareas are accepted.
- [ ] Extra-option lines starting with `#` are ignored.
- [ ] Narrow viewport (~400px): resolution rows stack, nothing overflows.
- [ ] Reloading the plugin page after save shows the values that were stored.

---

## 3. PeerTube job matrix (VOD)

For each row, record whether the plugin builder ran, whether audio was copy or aac, and the measured audio bitrate.

PeerTube toggles to mix:

| # | Web Video | HLS | Split A/V | 0p | Resolutions | Notes |
|---|---|---|---|---|---|---|
| A | on | off | n/a | off | 1080 only | muxed MP4 |
| B | on | off | n/a | on | 1080 + 0p | separate audio MP4 |
| C | off | on | off | off | 1080 only | muxed HLS |
| D | off | on | on | off | 1080 only | split HLS, one audio |
| E | off | on | on | on | 1080 + 720 + 0p | **the split-audio case** |
| F | on | on | on | on | 1080 + 720 + 0p | both outputs |
| G | on | on | off | off | 720 + 1080 | muxed audio in every file |
| H | on | on | on | off | 720 + 1080 | 0p off, split still creates HLS audio |
| I | on | on | on | on | 1080 + original | `alwaysTranscodeOriginalResolution` on, 900p or 1440p source |
| J | on | on | on | on | none except 0p | audio-only output |

- [ ] A
- [ ] B
- [ ] C
- [ ] D
- [ ] E — pre-encoded AAC 320 must stay ≥ source on the **HLS 0p** file (not 128).
- [ ] F — Web Video 0p and HLS 0p must agree.
- [ ] G — every muxed file has the same audio policy (no 128 on 720 and 320 on 1080).
- [ ] H — split audio exists even when the 0p checkbox is off.
- [ ] I — source-height rung uses the “Source / non-standard” cap when that toggle is on, and no cap when it is off.
- [ ] J — audio-only upload / 0p-only ladder.

Also:

- [ ] Re-run transcoding on an existing video (admin “Run transcoding”).
- [ ] Keep original file ON: original stays, outputs still follow the plugin.
- [ ] Additional extensions ON: `.mkv` / `.mov` / `.avi` upload and transcode.
- [ ] Audio file upload (`.flac`, `.wav`, `.mp3`, `.aac`) with merge-to-video.
- [ ] Video import (HTTP URL), not only direct upload.
- [ ] Studio edition (cut / intro) after a successful transcode: audio policy still applies, no desync.

---

## 4. Audio sources × copy mode

Copy modes: `off` | `when-safe` | `audio-only` | `prefer-compatible`.

Run at least **E** (1080+720+split+0p) for each source × the interesting modes.

| Source | `off` | `when-safe` | `audio-only` | `prefer-compatible` |
|---|---|---|---|---|
| AAC-LC stereo 320 CBR | re-encode @ target | copy only if PT allows; else re-encode | copy on 0p; re-encode muxed if PT forbids | copy everywhere |
| AAC-LC stereo VBR (no stream bitrate) | re-encode | often re-encode (PT `canDoQuickAudioTranscode` needs bitrate) | copy 0p | copy |
| AAC-LC 128 | re-encode @ 320 if toggle on | copy if PT allows | copy 0p (stays 128) | copy (stays 128) |
| AAC-LC 512 | re-encode @ 320 or 512 | PT default would downconvert >384; plugin must not | copy 0p | copy 512 |
| HE-AAC stereo | re-encode to AAC-LC? or copy? | ? | ? | **today: copy** — confirm players |
| AAC 5.1 | re-encode stereo | no copy | no copy | no copy |
| AAC quad / unknown layout | re-encode stereo | no copy | no copy | no copy |
| PCM s16le 44.1k stereo (CD) | AAC @ target, 44.1 if selected | no copy | no copy | no copy |
| PCM 48k / 96k / 24-bit | same | no copy | no copy | no copy |
| FLAC | AAC @ target (or 384 fallback) | no copy | no copy | no copy |
| ALAC | no copy | no copy | no copy | no copy |
| MP3 320 | no copy | no copy | no copy | no copy |
| Opus / Vorbis | no copy | no copy | no copy | no copy |
| AC-3 / E-AC-3 | no copy | no copy | no copy | no copy |
| No audio track | video-only outputs, no crash | | | |
| Dual audio (eng+und) | first stream only is inspected — confirm which track is used | | | |
| Audio starts late / gaps | copy vs re-encode, A/V sync | | | |

Checkboxes:

- [ ] AAC-LC 320 × `off`
- [ ] AAC-LC 320 × `when-safe` on **E** (this is the old plugin; expect 128 or a re-encode, not a copy, on HLS 0p)
- [ ] AAC-LC 320 × `audio-only` on **E** (0p copied, muxed jobs follow PT)
- [ ] AAC-LC 320 × `prefer-compatible` on **E** (split-audio happy path)
- [ ] AAC VBR × `prefer-compatible`
- [ ] AAC 128 × `prefer-compatible` (stays 128) and × `off` + bitrate 320 (becomes ~320)
- [ ] AAC 512 × `prefer-compatible` (stays 512) and × `off` + bitrate 320 (down to 320)
- [ ] HE-AAC × `prefer-compatible` (playback on Chrome, Safari, iOS, Firefox)
- [ ] 5.1 AAC × all modes → stereo AAC-LC, no crash
- [ ] Unknown layout PCM → stereo AAC-LC
- [ ] CD PCM 44.1 × bitrate 320 × sample rate “keep source” → 44100
- [ ] CD PCM × sample rate 48000 → 48000
- [ ] FLAC × bitrate toggle OFF → not 128; expect ~256–384 fallback
- [ ] FLAC × bitrate 320 → ~320 command, not 128
- [ ] FLAC × bitrate 512 → command has `-b:a 512k`
- [ ] MP3 / Opus / AC-3 re-encode to AAC-LC
- [ ] Silent / no-audio video
- [ ] Two audio tracks
- [ ] Audio-only file merge (image + FLAC)

---

## 5. Audio bitrate and sample rate knobs

- [ ] Bitrate toggle OFF + copy mode `off`: fallback is 256 (unknown) or `min(384, source)` or 384 for FLAC — **never ffmpeg’s implicit 128**.
- [ ] Bitrate toggle ON at 64, 128, 192, 256, 320, 384, 512.
- [ ] Bitrate 513 or 20 is clamped.
- [ ] Sample rate empty: encoder keeps source rate (44.1 stays 44.1).
- [ ] Sample rate 44100 / 48000 forced on a 32 kHz source.
- [ ] `-profile:a aac_low` is present on every re-encode.
- [ ] `-channel_layout stereo` is present on every re-encode.
- [ ] Extra audio output options append after generated flags and can override `-b:a`.
- [ ] Extra audio input options appear on the ffmpeg command.
- [ ] Copy path: re-encode flags (`-b:a`, `-ar`, `-profile:a`) are **absent**.

---

## 6. Video quality and ladder

- [ ] CRF toggle OFF: document actual ffmpeg flags (see hunt #1).
- [ ] CRF 16, 21, 23, 30 appear as `-crf N`.
- [ ] CRF 15 / 31 clamp.
- [ ] Preset `fast` / `medium` / `slow` / `slower` / `veryslow`.
- [ ] Preset `veryfast` cannot be set (hunt #6). Decide if we should add it.
- [ ] H.264 profile baseline / main / high on a normal 8-bit source.
- [ ] high10 / high422 / high444 with matching pixel formats.
- [ ] Pixel format `yuv420p` (compat) vs `yuv420p10le` (10-bit source).
- [ ] Pixel format override vs PeerTube’s global `-pix_fmt yuv420p` (last flag must win).
- [ ] Scale filter override empty vs `scale` vs `scale_vaapi` (VAAPI machine only).
- [ ] Per-rung cap: enable only 720=2500 and 1080=4200; 480 must not get a plugin `-maxrate`.
- [ ] Bufsize multiplier 2 → `-bufsize` = 2 × maxrate. Try 1 and 10.
- [ ] Bufsize toggle OFF → `-maxrate` without `-bufsize`.
- [ ] Source / non-standard cap on a 900p or 1080×1920 source-height job.
- [ ] Plugin does not create rungs. Disabling 144p in the plugin while it is ON in PeerTube still produces 144p (uncapped unless source cap is on).
- [ ] Plugin does not upscale. 720p source + 1080 enabled in PeerTube → no 1080 output.
- [ ] Extra video output options append and can override `-crf`.
- [ ] Extra video input options appear once per job (live: once per target resolution — PeerTube’s rule).

Video fixtures:

- [ ] 1080p30 yuv420p H.264
- [ ] 1080p60
- [ ] 4K 2160p30
- [ ] 720p25
- [ ] 1440p
- [ ] Portrait 1080×1920
- [ ] Square 1080×1080
- [ ] 23.976 / 29.97 VFR
- [ ] Interlaced
- [ ] 10-bit HDR (yuv420p10le / BT.2020)
- [ ] HEVC / VP9 / AV1 / ProRes / DNxHD sources
- [ ] Rotation metadata (phone 90°)
- [ ] High-motion vs talking-head (bitrate cap behavior)

---

## 7. Copy video — setting removed in 0.7.2

There is no video copy path any more. Every video job PeerTube hands a plugin
carries a resolution, and every one of those gets a scale filter, so `copy: true`
could only ever fail the job.

- [ ] Video is always re-encoded, except on PeerTube's own quick-transcode / `copyCodecs` paths, which never call the builders at all.
- [ ] Copy audio `prefer-compatible` on a muxed rendition whose video is re-encoded: check a long file for A/V drift (PeerTube #6438 is why they disable both copies together).

---

## 8. Live

Enable live + live transcoding + same plugin profile.

Note: live always runs split (`splitAudioAndVideo: true` is hardcoded in
`ffmpeg-transcoding-wrapper.ts`), so output stream 0 is always the audio track
and video rungs start at index 1.

- [x] 480+720+1080 live, audio copy `when-safe`: audio copied as `-c:a:0 copy`, three video rungs each with their own `-maxrate:v:N` / `-bufsize:v:N` / `-b:v:N` / `-r:v:N`, and `-preset` / `-crf` / `-bf` / `-b_strategy` global. Verified 2026-09-09 over real RTMP.
- [x] Live audio re-encode: `-c:a:0 aac -channel_layout stereo -b:a:0 256k -ar 48000 -profile:a:0 aac_low`. Verified same session.
- [x] Video per-rung maxrate actually differs between rungs: 1474578 / 3041318 / 3900000, with the 1080 rung capped at input+30%.
- [ ] Single 1080p live, audio copy `off`, bitrate 320: listeners get AAC ~320, not 128.
- [ ] AAC 320 ingest × `prefer-compatible`: copied, no transcode loop.
- [ ] PCM / FDK / MP3 ingest: re-encoded, stereo AAC-LC.
- [ ] Actually watch a live stream end to end, not just read its command.
- [ ] Restart / brief disconnect: playlist recovers.
- [ ] Audio-only live (0p).
- [ ] Live replay → VOD: replay files follow the VOD profile, not leftover live flags.
- [ ] RTMP vs WHIP if the instance has both.

---

## 9. Encoder priority

- [ ] All priority toggles OFF: PeerTube order (`libfdk_aac` then `aac`; `libx264`).
- [ ] `aac` priority 1000, `libfdk` 1, on a build **with** libfdk: native `aac` is chosen.
- [ ] Same on stock Trixie image: libfdk skipped, `aac` used regardless.
- [ ] Save new priorities without restart: no change (hunt #7).
- [ ] Restart after save: new order applies, not duplicated.

---

## 10. Playback and delivery

After a passing **E** transcode:

- [x] PeerTube web player, HLS: plays, position advances, `webkitVideoDecodedByteCount` and `webkitAudioDecodedByteCount` both climb, no media error. Verified in Chromium via `docker/playback_check.py`, which records the session to `testdata/results/playback/`.
- [x] 1080↔720 switch through the player's own quality menu: keeps playing, audio keeps decoding across the switch.
- [x] Audio-only quality appears when split/0p is on — menu offers `1080p / 720p / Audio only / Auto`.
- [x] Probe every HLS rendition actually served to the player: audio-only is `aac / LC / stereo / 320000`, video rungs are video-only.
- [x] Seek forward mid-playback; playback resumes at the new position.
- [ ] Chrome (real, not headless), Firefox, Safari, iOS Safari, Android Chrome.
- [ ] Embed player.
- [ ] P2P / WebRTC (if enabled) does not break audio.
- [ ] Remote PeerTube < 6.3 playing a split-audio video (upstream warning).
- [ ] Subtitles + split audio still in sync.
- [ ] Pause, speed 1.5×.

---

## 11. Settings combinations that have burned people

- [ ] Only audio bitrate ON, every video toggle OFF (hunt #1).
- [ ] Only CRF + bufsize + 1080/720 caps ON (the original “minimal override” recipe) + new audio mode `off`.
- [ ] Concert recipe: audio 320 ON, copy `prefer-compatible`, sample rate 44100, CRF 21, 1080/720 caps, split HLS.
- [ ] Copy audio `when-safe` + split HLS (the pre-0.7 setup) still reproduces 128 unless bitrate toggle is on.
- [ ] Copy audio `prefer-compatible` + 5.1 source + split HLS (must downmix, not copy).
- [ ] Expert `-b:a 96k` after generated `-b:a 320k` (last should win).
- [ ] Expert garbage line (`-not-a-flag`) fails the job visibly, does not hang the queue.
- [ ] Expert empty lines and `# comments` ignored.

---

## 12. Regression fixtures (keep these files)

Build short (~4–10 s) and one longer (~60 s music) set:

- [ ] `cd-pcm-1080.mkv` — 16-bit 44.1 kHz stereo PCM + 1080p
- [ ] `aac320-1080.mp4` — AAC-LC 320 CBR + 1080p
- [ ] `aac512-1080.mp4`
- [ ] `aac128-1080.mp4`
- [ ] `aac-vbr-1080.mp4`
- [ ] `he-aac-1080.mp4`
- [ ] `aac51-1080.mp4` — 5.1
- [ ] `flac-1080.mkv`
- [ ] `mp3-1080.mp4`
- [ ] `opus-1080.webm`
- [ ] `silent-1080.mp4`
- [ ] `portrait-1080.mp4`
- [ ] `4k-2160.mp4`
- [ ] `audio-only.flac`
- [ ] `music-60s-aac320.mp4` — real spectrum, for bitrate honesty

---

## 13. What we already ran (2026-09-09, local 8.2.4)

Profile `ultimate-transcoding`, HLS split ON, 1080+720+0p, copy `prefer-compatible`, audio 320, sample rate 44100.

| Fixture | HLS/Web 0p | Notes |
|---|---|---|
| AAC 320 | copied, ~236 kbps | sine does not fill 320; command was `-acodec copy` |
| AAC VBR | copied, ~216 kbps | |
| CD PCM | re-encoded, command `-b:a 320k -ar 44100 -profile:a aac_low` | measured ~236 on sine |
| FLAC | same re-encode | |
| AAC 128 | copied, ~127 kbps | expected for prefer-compatible |

Since updated for 0.7.2: live verified over real RTMP (both copy and re-encode
audio paths, three rungs), partial-rendition-cap and CRF-override paths verified
against the logged ffmpeg commands, the 0.6.2 → 0.7.2 upgrade verified by
installing the real published tarball and upgrading over it, the admin UI driven
end to end in a browser, and playback verified in the PeerTube player with a
recording kept for review.

Still not run: a real HE-AAC fixture (impossible on this libfdk build), studio
edition, URL import, dual audio, HDR, 4K, VFR, WHIP, playback on Firefox /
Safari / iOS / Android, embed player, P2P, and libfdk_aac (absent from the stock
Docker image).

---

## 14. Suggested next session order

1. Automate section 3.E × the four audio copy modes against the AAC 320 / PCM / 5.1 fixtures. That is the concert contract.
2. Playback on Chrome + Safari + a phone — nothing here has been watched by a human yet.
3. Live replay → VOD, and audio-only (0p) live.
4. A long-file A/V drift check for `prefer-compatible` on muxed renditions.
5. Only then expand the long codec matrix.
