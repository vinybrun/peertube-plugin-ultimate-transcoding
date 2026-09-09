'use strict'

const {
  normalizeAudioCopyMode,
  inspectAudioStream,
  shouldCopyAudio,
  buildAudioReencodeOptions
} = require('./audio-policy')

const {
  PRESETS,
  normalizePreset,
  buildVideoReencodeOptions
} = require('./video-policy')

const RESOLUTIONS = [ 144, 240, 360, 480, 720, 1080, 1440, 2160 ]

const DEFAULTS = {
  crf: 21,
  preset: 'slow',
  audioKbps: 320,
  audioCopyMode: 'off',
  audioSampleRate: '',
  bufsizeMultiplier: 2,
  videoProfile: 'high',
  pixelFormat: 'yuv420p',
  scaleFilterName: '',
  copyAudioIfPossible: false,
  originalResolutionKbps: 12000,
  videoInputOptions: [],
  videoOutputOptions: [],
  audioInputOptions: [],
  audioOutputOptions: [],
  libx264Priority: 100,
  aacPriority: 100,
  libfdkAacPriority: 110,
  resolutions: {
    144: { enabled: false, kbps: 250 },
    240: { enabled: false, kbps: 400 },
    360: { enabled: false, kbps: 700 },
    480: { enabled: false, kbps: 1200 },
    720: { enabled: false, kbps: 2500 },
    1080: { enabled: false, kbps: 4200 },
    1440: { enabled: false, kbps: 6500 },
    2160: { enabled: false, kbps: 10000 }
  },
  toggles: {
    crf: false,
    preset: false,
    audioKbps: false,
    bufsizeMultiplier: false,
    videoProfile: false,
    pixelFormat: false,
    scaleFilterName: false,
    originalResolutionKbps: false,
    videoInputOptions: false,
    videoOutputOptions: false,
    audioInputOptions: false,
    audioOutputOptions: false,
    libx264Priority: false,
    aacPriority: false,
    libfdkAacPriority: false
  }
}

const PROFILE_OPTIONS = [
  { label: 'Baseline', value: 'baseline' },
  { label: 'Main', value: 'main' },
  { label: 'High', value: 'high' },
  { label: 'High 10', value: 'high10' },
  { label: 'High 4:2:2', value: 'high422' },
  { label: 'High 4:4:4', value: 'high444' }
]

const PIXEL_FORMAT_OPTIONS = [
  { label: 'yuv420p - 8-bit 4:2:0 (widest compatibility)', value: 'yuv420p' },
  { label: 'yuvj420p - 8-bit 4:2:0 full-range / JPEG-range', value: 'yuvj420p' },
  { label: 'yuv422p - 8-bit 4:2:2', value: 'yuv422p' },
  { label: 'yuvj422p - 8-bit 4:2:2 full-range / JPEG-range', value: 'yuvj422p' },
  { label: 'yuv444p - 8-bit 4:4:4', value: 'yuv444p' },
  { label: 'yuvj444p - 8-bit 4:4:4 full-range / JPEG-range', value: 'yuvj444p' },
  { label: 'nv12 - 8-bit 4:2:0 semi-planar', value: 'nv12' },
  { label: 'nv16 - 8-bit 4:2:2 semi-planar', value: 'nv16' },
  { label: 'nv21 - 8-bit 4:2:0 semi-planar (VU order)', value: 'nv21' },
  { label: 'yuv420p10le - 10-bit 4:2:0', value: 'yuv420p10le' },
  { label: 'yuv422p10le - 10-bit 4:2:2', value: 'yuv422p10le' },
  { label: 'yuv444p10le - 10-bit 4:4:4', value: 'yuv444p10le' },
  { label: 'nv20le - 10-bit 4:2:2 semi-planar', value: 'nv20le' },
  { label: 'gray - 8-bit luma only', value: 'gray' },
  { label: 'gray10le - 10-bit luma only', value: 'gray10le' }
]

const PIXEL_FORMAT_PROFILE_HINTS = {
  nv16: 'high422',
  nv20le: 'high422',
  gray10le: 'high10'
}

let runtimeConfig = buildDefaultConfig()
let rawRuntimeSettings = {}

function buildDefaultConfig () {
  return {
    toggles: Object.assign({}, DEFAULTS.toggles),
    crf: DEFAULTS.crf,
    preset: DEFAULTS.preset,
    audioKbps: DEFAULTS.audioKbps,
    audioCopyMode: DEFAULTS.audioCopyMode,
    audioSampleRate: DEFAULTS.audioSampleRate,
    bufsizeMultiplier: DEFAULTS.bufsizeMultiplier,
    videoProfile: DEFAULTS.videoProfile,
    pixelFormat: DEFAULTS.pixelFormat,
    scaleFilterName: DEFAULTS.scaleFilterName,
    copyAudioIfPossible: DEFAULTS.copyAudioIfPossible,
    originalResolutionKbps: DEFAULTS.originalResolutionKbps,
    videoInputOptions: [ ...DEFAULTS.videoInputOptions ],
    videoOutputOptions: [ ...DEFAULTS.videoOutputOptions ],
    audioInputOptions: [ ...DEFAULTS.audioInputOptions ],
    audioOutputOptions: [ ...DEFAULTS.audioOutputOptions ],
    libx264Priority: DEFAULTS.libx264Priority,
    aacPriority: DEFAULTS.aacPriority,
    libfdkAacPriority: DEFAULTS.libfdkAacPriority,
    resolutions: RESOLUTIONS.map(resolution => ({
      resolution,
      enabled: DEFAULTS.resolutions[resolution].enabled,
      kbps: DEFAULTS.resolutions[resolution].kbps
    }))
  }
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function clampFloat(value, min, max, fallback) {
  const n = parseFloat(value)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }

  return fallback
}

function normalizeOptionalString(value, fallback = '') {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed || fallback
}

function parseOptionLines(value) {
  if (typeof value !== 'string') return []

  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

function normalizePresetValue (value) {
  return normalizePreset(value, DEFAULTS.preset)
}

function normalizeVideoProfile(value) {
  return [ 'baseline', 'main', 'high', 'high10', 'high422', 'high444' ].includes(value)
    ? value
    : DEFAULTS.videoProfile
}

function normalizePixelFormat(value) {
  return PIXEL_FORMAT_OPTIONS.some(option => option.value === value)
    ? value
    : DEFAULTS.pixelFormat
}

function getToggleName(settingName) {
  return `enable-${settingName}`
}

function getResolutionSettingName(resolution, field) {
  return `resolution-${resolution}-${field}`
}

function getProfileForPixelFormat(pixelFormat, profile) {
  if (!pixelFormat) return profile
  if (PIXEL_FORMAT_PROFILE_HINTS[pixelFormat]) return PIXEL_FORMAT_PROFILE_HINTS[pixelFormat]
  if (pixelFormat.includes('444')) return 'high444'
  if (pixelFormat.includes('422')) return 'high422'
  if (pixelFormat.includes('10')) return 'high10'

  return profile
}

function getResolutionCapKbps(resolution, config) {
  const exact = config.resolutions.find(entry => entry.resolution === resolution)
  if (exact) return exact.enabled ? exact.kbps : null

  return config.toggles.originalResolutionKbps ? config.originalResolutionKbps : null
}

function normalizeSettings(values) {
  const config = buildDefaultConfig()

  config.toggles.crf = parseBoolean(values[getToggleName('vod-crf')], DEFAULTS.toggles.crf)
  config.toggles.preset = parseBoolean(values[getToggleName('vod-preset')], DEFAULTS.toggles.preset)
  config.toggles.audioKbps = parseBoolean(values[getToggleName('vod-audio-kbps')], DEFAULTS.toggles.audioKbps)
  config.toggles.bufsizeMultiplier = parseBoolean(values[getToggleName('vod-bufsize-multiplier')], DEFAULTS.toggles.bufsizeMultiplier)
  config.toggles.videoProfile = parseBoolean(values[getToggleName('vod-video-profile')], DEFAULTS.toggles.videoProfile)
  config.toggles.pixelFormat = parseBoolean(values[getToggleName('vod-pixel-format')], DEFAULTS.toggles.pixelFormat)
  config.toggles.scaleFilterName = parseBoolean(values[getToggleName('vod-scale-filter-name')], DEFAULTS.toggles.scaleFilterName)
  config.toggles.originalResolutionKbps = parseBoolean(values[getToggleName('vod-original-resolution-kbps')], DEFAULTS.toggles.originalResolutionKbps)
  config.toggles.videoInputOptions = parseBoolean(values[getToggleName('vod-video-input-options')], DEFAULTS.toggles.videoInputOptions)
  config.toggles.videoOutputOptions = parseBoolean(values[getToggleName('vod-video-output-options')], DEFAULTS.toggles.videoOutputOptions)
  config.toggles.audioInputOptions = parseBoolean(values[getToggleName('vod-audio-input-options')], DEFAULTS.toggles.audioInputOptions)
  config.toggles.audioOutputOptions = parseBoolean(values[getToggleName('vod-audio-output-options')], DEFAULTS.toggles.audioOutputOptions)
  config.toggles.libx264Priority = parseBoolean(values[getToggleName('vod-libx264-priority')], DEFAULTS.toggles.libx264Priority)
  config.toggles.aacPriority = parseBoolean(values[getToggleName('vod-aac-priority')], DEFAULTS.toggles.aacPriority)
  config.toggles.libfdkAacPriority = parseBoolean(values[getToggleName('vod-libfdk-aac-priority')], DEFAULTS.toggles.libfdkAacPriority)

  config.crf = clampInt(values['vod-crf'], 16, 30, DEFAULTS.crf)
  config.preset = normalizePresetValue(values['vod-preset'])
  config.audioKbps = clampInt(values['vod-audio-kbps'], 64, 512, DEFAULTS.audioKbps)
  config.audioCopyMode = normalizeAudioCopyMode(
    values['vod-audio-copy-mode'],
    parseBoolean(values['vod-copy-audio-if-possible'], DEFAULTS.copyAudioIfPossible)
  )
  config.audioSampleRate = [ '44100', '48000' ].includes(values['vod-audio-sample-rate'])
    ? values['vod-audio-sample-rate']
    : DEFAULTS.audioSampleRate
  config.bufsizeMultiplier = clampFloat(values['vod-bufsize-multiplier'], 1, 10, DEFAULTS.bufsizeMultiplier)
  config.videoProfile = normalizeVideoProfile(values['vod-video-profile'])
  config.pixelFormat = normalizePixelFormat(values['vod-pixel-format'])
  config.scaleFilterName = normalizeOptionalString(values['vod-scale-filter-name'], DEFAULTS.scaleFilterName)
  config.copyAudioIfPossible = config.audioCopyMode !== 'off'
  config.originalResolutionKbps = clampInt(values['vod-original-resolution-kbps'], 500, 50000, DEFAULTS.originalResolutionKbps)
  config.videoInputOptions = parseOptionLines(values['vod-video-input-options'])
  config.videoOutputOptions = parseOptionLines(values['vod-video-output-options'])
  config.audioInputOptions = parseOptionLines(values['vod-audio-input-options'])
  config.audioOutputOptions = parseOptionLines(values['vod-audio-output-options'])
  config.libx264Priority = clampInt(values['vod-libx264-priority'], 1, 10000, DEFAULTS.libx264Priority)
  config.aacPriority = clampInt(values['vod-aac-priority'], 1, 10000, DEFAULTS.aacPriority)
  config.libfdkAacPriority = clampInt(values['vod-libfdk-aac-priority'], 1, 10000, DEFAULTS.libfdkAacPriority)

  config.resolutions = RESOLUTIONS.map(resolution => ({
    resolution,
    enabled: parseBoolean(values[getToggleName(getResolutionSettingName(resolution, 'kbps'))], DEFAULTS.resolutions[resolution].enabled),
    kbps: clampInt(values[getResolutionSettingName(resolution, 'kbps')], 100, 50000, DEFAULTS.resolutions[resolution].kbps)
  }))

  return config
}

// PeerTube's getSetting() falls back to the *registered* default whenever a
// setting was never stored, so an install upgrading from 0.6.x reads
// 'vod-audio-copy-mode' back as 'off' and normalizeAudioCopyMode() never sees an
// unset value. Register the new select with a default derived from the old
// checkbox instead.
//
// Deliberately not settingsManager.setSetting(): it writes `settings.<name>`
// through Sequelize, which rewrites the whole JSON column and drops every other
// setting the admin had saved. Verified on 8.2.4.
async function getLegacyAudioCopyDefault (settingsManager) {
  try {
    const legacy = await settingsManager.getSetting('vod-copy-audio-if-possible')
    return parseBoolean(legacy, false) ? 'when-safe' : DEFAULTS.audioCopyMode
  } catch (err) {
    console.error('ultimate-transcoding: could not read the legacy copy-audio setting', err)
    return DEFAULTS.audioCopyMode
  }
}

async function loadSettings(settingsManager) {
  const names = [
    getToggleName('vod-crf'),
    getToggleName('vod-preset'),
    getToggleName('vod-audio-kbps'),
    getToggleName('vod-bufsize-multiplier'),
    getToggleName('vod-video-profile'),
    getToggleName('vod-pixel-format'),
    getToggleName('vod-scale-filter-name'),
    getToggleName('vod-original-resolution-kbps'),
    getToggleName('vod-video-input-options'),
    getToggleName('vod-video-output-options'),
    getToggleName('vod-audio-input-options'),
    getToggleName('vod-audio-output-options'),
    getToggleName('vod-libx264-priority'),
    getToggleName('vod-aac-priority'),
    getToggleName('vod-libfdk-aac-priority'),
    'vod-crf',
    'vod-preset',
    'vod-audio-kbps',
    'vod-bufsize-multiplier',
    'vod-video-profile',
    'vod-pixel-format',
    'vod-scale-filter-name',
    'vod-copy-audio-if-possible',
    'vod-audio-copy-mode',
    'vod-audio-sample-rate',
    'vod-original-resolution-kbps',
    'vod-video-input-options',
    'vod-video-output-options',
    'vod-audio-input-options',
    'vod-audio-output-options',
    'vod-libx264-priority',
    'vod-aac-priority',
    'vod-libfdk-aac-priority',
    ...RESOLUTIONS.flatMap(resolution => [
      getToggleName(getResolutionSettingName(resolution, 'kbps')),
      getResolutionSettingName(resolution, 'kbps')
    ])
  ]

  const values = {}

  for (const name of names) {
    values[name] = await settingsManager.getSetting(name)
  }

  return values
}

function registerSection(registerSetting, title, description, className = '') {
  const classes = [ 'ut-section-copy' ]

  if (className) {
    classes.push(`ut-section-copy--${className}`)
  }

  registerSetting({
    type: 'html',
    private: true,
    html: `<div class="${classes.join(' ')}"><h3>${title}</h3><p>${description}</p></div>`
  })
}

function registerToggle(registerSetting, settingName, label, descriptionHTML) {
  registerSetting({
    name: getToggleName(settingName),
    label,
    type: 'input-checkbox',
    default: false,
    private: true,
    descriptionHTML
  })
}

function registerCheckbox(registerSetting, name, label, descriptionHTML, defaultValue = false) {
  registerSetting({
    name,
    label,
    type: 'input-checkbox',
    default: defaultValue,
    private: true,
    descriptionHTML
  })
}

function registerOverviewSection(registerSetting) {
  registerSection(
    registerSetting,
    'Overview',
    'Use this page to tune video quality, bitrate limits, compatibility, and advanced FFmpeg options for future transcodes. If a flag you need is not listed as its own setting, add it later in the additional FFmpeg input/output options fields.',
    'overview'
  )
}

function registerQualitySettings(registerSetting) {
  registerSection(
    registerSetting,
    'Quality & Bitrate',
    'Adjust the main encoding targets used when this profile re-encodes video or audio.',
    'quality'
  )

  registerToggle(
    registerSetting,
    'vod-crf',
    'CRF',
    'Constant quality for video. Lower values keep more detail and create larger files. FFmpeg flag: <code>-crf</code>. Range: 16 to 30.'
  )
  registerSetting({
    name: 'vod-crf',
    type: 'input',
    default: String(DEFAULTS.crf),
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-preset',
    'Preset',
    'Encoding speed versus compression efficiency. Slower presets usually save bitrate, but they take more CPU time. FFmpeg flag: <code>-preset</code>.'
  )
  registerSetting({
    name: 'vod-preset',
    type: 'select',
    default: DEFAULTS.preset,
    private: true,
    options: PRESETS.map(preset => ({ label: preset, value: preset }))
  })

  registerToggle(
    registerSetting,
    'vod-audio-kbps',
    'Audio bitrate',
    'Target bitrate when audio is re-encoded. Unit: kbps. FFmpeg flag: <code>-b:a</code>. Range: 64 to 512. Use 320 for concert / hi-fi stereo AAC, or 512 if you want the practical AAC-LC ceiling. CD PCM (~1411 kbps) cannot be preserved losslessly in the web player; copy a pre-encoded AAC stream instead.'
  )
  registerSetting({
    name: 'vod-audio-kbps',
    type: 'input',
    default: String(DEFAULTS.audioKbps),
    private: true
  })

  registerSetting({
    name: 'vod-audio-sample-rate',
    label: 'Audio sample rate',
    type: 'select',
    default: DEFAULTS.audioSampleRate,
    private: true,
    descriptionHTML: 'Leave at source unless you need a fixed rate. CD recordings are 44100 Hz. Most video workflows use 48000 Hz. FFmpeg flag: <code>-ar</code>.',
    options: [
      { label: 'Keep source sample rate', value: '' },
      { label: '44100 Hz (CD)', value: '44100' },
      { label: '48000 Hz (video / broadcast)', value: '48000' }
    ]
  })

  registerToggle(
    registerSetting,
    'vod-bufsize-multiplier',
    'Buffer size multiplier',
    'Sets the VBV buffer size relative to the active max bitrate. Formula: <code>bufsize = max bitrate x multiplier</code>. A buffer is always emitted alongside <code>-maxrate</code> because libx264 ignores a ceiling that has no buffer; enable this only to change the multiplier away from PeerTube\'s <code>2</code>. FFmpeg flag: <code>-bufsize</code>.'
  )
  registerSetting({
    name: 'vod-bufsize-multiplier',
    type: 'input',
    default: String(DEFAULTS.bufsizeMultiplier),
    private: true
  })
}

function registerCompatibilitySettings(registerSetting, audioCopyModeDefault) {
  registerSection(
    registerSetting,
    'Compatibility & Stream Handling',
    'Choose the output format, scaler behavior, and when PeerTube may reuse existing streams instead of re-encoding them. Resolution generation itself stays in PeerTube\'s main transcoding settings.',
    'compatibility'
  )

  registerToggle(
    registerSetting,
    'vod-video-profile',
    'H.264 profile',
    'Controls decoder compatibility and the H.264 feature set. More advanced profiles can reduce playback compatibility. FFmpeg flag: <code>-profile:v</code>.'
  )
  registerSetting({
    name: 'vod-video-profile',
    type: 'select',
    default: DEFAULTS.videoProfile,
    private: true,
    options: PROFILE_OPTIONS
  })

  registerToggle(
    registerSetting,
    'vod-pixel-format',
    'Pixel format',
    'Output chroma format and bit depth. <code>yuv420p</code> is the safest choice for web playback. FFmpeg flag: <code>-pix_fmt</code>.'
  )
  registerSetting({
    name: 'vod-pixel-format',
    type: 'select',
    default: DEFAULTS.pixelFormat,
    private: true,
    options: PIXEL_FORMAT_OPTIONS
  })

  registerToggle(
    registerSetting,
    'vod-scale-filter-name',
    'Scale filter',
    'Overrides PeerTube\'s scale filter name. Leave this disabled unless you need a specific scaler such as <code>scale_vaapi</code>.'
  )
  registerSetting({
    name: 'vod-scale-filter-name',
    type: 'input',
    default: DEFAULTS.scaleFilterName,
    private: true
  })

  registerSetting({
    name: 'vod-audio-copy-mode',
    label: 'Audio copy / passthrough',
    type: 'select',
    default: audioCopyModeDefault,
    private: true,
    descriptionHTML: 'PeerTube often sets <code>canCopyAudio=false</code> when it builds more than one resolution or a separate AAC track. In that case a simple "copy when possible" checkbox never fires, and ffmpeg falls back to 128 kbps. <strong>Prefer compatible AAC</strong> copies a stereo AAC-LC source even then, which is the right concert / CD pipeline if you pre-encode audio to AAC 320 or 512.',
    options: [
      { label: 'Never copy (always re-encode)', value: 'off' },
      { label: 'Copy only when PeerTube allows it', value: 'when-safe' },
      { label: 'Copy compatible AAC on audio-only / split jobs', value: 'audio-only' },
      { label: 'Prefer compatible AAC (recommended for concert / CD)', value: 'prefer-compatible' }
    ]
  })
}

function registerResolutionSettings(registerSetting) {
  registerSection(
    registerSetting,
    'Max Bitrate Per Resolution (kbps)',
    'Enable a row to set a maximum video bitrate for that resolution. These rows only change bitrate limits; PeerTube still decides which resolutions are generated.',
    'bitrates'
  )

  for (const resolution of RESOLUTIONS) {
    const name = getResolutionSettingName(resolution, 'kbps')

    registerToggle(registerSetting, name, `${resolution}p`)
    registerSetting({
      name,
      type: 'input',
      default: String(DEFAULTS.resolutions[resolution].kbps),
      private: true
    })
  }

  registerToggle(
    registerSetting,
    'vod-original-resolution-kbps',
    'Source / non-standard resolution',
    'Maximum video bitrate for source-height or other non-standard outputs that do not match the preset resolution list above. This applies when PeerTube generates such outputs. Unit: kbps. FFmpeg flag: <code>-maxrate</code>.'
  )
  registerSetting({
    name: 'vod-original-resolution-kbps',
    type: 'input',
    default: String(DEFAULTS.originalResolutionKbps),
    private: true
  })
}

function registerExpertSettings(registerSetting) {
  registerSection(
    registerSetting,
    'Expert Options',
    'Use these settings when the dedicated controls above are not enough. Add one complete FFmpeg option per line in the extra input/output fields. Lines starting with <code>#</code> are ignored. Higher encoder priority numbers are preferred first, and are re-applied as soon as you save.',
    'expert'
  )

  registerToggle(
    registerSetting,
    'vod-video-input-options',
    'Additional video input options',
    'Extra FFmpeg input options for video. Use this when the dedicated settings above do not cover the flag you need.'
  )
  registerSetting({
    name: 'vod-video-input-options',
    type: 'input-textarea',
    default: '',
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-video-output-options',
    'Additional video output options',
    'Extra FFmpeg output options for video. These are appended after the plugin\'s generated video flags.'
  )
  registerSetting({
    name: 'vod-video-output-options',
    type: 'input-textarea',
    default: '',
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-audio-input-options',
    'Additional audio input options',
    'Extra FFmpeg input options for audio. Use this when the dedicated settings above do not cover the flag you need.'
  )
  registerSetting({
    name: 'vod-audio-input-options',
    type: 'input-textarea',
    default: '',
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-audio-output-options',
    'Additional audio output options',
    'Extra FFmpeg output options for audio. These are appended after the plugin\'s generated audio flags.'
  )
  registerSetting({
    name: 'vod-audio-output-options',
    type: 'input-textarea',
    default: '',
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-libx264-priority',
    'libx264 encoder priority',
    'Priority hint for the <code>libx264</code> video encoder when it is available.'
  )
  registerSetting({
    name: 'vod-libx264-priority',
    type: 'input',
    default: String(DEFAULTS.libx264Priority),
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-aac-priority',
    'AAC encoder priority',
    'Priority hint for the built-in <code>aac</code> audio encoder when it is available.'
  )
  registerSetting({
    name: 'vod-aac-priority',
    type: 'input',
    default: String(DEFAULTS.aacPriority),
    private: true
  })

  registerToggle(
    registerSetting,
    'vod-libfdk-aac-priority',
    'libfdk_aac encoder priority',
    'Priority hint for <code>libfdk_aac</code>. This only matters if your FFmpeg build includes that encoder.'
  )
  registerSetting({
    name: 'vod-libfdk-aac-priority',
    type: 'input',
    default: String(DEFAULTS.libfdkAacPriority),
    private: true
  })
}

function applyEncoderPriorities(transcodingManager, config) {
  if (config.toggles.libx264Priority) {
    transcodingManager.addVODEncoderPriority('video', 'libx264', config.libx264Priority)
    transcodingManager.addLiveEncoderPriority('video', 'libx264', config.libx264Priority)
  }

  if (config.toggles.aacPriority) {
    transcodingManager.addVODEncoderPriority('audio', 'aac', config.aacPriority)
    transcodingManager.addLiveEncoderPriority('audio', 'aac', config.aacPriority)
  }

  if (config.toggles.libfdkAacPriority) {
    transcodingManager.addVODEncoderPriority('audio', 'libfdk_aac', config.libfdkAacPriority)
    transcodingManager.addLiveEncoderPriority('audio', 'libfdk_aac', config.libfdkAacPriority)
  }
}

function buildVideoConfig () {
  const config = runtimeConfig

  if (config.toggles.videoProfile && config.toggles.pixelFormat) {
    return Object.assign({}, config, {
      videoProfile: getProfileForPixelFormat(config.pixelFormat, config.videoProfile)
    })
  }

  return config
}

// PeerTube never lets a video job copy: every rung it asks us to build carries a
// resolution, and buildVODCommand / getLiveTranscodingCommand always add a scale
// filter for it. ffmpeg then refuses the job with "Filtergraph was specified, but
// codec copy was selected". The 0p audio rung is the only unscaled job and it is
// routed to the audio builder, so there is nothing here to copy.
const videoBuilder = async ({ resolution, fps, inputBitrate, inputRatio, streamNum }) => {
  const options = {}
  const outputOptions = buildVideoReencodeOptions({
    config: buildVideoConfig(),
    resolution,
    fps,
    inputBitrate,
    inputRatio,
    streamNum,
    maxrateKbps: getResolutionCapKbps(resolution, runtimeConfig)
  })

  if (outputOptions.length > 0) {
    options.outputOptions = outputOptions
  }

  if (runtimeConfig.toggles.videoInputOptions && runtimeConfig.videoInputOptions.length > 0) {
    options.inputOptions = runtimeConfig.videoInputOptions
  }

  if (runtimeConfig.toggles.scaleFilterName && runtimeConfig.scaleFilterName) {
    options.scaleFilter = { name: runtimeConfig.scaleFilterName }
  }

  return options
}

const audioBuilder = async ({ canCopyAudio, inputProbe, resolution, streamNum }) => {
  const audioInfo = inspectAudioStream(inputProbe)

  if (shouldCopyAudio({
    mode: runtimeConfig.audioCopyMode,
    canCopyAudio,
    resolution,
    audioInfo
  })) {
    return { copy: true }
  }

  const outputOptions = []
  const options = {}

  outputOptions.push(...buildAudioReencodeOptions({
    audioKbps: runtimeConfig.toggles.audioKbps ? runtimeConfig.audioKbps : null,
    audioInfo,
    sampleRate: runtimeConfig.audioSampleRate,
    streamNum
  }))

  if (runtimeConfig.toggles.audioOutputOptions && runtimeConfig.audioOutputOptions.length > 0) {
    outputOptions.push(...runtimeConfig.audioOutputOptions)
  }

  if (outputOptions.length > 0) {
    options.outputOptions = outputOptions
  }

  if (runtimeConfig.toggles.audioInputOptions && runtimeConfig.audioInputOptions.length > 0) {
    options.inputOptions = runtimeConfig.audioInputOptions
  }

  return options
}

function installProfiles (transcodingManager) {
  if (typeof transcodingManager.removeAllProfilesAndEncoderPriorities === 'function') {
    transcodingManager.removeAllProfilesAndEncoderPriorities()
  }

  const profileName = 'ultimate-transcoding'

  transcodingManager.addVODProfile('libx264', profileName, videoBuilder)
  transcodingManager.addVODProfile('aac', profileName, audioBuilder)
  transcodingManager.addVODProfile('libfdk_aac', profileName, audioBuilder)
  transcodingManager.addLiveProfile('libx264', profileName, videoBuilder)
  transcodingManager.addLiveProfile('aac', profileName, audioBuilder)
  transcodingManager.addLiveProfile('libfdk_aac', profileName, audioBuilder)

  applyEncoderPriorities(transcodingManager, runtimeConfig)
}

async function register ({ transcodingManager, registerSetting, settingsManager }) {
  const audioCopyModeDefault = await getLegacyAudioCopyDefault(settingsManager)

  registerOverviewSection(registerSetting)
  registerQualitySettings(registerSetting)
  registerCompatibilitySettings(registerSetting, audioCopyModeDefault)
  registerResolutionSettings(registerSetting)
  registerExpertSettings(registerSetting)

  rawRuntimeSettings = await loadSettings(settingsManager)
  runtimeConfig = normalizeSettings(rawRuntimeSettings)

  settingsManager.onSettingsChange(settings => {
    rawRuntimeSettings = Object.assign({}, rawRuntimeSettings, settings)
    runtimeConfig = normalizeSettings(rawRuntimeSettings)
    installProfiles(transcodingManager)
  })

  installProfiles(transcodingManager)
}

async function unregister () {
  // Nothing to clean up
}

module.exports = {
  register,
  unregister
}
