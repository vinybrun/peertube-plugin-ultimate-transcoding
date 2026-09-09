'use strict'

const AUDIO_COPY_MODES = [ 'off', 'when-safe', 'audio-only', 'prefer-compatible' ]

const PEERTUBE_FALLBACK_AUDIO_KBPS = 256
const PEERTUBE_MAX_AUDIO_KBPS = 384

function normalizeAudioCopyMode (value, legacyCopyAudioIfPossible) {
  if (AUDIO_COPY_MODES.includes(value)) return value
  return legacyCopyAudioIfPossible ? 'when-safe' : 'off'
}

function parsePositiveInt (value) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function inspectAudioStream (inputProbe) {
  if (!inputProbe || !Array.isArray(inputProbe.streams)) return null

  const audioStream = inputProbe.streams.find(stream => stream.codec_type === 'audio')
  if (!audioStream) return null

  const hasVideo = inputProbe.streams.some(stream => stream.codec_type === 'video')
  const formatBitrate = inputProbe.format && inputProbe.format.bit_rate
    ? parsePositiveInt(inputProbe.format.bit_rate)
    : null

  return {
    codec: audioStream.codec_name || '',
    profile: audioStream.profile || '',
    bitrate: parsePositiveInt(audioStream.bit_rate) || (hasVideo ? null : formatBitrate),
    sampleRate: parsePositiveInt(audioStream.sample_rate),
    channels: parsePositiveInt(audioStream.channels),
    channelLayout: audioStream.channel_layout || ''
  }
}

function isHeAacProfile (profile) {
  const value = String(profile || '').toLowerCase()
  return value.includes('he') || value.includes('sbr') || value.includes('parametric')
}

function isSafeToCopyAac (audioInfo) {
  if (!audioInfo || audioInfo.codec !== 'aac') return false
  if (isHeAacProfile(audioInfo.profile)) return false

  const layout = audioInfo.channelLayout
  if (!layout || layout === 'unknown' || layout === 'quad') return false
  if (audioInfo.channels && audioInfo.channels > 2) return false

  return true
}

function isAudioOnlyJob (resolution) {
  return !resolution
}

function shouldCopyAudio (options) {
  const {
    mode = 'off',
    canCopyAudio = false,
    resolution = 0,
    audioInfo = null
  } = options

  if (mode === 'off') return false
  if (!isSafeToCopyAac(audioInfo)) return false
  if (canCopyAudio) return true
  if (mode === 'when-safe') return false
  if (mode === 'audio-only') return isAudioOnlyJob(resolution)
  if (mode === 'prefer-compatible') return true

  return false
}

function getFallbackAudioKbps (audioInfo) {
  if (!audioInfo || !audioInfo.bitrate) {
    if (audioInfo && audioInfo.codec === 'flac') return PEERTUBE_MAX_AUDIO_KBPS
    return PEERTUBE_FALLBACK_AUDIO_KBPS
  }

  const sourceKbps = Math.round(audioInfo.bitrate / 1000)
  if (sourceKbps <= 0) return PEERTUBE_FALLBACK_AUDIO_KBPS

  return Math.min(PEERTUBE_MAX_AUDIO_KBPS, sourceKbps)
}

function buildStreamSuffix (flag, streamNum) {
  return streamNum === undefined || streamNum === null || streamNum === ''
    ? flag
    : `${flag}:${streamNum}`
}

function buildAudioReencodeOptions (options) {
  const {
    audioKbps = null,
    audioInfo = null,
    sampleRate = '',
    streamNum,
    forceStereo = true
  } = options

  const outputOptions = []

  if (forceStereo) {
    outputOptions.push(`${buildStreamSuffix('-channel_layout', streamNum)} stereo`)
  }

  const bitrate = audioKbps || getFallbackAudioKbps(audioInfo)
  if (bitrate) {
    outputOptions.push(`${buildStreamSuffix('-b:a', streamNum)} ${bitrate}k`)
  }

  if (sampleRate === '44100' || sampleRate === '48000') {
    outputOptions.push(`${buildStreamSuffix('-ar', streamNum)} ${sampleRate}`)
  }

  outputOptions.push(`${buildStreamSuffix('-profile:a', streamNum)} aac_low`)

  return outputOptions
}

module.exports = {
  AUDIO_COPY_MODES,
  PEERTUBE_FALLBACK_AUDIO_KBPS,
  PEERTUBE_MAX_AUDIO_KBPS,
  normalizeAudioCopyMode,
  inspectAudioStream,
  isHeAacProfile,
  isSafeToCopyAac,
  isAudioOnlyJob,
  shouldCopyAudio,
  getFallbackAudioKbps,
  buildStreamSuffix,
  buildAudioReencodeOptions
}
