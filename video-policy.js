'use strict'

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

function normalizePreset (value, fallback) {
  return PRESETS.includes(value) ? value : fallback
}

function buildStreamSuffix (flag, streamNum) {
  return streamNum === undefined || streamNum === null || streamNum === ''
    ? flag
    : `${flag}:${streamNum}`
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

function shouldCopyVideo (options) {
  const {
    copyVideoIfPossible = false,
    canCopyVideo = false,
    resolution = 0
  } = options

  if (!copyVideoIfPossible || !canCopyVideo) return false

  // PeerTube 8.x always adds scale=w=-2:h=RESOLUTION for any video job.
  // ffmpeg then dies: "Filtergraph was specified, but codec copy was selected."
  if (resolution) return false

  return true
}

function hasVideoEncodeOverride (config) {
  if (!config || !config.toggles) return false

  if (
    config.toggles.crf ||
    config.toggles.preset ||
    config.toggles.videoProfile ||
    config.toggles.pixelFormat ||
    config.toggles.bufsizeMultiplier ||
    config.toggles.originalResolutionKbps ||
    config.toggles.videoOutputOptions ||
    config.toggles.scaleFilterName
  ) {
    return true
  }

  return Array.isArray(config.resolutions) && config.resolutions.some(entry => entry.enabled)
}

function buildPeertubeDefaultVideoOptions (options) {
  const {
    resolution,
    fps,
    inputBitrate,
    inputRatio,
    streamNum
  } = options

  const target = peertubeTargetBitrate({ inputBitrate, inputRatio, fps, resolution })
  const outputOptions = [
    `${buildStreamSuffix('-preset', streamNum)} veryfast`,
    `${buildStreamSuffix('-maxrate:v', streamNum)} ${target}`,
    `${buildStreamSuffix('-bufsize:v', streamNum)} ${target * 2}`,
    '-b_strategy 1',
    `${buildStreamSuffix('-bf', streamNum)} 16`
  ]

  if (fps) {
    outputOptions.push(`${buildStreamSuffix('-r:v', streamNum)} ${fps}`)
  }

  return outputOptions
}

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

  if (!hasVideoEncodeOverride(config)) {
    return buildPeertubeDefaultVideoOptions({ resolution, fps, inputBitrate, inputRatio, streamNum })
  }

  const outputOptions = []

  if (config.toggles.crf) {
    outputOptions.push(`${buildStreamSuffix('-crf', streamNum)} ${config.crf}`)
  }

  if (config.toggles.preset) {
    outputOptions.push(`${buildStreamSuffix('-preset', streamNum)} ${config.preset}`)
  }

  if (config.toggles.videoProfile) {
    outputOptions.push(`${buildStreamSuffix('-profile:v', streamNum)} ${config.videoProfile}`)
  }

  if (maxrateKbps !== null && maxrateKbps !== undefined) {
    outputOptions.push(`${buildStreamSuffix('-maxrate:v', streamNum)} ${maxrateKbps}k`)

    if (config.toggles.bufsizeMultiplier) {
      outputOptions.push(`${buildStreamSuffix('-bufsize:v', streamNum)} ${Math.round(maxrateKbps * config.bufsizeMultiplier)}k`)
    }
  }

  if (config.toggles.pixelFormat) {
    outputOptions.push(`${buildStreamSuffix('-pix_fmt', streamNum)} ${config.pixelFormat}`)
  }

  if (config.toggles.videoOutputOptions && config.videoOutputOptions.length > 0) {
    outputOptions.push(...config.videoOutputOptions)
  }

  return outputOptions
}

module.exports = {
  PRESETS,
  normalizePreset,
  buildStreamSuffix,
  peertubeTargetBitrate,
  shouldCopyVideo,
  hasVideoEncodeOverride,
  buildPeertubeDefaultVideoOptions,
  buildVideoReencodeOptions
}
