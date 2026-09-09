# PeerTube transcoding tuning guide

This document explains how to tune our PeerTube transcoding setup for paid, interview-heavy content while keeping compatibility risk low.

It is based on the decisions we made while testing custom transcoding profiles, capped CRF, bitrate ladders, and related PeerTube settings.

---

## 1. Goals

Our goals are:

- keep the setup simple
- override as little as possible
- preserve broad playback compatibility
- improve quality for paid interview content
- keep bandwidth under control for viewers with weaker internet
- avoid locking ourselves into a fragile config that must be updated every time PeerTube adds new transcoding options

That means we should let **PeerTube handle everything it already handles well**, and only override the pieces we really need.

---

## 2. What PeerTube should own vs what our plugin should own

### PeerTube core settings should own:

- which resolutions are generated
- whether original/source resolution is kept
- general compatibility defaults
- normal transcoding workflow

### Our plugin should own:

- CRF (quality target)
- per-resolution bitrate caps
- buffer sizing for those caps

That split gives us the best balance of control and maintainability.

---

## 3. Why a plugin is needed

PeerTube can **select** a transcoding profile in the GUI, but **new transcoding profiles are added by plugins**.

So if we want custom logic like:

- different bitrate caps for 240p, 360p, 480p, 720p, 1080p, 1440p, 2160p
- capped CRF behavior
- minimal overrides with custom rules

then yes, we need a PeerTube plugin.

The GUI alone is not enough for that.

---

## 4. What we are actually using: capped CRF

Our chosen strategy is **capped CRF**.

That means:

- **CRF** sets the desired quality target
- **maxrate** limits bitrate peaks for each resolution
- **bufsize** controls how much short-term bitrate swing is allowed

Plain English:

- CRF says how hungry the encoder is
- maxrate says the most it is allowed to eat
- bufsize is the size of the plate

This is a good fit for interview-heavy content because:

- simple talking-head scenes often do not need many bits
- more difficult moments can still use more bits when needed
- bitrate does not run away uncontrollably
- weak-internet viewers still get predictable renditions

### Why not pure CRF?

Pure CRF is great for quality consistency, but it can produce unpredictable bitrates. That is bad for an internet delivery ladder.

### Why not pure bitrate mode?

Pure bitrate mode is less adaptive. It forces the same budget logic everywhere, even when scenes are easy.

### Why capped CRF is the middle ground

Capped CRF gives the encoder some freedom while still respecting delivery limits.

---

## 5. Recommended bitrate ladder for our use case

This ladder is designed for:

- paid content
- mostly interviews
- 30 fps
- many viewers with weaker internet

Recommended caps:

- **240p** → 400 kbps
- **360p** → 700 kbps
- **480p** → 1200 kbps
- **720p** → 2500 kbps
- **1080p** → 4200 kbps
- **1440p** → 6500 kbps
- **2160p / 4K** → 10000 kbps

### Resolution enablement

Recommended:

- **144p** → OFF
- **240p** → ON
- **360p** → ON
- **480p** → ON
- **720p** → ON
- **1080p** → ON
- **1440p** → ON
- **2160p** → ON

Why disable 144p?

- it is usually too ugly to be worth keeping
- 240p is a better emergency rung

---

## 6. Recommended plugin philosophy: override as little as possible

Because we want maximum compatibility and minimum maintenance, our plugin should only enable the settings that really matter.

### Enable these

#### 1) CRF

**Enable:** yes  
**Starting value:** `21`

Why:

- this is the main quality knob
- it is easy to reason about
- it is less fragile than overriding many advanced encoder options

If quality is still too soft:

- try `20`

If files get too big:

- try `22`

#### 2) Max bitrate per resolution

**Enable:** yes

Why:

- this is the main reason to have the custom profile
- it gives us a proper delivery ladder
- it protects viewers on weak internet

#### 3) Buffer size multiplier

**Enable:** yes  
**Value:** `2`

Why:

- it is the sane default for capped bitrate behavior
- it gives the encoder some short-term breathing room
- it is tight enough to stay controlled

---

## 7. What `Buffer size multiplier = 2` means

If the bitrate cap is 4200 kbps and multiplier is 2:

- `maxrate = 4200k`
- `bufsize = 8400k`

If the bitrate cap is 2500 kbps and multiplier is 2:

- `maxrate = 2500k`
- `bufsize = 5000k`

### What bufsize does

`bufsize` is the rate-control buffer.

It controls how much short-term bitrate variation the encoder is allowed before it must clamp down.

### Practical effect

- **smaller buffer** = stricter control, less burst room, can hurt quality on difficult moments
- **larger buffer** = more burst room, can help quality, but makes bitrate less tight
- **2x** = balanced

For our content, `2` is the right default.

---

## 8. Settings we should leave OFF unless we have a specific reason

### Preset override

**Leave OFF**

Why:

- PeerTube already has sane defaults
- preset gains are real, but usually modest
- preset overrides are lower value than CRF and bitrate caps

If we ever do override it, `slow` is the most sensible premium-VOD choice.

### Audio bitrate override

**Leave OFF at first**

Why:

- interview audio does not need extreme tuning on day one
- override only if PeerTube is wasting too many bits

If we do override it later:

- use **128 kbps AAC** as the first choice
- **160 kbps** if we want a slightly richer premium default
- do not waste 320 kbps on speech-only content

### H.264 profile override

**Leave OFF**

Why:

- this is exactly the kind of compatibility default PeerTube should own
- override only if testing proves we need to force a specific profile

### Pixel format override

**Leave OFF**

Why:

- let PeerTube choose unless we hit a real compatibility problem
- if we ever need to force one, `yuv420p` is the safe compatibility choice

### Scale filter override

**Leave OFF / blank**

Why:

- too easy to become maintenance debt
- only useful if we are solving a specific scaling problem

### Copy video when possible

**Leave OFF**

Why:

- copying bypasses normal re-encoding
- that can preserve weird source quirks instead of giving us normalized outputs
- worse for predictability

### Copy audio when possible

**Leave OFF**

Same reason.

### Source / non-standard resolution cap

**Leave OFF**

Why:

- only matters when PeerTube itself generates a source-height or other non-standard output
- if PeerTube is not generating those outputs, this cap is irrelevant

### Expert FFmpeg options

**Leave OFF and blank**

This includes:

- additional video input options
- additional video output options
- additional audio input options
- additional audio output options

Why:

- high breakage risk
- easy to drift from PeerTube defaults
- opposite of our minimal-override approach

### Encoder priorities

**Leave OFF**

Why:

- PeerTube and FFmpeg should keep owning encoder choice unless we have a verified reason to force priority
- hard-coded priorities can age badly

---

## 9. Recommended current settings summary

### Main values

- **CRF:** `21`
- **Buffer size multiplier:** `2`
- **Bitrate caps:**
  - 240p → `400`
  - 360p → `700`
  - 480p → `1200`
  - 720p → `2500`
  - 1080p → `4200`
  - 1440p → `6500`
  - 2160p → `10000`

### Enable

- CRF
- max bitrate per resolution
- buffer size multiplier

### Disable

- preset override
- audio bitrate override
- H.264 profile override
- pixel format override
- scale filter override
- source/original generation in plugin
- copy video
- copy audio
- source/non-standard resolution cap
- all expert options
- all encoder priorities

---

## 10. What to do if quality is still too soft

### First lever: lower CRF slightly

From `21`, test:

- `20`
- then `19` if needed

### Rule of thumb for file size

A rough rule is:

- about **6 CRF steps** is often around **2x or 0.5x file size**
- so **1 CRF step** often changes size by roughly **12 to 15%**

That means:

- `21 → 20` = moderate increase
- `21 → 19` = noticeable increase
- `21 → 18` = much larger increase

### If we want about 50% bigger output

Good first test:

- **CRF 19**

If that is still too small:

- try `18.5` or `18`

---

## 11. What happens when CRF overshoots the bitrate cap

When CRF is lowered, the encoder tries to spend more bits.

If a rendition reaches its bitrate cap, then the cap starts to control the result more strongly.

That means:

- easy scenes may still improve
- cap-limited scenes stop improving in proportion to the lower CRF
- lowering CRF further gives diminishing returns for that resolution

### Very important

CRF itself is **not** what lowers quality in that case.

The bitrate cap is what limits quality.

So if a resolution is already pinned hard against its cap, lowering CRF more is usually not the best next move.

---

## 12. What to do when one resolution caps early and others do not

Example situation:

- 4K is hitting its cap very early
- lower resolutions are still too small / too soft

### Best response

Do **not** lower CRF only to help the 4K rung.

Instead:

- keep the current CRF if the lower rungs are otherwise okay
- raise the **4K cap** if 4K specifically needs more room
- lower CRF only if we also want to improve the lower rungs that still have headroom

### In plain English

- use **CRF** to adjust overall hunger
- use **bitrate caps** to adjust individual rungs

If only 4K is constrained, fix the 4K cap.

---

## 13. If a rendition reached 9.4 Mbps and the limit is 10 Mbps, did it cap?

Not necessarily.

If a measured peak is 9.4 Mbps with a 10 Mbps maxrate:

- it probably **did not hit the hard ceiling** at that moment
- it still had some headroom

But this depends on what was measured:

- if 9.4 Mbps is a true peak measurement, it likely did not cap
- if 9.4 Mbps is a chunk average or whole-file average, it still might have briefly capped during harder moments

### Practical takeaway

9.4 out of 10 Mbps suggests the rung is **close to the cap**, but it does **not prove hard capping**.

---

## 14. How to think about presets

Presets are **not simple multipliers**. They are bundles of encoder decisions.

That means:

- they are not linear
- differences depend on source, CPU, resolution, filters, and rate-control mode

### Rough performance reference from the HandBrake x264 benchmark

Using the same source and RF 24 on a fast workstation:

- **veryfast:** 72.6 fps
- **fast:** 72.6 fps
- **medium:** 69.1 fps
- **slow:** 63.2 fps
- **slower:** 39.8 fps
- **veryslow:** 33.9 fps

### What that means in practice

- **veryfast / fast / medium** are all fairly close
- **slow** is somewhat slower
- **slower** is the real cliff
- **veryslow** is worse still, but the big pain starts at `slower`

### Quality payoff

Preset changes are usually **not massive visual upgrades**.

They mostly improve **compression efficiency**.

That means a slower preset may give:

- slightly smaller files at similar quality, or
- slightly better quality at similar size

But the visible gain is usually modest, especially from:

- medium → slow
- slow → slower

### Practical guidance

If we ever override preset:

- `medium` = rational default
- `slow` = best practical premium-VOD choice
- `slower` / `veryslow` = usually not worth it

Because we want minimal override, we currently leave preset OFF.

---

## 15. Split audio/video files: should we use it?

PeerTube's separate audio/video handling for HLS is usually good for modern devices.

Benefits:

- lower storage use
- proper adaptive streaming behavior
- audio-only mode
- cleaner HLS delivery

Compatibility risk:

- mostly old browsers, old webviews, odd smart TVs, kiosk browsers, and other weird clients
- not usually a problem for normal desktop/mobile browsers from the last many years

### Practical stance

If the audience is mostly on modern browsers and phones:

- split audio/video is usually fine

If the audience depends heavily on older or quirky devices:

- test first
- consider keeping more compatibility-oriented fallbacks

---

## 16. How to choose settings in the main PeerTube GUI

The main PeerTube config should still decide which renditions exist.

Recommended in the normal PeerTube transcoding settings:

- audio-only → ON
- 240p → ON
- 360p → ON
- 480p → ON
- 720p → ON
- 1080p → ON
- 1440p → ON
- 2160p → ON
- 144p → OFF

The plugin does **not** create renditions by itself. It only changes how they are encoded.

---

## 17. Testing strategy

Use one representative upload that includes:

- a close face shot
- dark areas
- normal hand movement
- some texture in hair or background

Then inspect at least:

- 720p
- 1080p
- 1440p
- 2160p if relevant

### What to change first

If quality is still too soft:

1. lower CRF slightly
2. if only one resolution is constrained, raise that rung's cap
3. do not start with exotic FFmpeg flags
4. do not start with preset tuning

---

## 18. Quick decision rules

### We want better quality overall

- lower CRF a bit

### We want only one rung to get more room

- raise that rung's bitrate cap

### One rung is already capping hard

- do not lower CRF only for that rung
- fix the cap instead

### We want to avoid maintenance drift

- keep as many advanced overrides OFF as possible

### We want maximum compatibility

- let PeerTube keep profile/pixel-format/scaling defaults unless testing proves otherwise

---

## 19. Handy ffmpeg commands

### Create a 30-second sample from the start of a file

```bash
ffmpeg -ss 0 -i big-video.mov -t 30 -c copy big-video-sample-30s.mov
```

### Create a 30-second sample from a later point

```bash
ffmpeg -ss 00:05:00 -i big-video.mov -t 30 -c copy big-video-sample-30s.mov
```

### Exact cut version if keyframes make `-c copy` awkward

```bash
ffmpeg -ss 00:05:00 -i big-video.mov -t 30 -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k big-video-sample-30s.mov
```

---

## 20. Terminal-only watcher for ffmpeg activity window

This command waits for the first `ffmpeg` process, starts timing, and finishes only after there have been **no ffmpeg processes for 30 seconds**.

```bash
bash -c '
seen=0
start=""
last_seen=""
idle_wait=30

echo "Waiting for ffmpeg to appear..."
while :; do
  now=$(date +%s)

  if pgrep -x ffmpeg >/dev/null; then
    if [ "$seen" -eq 0 ]; then
      seen=1
      start=$now
      echo "First ffmpeg appeared at: $(date -d "@$start" "+%F %T")"
    fi
    last_seen=$now
    printf "\rffmpeg running... elapsed since first start: %ss   " "$((now-start))"
  else
    if [ "$seen" -eq 1 ]; then
      idle=$((now-last_seen))
      if [ "$idle" -ge "$idle_wait" ]; then
        end=$last_seen
        echo
        echo "Last ffmpeg disappeared at: $(date -d "@$end" "+%F %T")"
        echo "Total ffmpeg activity window: $((end-start)) seconds"
        break
      else
        printf "\rNo ffmpeg right now. Waiting %ss/%ss before finishing...   " "$idle" "$idle_wait"
      fi
    fi
  fi

  sleep 1
done
'
```

This does not write logs. It only prints to the terminal.

---

## 21. Final recommended default stance

If we need one plain default policy for the repo, it is this:

> Use a custom PeerTube plugin for **capped CRF** with a per-resolution bitrate ladder, but keep all other overrides disabled unless testing proves we need them.

### Recommended defaults

- CRF: **21**
- Buffer size multiplier: **2**
- 144p: **OFF**
- 240p: **400 kbps**
- 360p: **700 kbps**
- 480p: **1200 kbps**
- 720p: **2500 kbps**
- 1080p: **4200 kbps**
- 1440p: **6500 kbps**
- 2160p: **10000 kbps**
- leave preset override OFF
- leave audio override OFF
- leave profile/pixel-format/scaler overrides OFF
- leave copy options OFF
- leave expert options OFF
- leave encoder priorities OFF

### First tuning moves

- if still too soft overall → lower CRF slightly
- if one rung caps early → raise that rung's cap
- if quality increase is not visible → stop adding overrides and re-check the actual bottleneck

This keeps the setup understandable, portable, and much less likely to break when PeerTube evolves.
