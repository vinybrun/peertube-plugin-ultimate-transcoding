'use strict'

const { buildStreamSuffix, isLiveStream } = require('./stream-flags')

const PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow'
]

const AVERAGE_BIT_PER_PIXEL = {
  144: 0.19,
  240: 0.17,
  360: 0.15,
  480: 0.12,
  720: 0.11,
  1080: 0.10,
  1440: 0.09,
  2160: 0.08
}

const MIN_BIT_PER_PIXEL = 0.02
const LADDER = [ 2160, 1440, 1080, 720, 480, 360, 240, 144 ]

// PeerTube's own stock x264 values, from ffmpeg-default-transcoding-profile.ts
const PEERTUBE_PRESET = 'veryfast'
const PEERTUBE_BUFSIZE_MULTIPLIER = 2

function normalizePreset (value, fallback) {
  return PRESETS.includes(value) ? value : fallback
}

function nearestLadder (resolution) {
  for (const step of LADDER) {
    if (step <= resolution) return step
  }

  return 144
}

function theoreticalBitrate (resolution, ratio, fps, bitPerPixel) {
  if (!resolution) return 0

  const size1 = resolution
  const size2 = ratio < 1 && ratio > 0
    ? resolution / ratio
    : resolution * ratio

  return Math.floor(size1 * size2 * fps * bitPerPixel)
}

function peertubeTargetBitrate (options) {
  const {
    inputBitrate,
    inputRatio = 16 / 9,
    fps = 30,
    resolution = 0
  } = options

  if (!resolution) return 192 * 1000

  const ladder = nearestLadder(resolution)
  const average = theoreticalBitrate(resolution, inputRatio, fps, AVERAGE_BIT_PER_PIXEL[ladder] || 0.10) || (192 * 1000)
  const min = theoreticalBitrate(resolution, inputRatio, fps, MIN_BIT_PER_PIXEL) || (10 * 1000)

  let capped = average
  if (inputBitrate) {
    capped = Math.min(average, inputBitrate + (inputBitrate * 0.3))
  }

  return Math.max(min, Math.round(capped))
}

// The rendition cap the admin enabled for this rung, in bit/s, or PeerTube's
// own computed target when no cap applies.
function getTargetBitrate (options) {
  const { maxrateKbps, resolution, fps, inputBitrate, inputRatio } = options

  if (maxrateKbps !== null && maxrateKbps !== undefined) return maxrateKbps * 1000

  return peertubeTargetBitrate({ inputBitrate, inputRatio, fps, resolution })
}

// Selecting a plugin profile replaces PeerTube's `default` builder outright: it
// does not merge. Anything we leave out is simply gone, so we always emit the
// stock ladder and let the admin's overrides replace individual flags.
//
// That matters most for `-preset` and `-r`, which nothing else in PeerTube
// sets: without `-r` the rendition keeps the source frame rate and ignores the
// instance's fps ladder, while PeerTube still derives `-g:v` from the fps it
// expected. `-maxrate` without `-bufsize` is likewise dropped by libx264
// ("VBV maxrate specified, but no bufsize, ignored"), so the two ship together.
function buildVideoReencodeOptions (options) {
  const {
    config,
    resolution,
    fps,
    inputBitrate,
    inputRatio,
    streamNum,
    maxrateKbps
  } = options

  const toggles = (config && config.toggles) || {}
  const target = getTargetBitrate({ maxrateKbps, resolution, fps, inputBitrate, inputRatio })

  const bufsizeMultiplier = toggles.bufsizeMultiplier
    ? config.bufsizeMultiplier
    : PEERTUBE_BUFSIZE_MULTIPLIER

  const outputOptions = [
    `-preset ${toggles.preset ? config.preset : PEERTUBE_PRESET}`,
    `${buildStreamSuffix('-maxrate:v', streamNum)} ${target}`,
    `${buildStreamSuffix('-bufsize:v', streamNum)} ${Math.round(target * bufsizeMultiplier)}`,
    '-b_strategy 1',
    '-bf 16'
  ]

  if (toggles.crf) {
    outputOptions.push(`-crf ${config.crf}`)
  }

  if (toggles.videoProfile) {
    outputOptions.push(`${buildStreamSuffix('-profile:v', streamNum)} ${config.videoProfile}`)
  }

  if (toggles.pixelFormat) {
    outputOptions.push(`-pix_fmt ${config.pixelFormat}`)
  }

  if (fps) {
    outputOptions.push(`${buildStreamSuffix('-r:v', streamNum)} ${fps}`)
  }

  // PeerTube's live builder pins an average bitrate as well as the ceiling; its
  // VOD builder does not.
  if (isLiveStream(streamNum)) {
    outputOptions.push(`${buildStreamSuffix('-b:v', streamNum)} ${target}`)
  }

  if (toggles.videoOutputOptions && config.videoOutputOptions.length > 0) {
    outputOptions.push(...config.videoOutputOptions)
  }

  return outputOptions
}

module.exports = {
  PRESETS,
  PEERTUBE_PRESET,
  PEERTUBE_BUFSIZE_MULTIPLIER,
  normalizePreset,
  buildStreamSuffix,
  peertubeTargetBitrate,
  getTargetBitrate,
  buildVideoReencodeOptions
}
