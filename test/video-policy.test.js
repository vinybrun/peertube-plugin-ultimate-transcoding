'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PRESETS,
  normalizePreset,
  shouldCopyVideo,
  hasVideoEncodeOverride,
  peertubeTargetBitrate,
  buildPeertubeDefaultVideoOptions,
  buildVideoReencodeOptions
} = require('../video-policy')

test('accepts PeerTube and x264 presets including veryfast', () => {
  assert.ok(PRESETS.includes('veryfast'))
  assert.ok(PRESETS.includes('ultrafast'))
  assert.equal(normalizePreset('veryfast', 'slow'), 'veryfast')
  assert.equal(normalizePreset('faster', 'slow'), 'faster')
  assert.equal(normalizePreset('nope', 'slow'), 'slow')
})

test('never copies video when PeerTube will scale a resolution', () => {
  assert.equal(shouldCopyVideo({ copyVideoIfPossible: true, canCopyVideo: true, resolution: 1080 }), false)
  assert.equal(shouldCopyVideo({ copyVideoIfPossible: true, canCopyVideo: true, resolution: 720 }), false)
  assert.equal(shouldCopyVideo({ copyVideoIfPossible: true, canCopyVideo: true, resolution: 0 }), true)
  assert.equal(shouldCopyVideo({ copyVideoIfPossible: true, canCopyVideo: false, resolution: 0 }), false)
  assert.equal(shouldCopyVideo({ copyVideoIfPossible: false, canCopyVideo: true, resolution: 0 }), false)
})

test('stock PeerTube defaults include veryfast, maxrate, bufsize, b-frames', () => {
  const options = buildPeertubeDefaultVideoOptions({
    resolution: 1080,
    fps: 30,
    inputRatio: 16 / 9,
    inputBitrate: 5_000_000
  })

  assert.ok(options.some(flag => flag.includes('-preset veryfast') || flag === '-preset veryfast'))
  assert.ok(options.some(flag => flag.startsWith('-maxrate:v ')))
  assert.ok(options.some(flag => flag.startsWith('-bufsize:v ')))
  assert.ok(options.includes('-b_strategy 1'))
  assert.ok(options.some(flag => flag.includes('-bf') && flag.includes('16')))
  assert.ok(options.some(flag => flag.includes('-r:v 30') || flag === '-r:v 30'))
})

test('live stock flags are stream-suffixed', () => {
  const options = buildPeertubeDefaultVideoOptions({
    resolution: 720,
    fps: 30,
    inputRatio: 16 / 9,
    streamNum: 1
  })

  assert.ok(options.includes('-preset:1 veryfast'))
  assert.ok(options.some(flag => flag.startsWith('-maxrate:v:1 ')))
  assert.ok(options.includes('-r:v:1 30'))
})

test('admin CRF override does not emit the stock veryfast ladder', () => {
  const config = {
    toggles: { crf: true, preset: false, videoProfile: false, pixelFormat: false, bufsizeMultiplier: false, originalResolutionKbps: false, videoOutputOptions: false, scaleFilterName: false },
    crf: 21,
    resolutions: []
  }

  assert.equal(hasVideoEncodeOverride(config), true)
  const options = buildVideoReencodeOptions({
    config,
    resolution: 1080,
    fps: 30,
    maxrateKbps: null
  })

  assert.deepEqual(options, [ '-crf 21' ])
})

test('PeerTube target bitrate stays below input+30% and above the min floor', () => {
  const high = peertubeTargetBitrate({ resolution: 1080, fps: 30, inputRatio: 16 / 9, inputBitrate: 50_000_000 })
  const low = peertubeTargetBitrate({ resolution: 1080, fps: 30, inputRatio: 16 / 9, inputBitrate: 100_000 })

  assert.ok(high > 1_000_000)
  assert.ok(low < high)
  assert.ok(low >= 10_000)
})
