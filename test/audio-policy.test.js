'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeAudioCopyMode,
  inspectAudioStream,
  isSafeToCopyAac,
  shouldCopyAudio,
  getFallbackAudioKbps,
  buildAudioReencodeOptions,
  PEERTUBE_FALLBACK_AUDIO_KBPS,
  PEERTUBE_MAX_AUDIO_KBPS
} = require('../audio-policy')

function probe (audio = {}) {
  return {
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      {
        codec_type: 'audio',
        codec_name: audio.codec || 'aac',
        profile: audio.profile || 'LC',
        bit_rate: audio.bitrate,
        sample_rate: audio.sampleRate || '44100',
        channels: audio.channels || 2,
        channel_layout: audio.channelLayout || 'stereo'
      }
    ],
    format: {
      bit_rate: audio.formatBitrate
    }
  }
}

test('migrates the old copy-audio checkbox', () => {
  assert.equal(normalizeAudioCopyMode(undefined, false), 'off')
  assert.equal(normalizeAudioCopyMode(undefined, true), 'when-safe')
  assert.equal(normalizeAudioCopyMode('prefer-compatible', false), 'prefer-compatible')
  assert.equal(normalizeAudioCopyMode('nope', true), 'when-safe')
})

test('inspects the first audio stream from an ffprobe dump', () => {
  const info = inspectAudioStream(probe({ bitrate: '320000' }))
  assert.equal(info.codec, 'aac')
  assert.equal(info.bitrate, 320000)
  assert.equal(info.sampleRate, 44100)
  assert.equal(info.channels, 2)
})

test('treats VBR AAC with no stream bitrate as copy-safe', () => {
  const info = inspectAudioStream(probe({ bitrate: undefined }))
  assert.equal(info.bitrate, null)
  assert.equal(isSafeToCopyAac(info), true)
})

test('does not use container bitrate when a video stream is present', () => {
  const info = inspectAudioStream(probe({ bitrate: undefined, formatBitrate: '8000000' }))
  assert.equal(info.bitrate, null)
})

test('uses container bitrate only for audio-only files', () => {
  const info = inspectAudioStream({
    streams: [ { codec_type: 'audio', codec_name: 'flac', channel_layout: 'stereo', channels: 2 } ],
    format: { bit_rate: '400000' }
  })
  assert.equal(info.bitrate, 400000)
})

test('refuses to copy HE-AAC', () => {
  assert.equal(isSafeToCopyAac(inspectAudioStream(probe({ profile: 'HE-AAC' }))), false)
  assert.equal(isSafeToCopyAac(inspectAudioStream(probe({ profile: 'HE-AACv2' }))), false)
  assert.equal(isSafeToCopyAac(inspectAudioStream(probe({ profile: 'LC' }))), true)
})

test('refuses to copy surround or unknown layouts', () => {
  assert.equal(isSafeToCopyAac(inspectAudioStream(probe({ channelLayout: 'quad', channels: 4 }))), false)
  assert.equal(isSafeToCopyAac(inspectAudioStream(probe({ channelLayout: 'unknown' }))), false)
  assert.equal(isSafeToCopyAac(inspectAudioStream(probe({ codec: 'flac' }))), false)
})

test('when-safe only copies if PeerTube allows it', () => {
  const audioInfo = inspectAudioStream(probe({ bitrate: '320000' }))

  assert.equal(shouldCopyAudio({ mode: 'when-safe', canCopyAudio: true, resolution: 1080, audioInfo }), true)
  assert.equal(shouldCopyAudio({ mode: 'when-safe', canCopyAudio: false, resolution: 0, audioInfo }), false)
})

test('audio-only copies compatible AAC on 0p / split jobs even when PeerTube forbids copy', () => {
  const audioInfo = inspectAudioStream(probe({ bitrate: '320000' }))

  assert.equal(shouldCopyAudio({ mode: 'audio-only', canCopyAudio: false, resolution: 0, audioInfo }), true)
  assert.equal(shouldCopyAudio({ mode: 'audio-only', canCopyAudio: false, resolution: 1080, audioInfo }), false)
})

test('prefer-compatible copies AAC on muxed and split jobs', () => {
  const audioInfo = inspectAudioStream(probe({ bitrate: '320000' }))

  assert.equal(shouldCopyAudio({ mode: 'prefer-compatible', canCopyAudio: false, resolution: 0, audioInfo }), true)
  assert.equal(shouldCopyAudio({ mode: 'prefer-compatible', canCopyAudio: false, resolution: 720, audioInfo }), true)
  assert.equal(shouldCopyAudio({ mode: 'off', canCopyAudio: true, resolution: 0, audioInfo }), false)
})

test('does not copy PCM or FLAC even in prefer-compatible', () => {
  const pcm = inspectAudioStream(probe({ codec: 'pcm_s16le', bitrate: '1411200' }))
  assert.equal(shouldCopyAudio({ mode: 'prefer-compatible', canCopyAudio: false, resolution: 0, audioInfo: pcm }), false)
})

test('PeerTube-like fallback bitrate never silently drops to ffmpeg 128k', () => {
  assert.equal(getFallbackAudioKbps(inspectAudioStream(probe({ bitrate: undefined, codec: 'aac' }))), PEERTUBE_FALLBACK_AUDIO_KBPS)
  assert.equal(getFallbackAudioKbps(inspectAudioStream(probe({ bitrate: undefined, codec: 'flac' }))), PEERTUBE_MAX_AUDIO_KBPS)
  assert.equal(getFallbackAudioKbps(inspectAudioStream(probe({ bitrate: '1411200', codec: 'pcm_s16le' }))), PEERTUBE_MAX_AUDIO_KBPS)
  assert.equal(getFallbackAudioKbps(inspectAudioStream(probe({ bitrate: '192000', codec: 'mp3' }))), 192)
})

test('re-encode options force stereo AAC-LC and an explicit bitrate', () => {
  const options = buildAudioReencodeOptions({
    audioKbps: 320,
    sampleRate: '44100',
    streamNum: undefined
  })

  assert.deepEqual(options, [
    '-channel_layout stereo',
    '-b:a 320k',
    '-ar 44100',
    '-profile:a aac_low'
  ])
})

// Only flags that already name a stream type may carry the live stream number.
// `-ar:0` means "output stream index 0", which with split audio is whichever
// stream -map put first, so PeerTube leaves those flags global.
test('live suffixes only stream-typed audio flags', () => {
  const options = buildAudioReencodeOptions({
    audioKbps: 320,
    sampleRate: '44100',
    streamNum: 0
  })

  assert.deepEqual(options, [
    '-channel_layout stereo',
    '-b:a:0 320k',
    '-ar 44100',
    '-profile:a:0 aac_low'
  ])
})

test('uses PeerTube-like fallback bitrate when the admin did not set one', () => {
  const options = buildAudioReencodeOptions({
    audioKbps: null,
    audioInfo: inspectAudioStream(probe({ bitrate: '1411200', codec: 'pcm_s16le' }))
  })

  assert.ok(options.includes(`-b:a ${PEERTUBE_MAX_AUDIO_KBPS}k`))
})
