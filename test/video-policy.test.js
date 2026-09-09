'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PRESETS,
  normalizePreset,
  peertubeTargetBitrate,
  getTargetBitrate,
  buildVideoReencodeOptions
} = require('../video-policy')

function config (overrides = {}) {
  return Object.assign({
    toggles: {
      crf: false,
      preset: false,
      videoProfile: false,
      pixelFormat: false,
      bufsizeMultiplier: false,
      originalResolutionKbps: false,
      videoInputOptions: false,
      videoOutputOptions: false,
      scaleFilterName: false
    },
    crf: 21,
    preset: 'slow',
    videoProfile: 'high',
    pixelFormat: 'yuv420p',
    bufsizeMultiplier: 2,
    videoOutputOptions: [],
    resolutions: []
  }, overrides)
}

function flagValue (options, flag) {
  const found = options.find(option => option.split(' ')[0] === flag)
  return found === undefined ? undefined : found.split(' ').slice(1).join(' ')
}

test('accepts PeerTube and x264 presets including veryfast', () => {
  assert.ok(PRESETS.includes('veryfast'))
  assert.ok(PRESETS.includes('ultrafast'))
  assert.equal(normalizePreset('veryfast', 'slow'), 'veryfast')
  assert.equal(normalizePreset('faster', 'slow'), 'faster')
  assert.equal(normalizePreset('nope', 'slow'), 'slow')
})

test('with no override enabled, emits PeerTube stock ladder', () => {
  const options = buildVideoReencodeOptions({
    config: config(),
    resolution: 1080,
    fps: 30,
    inputRatio: 16 / 9,
    inputBitrate: 5_000_000,
    maxrateKbps: null
  })

  assert.equal(flagValue(options, '-preset'), 'veryfast')
  assert.ok(options.includes('-b_strategy 1'))
  assert.ok(options.includes('-bf 16'))
  assert.equal(flagValue(options, '-r:v'), '30')
  assert.ok(flagValue(options, '-maxrate:v'))
  assert.ok(flagValue(options, '-bufsize:v'))
})

// Regression: a rung with no cap of its own used to return [] as soon as any
// other override was enabled, handing PeerTube an empty builder and losing the
// stock ladder entirely.
test('a rung without its own cap still gets the stock ladder', () => {
  const partial = config({ resolutions: [ { resolution: 720, enabled: true, kbps: 2500 } ] })

  const options = buildVideoReencodeOptions({
    config: partial,
    resolution: 1080,
    fps: 30,
    inputRatio: 16 / 9,
    inputBitrate: 5_000_000,
    maxrateKbps: null
  })

  assert.equal(flagValue(options, '-preset'), 'veryfast')
  assert.equal(flagValue(options, '-r:v'), '30')
  assert.equal(flagValue(options, '-maxrate:v'), String(peertubeTargetBitrate({
    resolution: 1080, fps: 30, inputRatio: 16 / 9, inputBitrate: 5_000_000
  })))
})

// Regression: libx264 ignores -maxrate when no -bufsize accompanies it, so the
// rendition cap silently did nothing unless the buffer toggle was also on.
test('a rendition cap always ships with a buffer', () => {
  const options = buildVideoReencodeOptions({
    config: config(),
    resolution: 720,
    fps: 30,
    inputRatio: 16 / 9,
    maxrateKbps: 2500
  })

  assert.equal(flagValue(options, '-maxrate:v'), '2500000')
  assert.equal(flagValue(options, '-bufsize:v'), '5000000')
})

test('the buffer multiplier toggle only changes the multiplier', () => {
  const options = buildVideoReencodeOptions({
    config: config({ toggles: Object.assign(config().toggles, { bufsizeMultiplier: true }), bufsizeMultiplier: 1.5 }),
    resolution: 720,
    fps: 30,
    inputRatio: 16 / 9,
    maxrateKbps: 2000
  })

  assert.equal(flagValue(options, '-bufsize:v'), '3000000')
})

// Regression: nothing in PeerTube sets output fps except the encoder builder,
// so an override that dropped -r left the rendition at the source frame rate
// while PeerTube still derived -g:v from the fps it expected.
test('overrides keep fps and preset', () => {
  const options = buildVideoReencodeOptions({
    config: config({ toggles: Object.assign(config().toggles, { crf: true }) }),
    resolution: 1080,
    fps: 25,
    inputRatio: 16 / 9,
    inputBitrate: 5_000_000,
    maxrateKbps: null
  })

  assert.equal(flagValue(options, '-crf'), '21')
  assert.equal(flagValue(options, '-r:v'), '25')
  assert.equal(flagValue(options, '-preset'), 'veryfast')
})

test('an explicit preset override replaces the stock one exactly once', () => {
  const options = buildVideoReencodeOptions({
    config: config({ toggles: Object.assign(config().toggles, { preset: true }), preset: 'slow' }),
    resolution: 1080,
    fps: 30,
    inputRatio: 16 / 9,
    maxrateKbps: null
  })

  assert.deepEqual(options.filter(option => option.startsWith('-preset')), [ '-preset slow' ])
})

// Regression: bare flags must not take a stream number. `-crf:1` selects output
// stream index 1, which in a live command is ordered by -map and is usually the
// wrong stream (with split audio, index 0 is the audio track).
test('live suffixes only stream-typed flags', () => {
  const options = buildVideoReencodeOptions({
    config: config({ toggles: Object.assign(config().toggles, { crf: true, pixelFormat: true }) }),
    resolution: 720,
    fps: 30,
    inputRatio: 16 / 9,
    inputBitrate: 4_000_000,
    streamNum: 1,
    maxrateKbps: null
  })

  assert.ok(options.includes('-preset veryfast'))
  assert.ok(options.includes('-crf 21'))
  assert.ok(options.includes('-bf 16'))
  assert.ok(options.includes('-pix_fmt yuv420p'))
  assert.ok(options.some(option => option.startsWith('-maxrate:v:1 ')))
  assert.ok(options.some(option => option.startsWith('-bufsize:v:1 ')))
  assert.equal(flagValue(options, '-r:v:1'), '30')

  for (const option of options) {
    assert.doesNotMatch(option.split(' ')[0], /^-[a-z_]+:\d+$/, `bare index specifier in ${option}`)
  }
})

// PeerTube's live builder pins an average bitrate too; its VOD builder does not.
test('only live pins -b:v', () => {
  const live = buildVideoReencodeOptions({
    config: config(), resolution: 720, fps: 30, inputRatio: 16 / 9, inputBitrate: 4_000_000, streamNum: 0, maxrateKbps: null
  })
  const vod = buildVideoReencodeOptions({
    config: config(), resolution: 720, fps: 30, inputRatio: 16 / 9, inputBitrate: 4_000_000, maxrateKbps: null
  })

  assert.ok(live.some(option => option.startsWith('-b:v:0 ')))
  assert.ok(!vod.some(option => option.startsWith('-b:v')))
})

test('a rendition cap overrides the computed target', () => {
  assert.equal(getTargetBitrate({ maxrateKbps: 2500, resolution: 720, fps: 30, inputRatio: 16 / 9 }), 2_500_000)
  assert.equal(
    getTargetBitrate({ maxrateKbps: null, resolution: 720, fps: 30, inputRatio: 16 / 9, inputBitrate: 4_000_000 }),
    peertubeTargetBitrate({ resolution: 720, fps: 30, inputRatio: 16 / 9, inputBitrate: 4_000_000 })
  )
})

test('extra output options come last so they can override', () => {
  const options = buildVideoReencodeOptions({
    config: config({
      toggles: Object.assign(config().toggles, { videoOutputOptions: true }),
      videoOutputOptions: [ '-x264-params keyint=60' ]
    }),
    resolution: 1080,
    fps: 30,
    inputRatio: 16 / 9,
    maxrateKbps: null
  })

  assert.equal(options[options.length - 1], '-x264-params keyint=60')
})

test('PeerTube target bitrate stays below input+30% and above the min floor', () => {
  const high = peertubeTargetBitrate({ resolution: 1080, fps: 30, inputRatio: 16 / 9, inputBitrate: 50_000_000 })
  const low = peertubeTargetBitrate({ resolution: 1080, fps: 30, inputRatio: 16 / 9, inputBitrate: 100_000 })

  assert.ok(high > 1_000_000)
  assert.ok(low < high)
  assert.ok(low >= 10_000)
})
