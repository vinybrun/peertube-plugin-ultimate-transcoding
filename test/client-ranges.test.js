'use strict'

// The admin UI clamps numeric fields so the value on screen is the value the
// server will actually use. That means the ranges live in two places: the
// clampInt/clampFloat calls in main.js, and NUMERIC_RANGES in the client script
// (which is an ES module for the browser, so it cannot be require()d here).
//
// Rather than trust them to stay in step, parse both and compare.

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const mainSource = readFileSync(join(root, 'main.js'), 'utf8')
const clientSource = readFileSync(join(root, 'client/admin-plugin-client-plugin.js'), 'utf8')

function serverRanges () {
  const ranges = {}
  const re = /clamp(?:Int|Float)\(values\['([^']+)'\],\s*([\d.]+),\s*([\d.]+),/g

  let match
  while ((match = re.exec(mainSource)) !== null) {
    ranges[match[1]] = { min: Number(match[2]), max: Number(match[3]) }
  }

  return ranges
}

function serverResolutionRange () {
  const match = /clampInt\(values\[getResolutionSettingName\(resolution, 'kbps'\)\],\s*(\d+),\s*(\d+),/.exec(mainSource)
  assert.ok(match, 'could not find the resolution kbps clamp in main.js')

  return { min: Number(match[1]), max: Number(match[2]) }
}

function serverDefaults () {
  const block = /const DEFAULTS = \{([\s\S]*?)\n\}/.exec(mainSource)
  assert.ok(block, 'could not find DEFAULTS in main.js')

  const defaults = {}
  const re = /^\s{2}(\w+):\s*([\d.]+),?$/gm

  let match
  while ((match = re.exec(block[1])) !== null) {
    defaults[match[1]] = Number(match[2])
  }

  const resolutions = {}
  const resBlock = /resolutions: \{([\s\S]*?)\n {2}\}/.exec(block[1])
  assert.ok(resBlock, 'could not find DEFAULTS.resolutions in main.js')

  const resRe = /(\d+): \{ enabled: \w+, kbps: (\d+) \}/g
  while ((match = resRe.exec(resBlock[1])) !== null) {
    resolutions[match[1]] = Number(match[2])
  }

  return { defaults, resolutions }
}

function clientLiteral (name) {
  const match = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\})`).exec(clientSource)
  assert.ok(match, `could not find ${name} in the client script`)

  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[1]}`)()
}

// Which setting each DEFAULTS key backs, for the fallback comparison
const FALLBACK_KEYS = {
  'vod-crf': 'crf',
  'vod-audio-kbps': 'audioKbps',
  'vod-bufsize-multiplier': 'bufsizeMultiplier',
  'vod-original-resolution-kbps': 'originalResolutionKbps',
  'vod-libx264-priority': 'libx264Priority',
  'vod-aac-priority': 'aacPriority',
  'vod-libfdk-aac-priority': 'libfdkAacPriority'
}

test('every clamped server setting has a matching client range', () => {
  const server = serverRanges()
  const client = clientLiteral('NUMERIC_RANGES')

  assert.ok(Object.keys(server).length >= 7, 'expected to parse several clamps from main.js')

  for (const [ name, range ] of Object.entries(server)) {
    assert.ok(client[name], `client script is missing a range for ${name}`)
    assert.equal(client[name].min, range.min, `${name} min disagrees with main.js`)
    assert.equal(client[name].max, range.max, `${name} max disagrees with main.js`)
  }

  for (const name of Object.keys(client)) {
    assert.ok(server[name], `client script clamps ${name}, which main.js does not`)
  }
})

test('client fallbacks match the server defaults', () => {
  const client = clientLiteral('NUMERIC_RANGES')
  const { defaults } = serverDefaults()

  for (const [ settingName, defaultKey ] of Object.entries(FALLBACK_KEYS)) {
    assert.equal(
      client[settingName].fallback,
      defaults[defaultKey],
      `${settingName} fallback disagrees with DEFAULTS.${defaultKey}`
    )
  }
})

test('resolution rows share the server range and per-rung defaults', () => {
  const clientRange = clientLiteral('RESOLUTION_KBPS_RANGE')
  const clientDefaults = clientLiteral('RESOLUTION_DEFAULT_KBPS')
  const serverRange = serverResolutionRange()
  const { resolutions } = serverDefaults()

  assert.deepEqual(clientRange, serverRange)
  assert.deepEqual(
    Object.fromEntries(Object.entries(clientDefaults).map(([ k, v ]) => [ String(k), v ])),
    resolutions
  )
})

test('a fallback is inside its own range', () => {
  const client = clientLiteral('NUMERIC_RANGES')

  for (const [ name, range ] of Object.entries(client)) {
    assert.ok(range.fallback >= range.min && range.fallback <= range.max, `${name} fallback is outside its range`)
  }
})
