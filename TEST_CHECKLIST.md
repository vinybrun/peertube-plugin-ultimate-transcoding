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

## 0. Hunt these first

These are already suggested by the 8.2.4 source and by the local 0.7.0 run. Confirm or close them before expanding coverage.

- [ ] **Selecting this profile replaces PeerTube’s default x264 builder.** With every video toggle OFF, a 1080p upload must not silently lose PeerTube’s `-preset veryfast`, `-maxrate`, `-bufsize`, `-b_strategy`, `-bf`. Today the plugin returns `{}` for video, so ffmpeg/x264 defaults apply instead of PeerTube’s ladder.
- [ ] **`Copy video when possible` + a lower rung.** Web Video 720p from a 1080p source still gets `canCopyVideo=true`. If the checkbox is on, the plugin returns `{ copy: true }` and PeerTube still adds `-vf scale=…`. Expect a broken or unscaled 720p file.
- [ ] **Same copy-video checkbox on live.** Live always passes `canCopyVideo=true` and then scales in a filter graph. `{ copy: true }` becomes `-c:v:N copy` on filtered raw video. Expect live failure or a single unscaled variant.
- [ ] **Live video flags have no stream suffix.** `-crf`, `-preset`, `-maxrate`, `-bufsize`, `-profile:v`, `-pix_fmt` are emitted globally. With 1080+720 live, one ffmpeg process muxes several streams. Confirm each variant actually got its own cap/CRF, not the last flag winning.
- [ ] **Live audio `-channel_layout stereo` has no stream suffix** even though `-b:a:N` does. Confirm stereo is applied only to the audio stream.
- [ ] **Preset `veryfast` / `faster` / `ultrafast` are rejected.** `normalizePreset()` only allows `fast|medium|slow|slower|veryslow` and silently falls back to `slow`. The admin UI cannot pick `veryfast` either. PeerTube’s own default is `veryfast`.
- [ ] **Encoder priorities do not reload on Save.** `applyEncoderPriorities()` runs only in `register()`. Changing AAC / libx264 / libfdk priority in the UI and saving must have no effect until PeerTube restart. After restart, confirm old priorities are not stacked twice.
- [ ] **Container bitrate mistaken for audio bitrate.** `inspectAudioStream()` falls back to `format.bit_rate` (video+audio). A VBR/FLAC/MKV source with no `stream.bit_rate` can request `-b:a 384k` because the container is 8 Mbps. Check a FLAC-in-MKV upload with the audio-bitrate toggle OFF.
- [ ] **HE-AAC is treated as copy-safe.** `codec_name=aac` and stereo passes `isSafeToCopyAac()`. Prefer-compatible will copy HE-AAC / HE-AACv2. Check Chrome, Safari, and old Android.
- [ ] **HLS `copyCodecs` bypasses the plugin.** If the source is already H.264 yuv420p at the same resolution/fps and PeerTube decides the file is “quick transcodable”, HLS uses `presetCopy` and never calls the builders. Plugin CRF/bitrate/audio settings must not apply on that job. Confirm when this fires and that it is documented.
- [ ] **Web Video “optimize” quick-transcode also bypasses the plugin.** Same as above for the first max-resolution Web Video job.
- [ ] **`prefer-compatible` copies 128 kbps AAC instead of lifting it to 320.** That is current design (copy never invents bits). Confirm we want that, and that the fallback bitrate only applies when we *re-encode*.
- [ ] **ffmpeg native `aac` does not hit `-b:a 320k` on simple tones.** Local sine fixtures landed ~236 kbps. Retest with broadband music/noise before calling 320 “broken”.
- [ ] **Debian/Trixie PeerTube image has no `libfdk_aac`.** Official `chocobozzz/peertube:v8.2.4-trixie` skips it. Priority settings for libfdk are dead on stock Docker. Test once with a build that actually has it.
- [ ] **`package.json` `bugs` must be a URL string.** An object `{ url: … }` makes PeerTube refuse to install. Keep a regression test on install.

---

## 1. Install, profile, and process wiring

- [ ] Install from disk (`--plugin-path`) on 8.2.4.
- [ ] Install from npm (once 0.7.0 is published).
- [ ] Reinstall after editing `main.js` / `audio-policy.js` and restart; new server code is actually loaded.
- [ ] Client script loads on **Administration → Plugins → ultimate-transcoding** (toggles, resolution rows, section save buttons).
- [ ] Plugin appears in **VOD transcoding profile** and **Live transcoding profile**.
- [ ] Profile left on `default`: plugin settings must not affect ffmpeg.
- [ ] Profile set to `ultimate-transcoding`: builders log `using ultimate-transcoding profile`.
- [ ] VOD profile plugin / live profile default (and the reverse): only the selected side uses the plugin.
- [ ] Uninstall: profile disappears, in-flight jobs do not crash the instance, new jobs use `default`.
- [ ] Upgrade 0.6.2 → 0.7.0: old “Copy audio when possible” becomes `when-safe`, not `prefer-compatible`.
- [ ] Fresh 0.7.0 install: audio copy mode defaults to `off`.
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

## 7. Copy video

- [ ] Checkbox OFF: video is always re-encoded (unless PeerTube quick-transcode/copyCodecs path).
- [ ] Checkbox ON + identical H.264 yuv420p 1080→1080 Web Video: copy or re-encode? Log it.
- [ ] Checkbox ON + 1080→720 Web Video: **must not** copy (hunt #2).
- [ ] Checkbox ON + HLS split 1080: PeerTube forces `canCopyVideo=false` when `copyCodecs` is false. Plugin must re-encode.
- [ ] Checkbox ON + live: must not copy (hunt #3).
- [ ] Copy video ON + copy audio prefer-compatible: no A/V desync (PeerTube #6438 is why they disable both copies together).

---

## 8. Live

Enable live + live transcoding + same plugin profile.

- [ ] Single 1080p live, audio copy `off`, bitrate 320: listeners get AAC ~320, not 128.
- [ ] 1080+720 live, split audio ON: one shared audio track at the configured policy.
- [ ] 1080+720 live, split OFF: audio muxed in each variant, same bitrate.
- [ ] AAC 320 ingest × `prefer-compatible`: copied, no transcode loop.
- [ ] PCM / FDK / MP3 ingest: re-encoded, stereo AAC-LC.
- [ ] Video CRF + per-rung maxrate actually differ between 720 and 1080 (hunt #4).
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

- [ ] PeerTube web player, HLS adaptive: 1080↔720 switch, audio continuous, no mute blip.
- [ ] Audio-only quality appears when split/0p is on.
- [ ] Download Web Video 1080 / 720 / 0p; probe each.
- [ ] Download / fetch HLS 0p fragment; probe.
- [ ] Chrome, Firefox, Safari, iOS Safari, Android Chrome.
- [ ] Embed player.
- [ ] P2P / WebRTC (if enabled) does not break audio.
- [ ] Remote PeerTube < 6.3 playing a split-audio video (upstream warning).
- [ ] Subtitles + split audio still in sync.
- [ ] Seek, pause, speed 1.5×.

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

Not run yet: live, copy-video checkbox, HE-AAC, 5.1, studio, imports, libfdk, UI, encoder priorities, profile-with-video-toggles-off.

---

## 14. Suggested next session order

1. Close or file the hunt list in section 0 (especially profile-replaces-defaults, copy-video+scale, live stream suffixes, preset list).
2. Automate section 3.E × the four audio copy modes against the AAC 320 / PCM / 5.1 fixtures. That is the concert contract.
3. Walk the admin UI once on desktop and a 400px viewport.
4. One live 1080+720+split session.
5. Playback on Chrome + Safari + a phone.
6. Only then expand the long codec matrix.
