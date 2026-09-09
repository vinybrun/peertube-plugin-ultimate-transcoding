'use strict'

// PeerTube passes `streamNum` for live jobs, where one ffmpeg command writes
// every rung at once. Only flags that already name a stream type can take that
// number: `-b:a` becomes `-b:a:0` ("first audio stream"), `-maxrate:v` becomes
// `-maxrate:v:1` ("second video stream").
//
// A bare flag must be left alone. `-crf:1` does not mean "video rung 1", it
// means "output stream index 1", and live output streams are ordered by the
// `-map` calls in ffmpeg-live.ts: with split audio and two rungs that is
// 0=audio, 1=video, 2=video. So `-crf:0` lands on the audio stream and the
// video rung gets no CRF at all. PeerTube's own builders keep `-preset`,
// `-b_strategy` and `-bf` unsuffixed for exactly this reason.
const STREAM_TYPED_FLAG = /:[va]$/

function isLiveStream (streamNum) {
  return streamNum !== undefined && streamNum !== null && streamNum !== ''
}

function buildStreamSuffix (flag, streamNum) {
  if (!isLiveStream(streamNum)) return flag
  if (!STREAM_TYPED_FLAG.test(flag)) return flag

  return `${flag}:${streamNum}`
}

module.exports = {
  isLiveStream,
  buildStreamSuffix
}
