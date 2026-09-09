const RESOLUTIONS = [ 144, 240, 360, 480, 720, 1080, 1440, 2160 ]

const DEPENDENT_FIELDS = buildDependentFields()
// Numeric bounds, mirroring the clampInt/clampFloat calls in main.js. The server
// clamps when it *reads* a setting, so without this the admin sees the number
// they typed while ffmpeg quietly gets a different one. Kept honest by
// test/client-ranges.test.js, which parses both files and compares.
const NUMERIC_RANGES = {
  'vod-crf': { min: 16, max: 30, fallback: 21 },
  'vod-audio-kbps': { min: 64, max: 512, fallback: 320 },
  'vod-bufsize-multiplier': { min: 1, max: 10, fallback: 2, float: true },
  'vod-original-resolution-kbps': { min: 500, max: 50000, fallback: 12000 },
  'vod-libx264-priority': { min: 1, max: 10000, fallback: 100 },
  'vod-aac-priority': { min: 1, max: 10000, fallback: 100 },
  'vod-libfdk-aac-priority': { min: 1, max: 10000, fallback: 110 }
}

const RESOLUTION_KBPS_RANGE = { min: 100, max: 50000 }

const RESOLUTION_DEFAULT_KBPS = {
  144: 250,
  240: 400,
  360: 700,
  480: 1200,
  720: 2500,
  1080: 4200,
  1440: 6500,
  2160: 10000
}

function buildNumericRanges () {
  const ranges = Object.assign({}, NUMERIC_RANGES)

  for (const resolution of RESOLUTIONS) {
    ranges[getResolutionSettingName(resolution, 'kbps')] = {
      min: RESOLUTION_KBPS_RANGE.min,
      max: RESOLUTION_KBPS_RANGE.max,
      fallback: RESOLUTION_DEFAULT_KBPS[resolution]
    }
  }

  return ranges
}

// Settings that stand alone instead of being gated by an enable- checkbox.
const STANDALONE_SETTINGS = [
  'vod-audio-copy-mode',
  'vod-audio-sample-rate'
]
const RANGES = buildNumericRanges()
const OWN_SETTING_NAMES = Array.from(new Set(
  Object.keys(DEPENDENT_FIELDS)
    .concat(Object.values(DEPENDENT_FIELDS))
    .concat(STANDALONE_SETTINGS)
))

let observer = null
let renderScheduled = false
let styleInjected = false
let listenersBound = false

function buildDependentFields () {
  const dependencies = {
    'vod-crf': 'enable-vod-crf',
    'vod-preset': 'enable-vod-preset',
    'vod-audio-kbps': 'enable-vod-audio-kbps',
    'vod-bufsize-multiplier': 'enable-vod-bufsize-multiplier',
    'vod-video-profile': 'enable-vod-video-profile',
    'vod-pixel-format': 'enable-vod-pixel-format',
    'vod-scale-filter-name': 'enable-vod-scale-filter-name',
    'vod-original-resolution-kbps': 'enable-vod-original-resolution-kbps',
    'vod-video-input-options': 'enable-vod-video-input-options',
    'vod-video-output-options': 'enable-vod-video-output-options',
    'vod-audio-input-options': 'enable-vod-audio-input-options',
    'vod-audio-output-options': 'enable-vod-audio-output-options',
    'vod-libx264-priority': 'enable-vod-libx264-priority',
    'vod-aac-priority': 'enable-vod-aac-priority',
    'vod-libfdk-aac-priority': 'enable-vod-libfdk-aac-priority'
  }

  for (const resolution of RESOLUTIONS) {
    dependencies[getResolutionSettingName(resolution, 'kbps')] = getToggleName(getResolutionSettingName(resolution, 'kbps'))
  }

  return dependencies
}

function getToggleName (settingName) {
  return 'enable-' + settingName
}

function getResolutionSettingName (resolution, field) {
  return 'resolution-' + resolution + '-' + field
}

function parseBoolean (value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }

  return fallback
}

// PeerTube 8.x renders plugin settings with an `id` and no `name` attribute, so
// document.getElementsByName() finds nothing at all. Match either, so this keeps
// working on the older markup too.
function getControlSettingName (control) {
  if (!control || !control.getAttribute) return ''

  return control.getAttribute('id') || control.getAttribute('name') || ''
}

// Snap a numeric field to the range the server will enforce anyway, so the value
// on screen is the value that runs. Only on 'change' (blur / Enter), never on
// 'input', so typing "2" on the way to "25" is not clamped mid-keystroke.
function clampNumericControl (control) {
  if (!control || !control.tagName) return
  if (control.tagName.toLowerCase() !== 'input') return
  if (control.disabled || control.readOnly) return

  const range = RANGES[getControlSettingName(control)]
  if (!range) return

  const raw = String(control.value === null || control.value === undefined ? '' : control.value).trim()
  const parsed = range.float ? parseFloat(raw) : parseInt(raw, 10)

  const next = Number.isFinite(parsed)
    ? Math.max(range.min, Math.min(range.max, parsed))
    : range.fallback

  if (String(next) === raw) return

  control.value = String(next)

  // Let Angular's form model pick the corrected value up
  if (typeof Event === 'function') {
    control.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function handleChangeEvent (event) {
  if (event && event.target) clampNumericControl(event.target)

  scheduleRender()
}

function getNamedControls (name) {
  const selector = '[id="' + name + '"], [name="' + name + '"]'

  return Array.from(document.querySelectorAll(selector)).filter(function (control) {
    if (!control || !control.tagName) return false

    const tagName = control.tagName.toLowerCase()
    if (tagName !== 'input' && tagName !== 'select' && tagName !== 'textarea') return false

    return !(tagName === 'input' && control.type === 'hidden')
  })
}

function getControlValue (control) {
  if (!control || !control.tagName) return undefined

  const tagName = control.tagName.toLowerCase()

  if (tagName === 'input') {
    if (control.type === 'checkbox') return !!control.checked
    if (control.type === 'radio') return control.checked ? control.value : undefined
  }

  return control.value
}

// Read our own settings by name via getNamedControls(), which matches on id as
// well. Scanning for `[name]` finds nothing on PeerTube 8.x, which left every
// toggle reading as false and every dependent field permanently disabled.
function getFormValuesFromDom () {
  const values = {}

  for (const name of OWN_SETTING_NAMES) {
    const control = getNamedControls(name)[0]
    if (!control) continue

    const value = getControlValue(control)
    if (typeof value === 'undefined') continue

    values[name] = value
  }

  return values
}

function getSettingContainer (control) {
  let current = control

  while (current && current !== document.body) {
    const tagName = current.tagName ? current.tagName.toLowerCase() : ''

    if (
      tagName === 'my-input-checkbox' ||
      tagName === 'my-input-text' ||
      tagName === 'my-input-textarea' ||
      tagName === 'my-select-custom' ||
      (current.classList && (
        current.classList.contains('form-group') ||
        current.classList.contains('peertube-form-group')
      ))
    ) {
      return current
    }

    current = current.parentElement
  }

  return control.parentElement || control
}

function findFirstContainer (name) {
  const control = getNamedControls(name)[0]
  if (!control) return null

  return getSettingContainer(control)
}

function setFieldDisabledState (control, disabled) {
  if (!control) return

  control.disabled = disabled

  if (control.tagName && (control.tagName.toLowerCase() === 'input' || control.tagName.toLowerCase() === 'textarea')) {
    if (control.type !== 'checkbox' && control.type !== 'radio') {
      control.readOnly = disabled
    }
  }

  control.setAttribute('aria-disabled', disabled ? 'true' : 'false')
}

function markSettingContainers () {
  for (const [ fieldName, toggleName ] of Object.entries(DEPENDENT_FIELDS)) {
    const toggleContainer = findFirstContainer(toggleName)
    const valueContainer = findFirstContainer(fieldName)

    if (toggleContainer) {
      toggleContainer.classList.add('ut-setting-block', 'ut-setting-toggle')
    }

    if (valueContainer) {
      valueContainer.classList.add('ut-setting-block', 'ut-setting-input')
    }
  }

  for (const name of STANDALONE_SETTINGS) {
    const container = findFirstContainer(name)
    if (!container) continue

    container.classList.add('ut-setting-block', 'ut-setting-boolean')
  }
}

function ensureResolutionRows () {
  for (const resolution of RESOLUTIONS) {
    const valueName = getResolutionSettingName(resolution, 'kbps')
    const toggleName = getToggleName(valueName)
    const toggleContainer = findFirstContainer(toggleName)
    const valueContainer = findFirstContainer(valueName)

    if (!toggleContainer || !valueContainer) continue

    toggleContainer.classList.add('ut-resolution-row__toggle')
    valueContainer.classList.add('ut-resolution-row__field')

    let row = toggleContainer.parentElement && toggleContainer.parentElement.classList.contains('ut-resolution-row')
      ? toggleContainer.parentElement
      : null

    if (!row) {
      row = document.createElement('div')
      row.className = 'ut-resolution-row'
      row.setAttribute('data-ut-resolution', String(resolution))
      toggleContainer.parentElement.insertBefore(row, toggleContainer)
    }

    if (!row.contains(toggleContainer)) {
      row.appendChild(toggleContainer)
    }

    let inputWrap = row.querySelector('.ut-resolution-row__input')
    if (!inputWrap) {
      inputWrap = document.createElement('div')
      inputWrap.className = 'ut-resolution-row__input'
      row.appendChild(inputWrap)
    }

    if (!inputWrap.contains(valueContainer)) {
      inputWrap.appendChild(valueContainer)
    }

    let unit = inputWrap.querySelector('.ut-resolution-row__unit')
    if (!unit) {
      unit = document.createElement('span')
      unit.className = 'ut-resolution-row__unit'
      unit.textContent = 'kbps'
      inputWrap.appendChild(unit)
    }
  }
}

function updateFieldStates (values) {
  for (const [ fieldName, toggleName ] of Object.entries(DEPENDENT_FIELDS)) {
    const enabled = parseBoolean(values[toggleName], false)
    const controls = getNamedControls(fieldName)
    const containers = new Set()

    for (const control of controls) {
      setFieldDisabledState(control, !enabled)
      containers.add(getSettingContainer(control))
    }

    containers.forEach(function (container) {
      if (!container || !container.classList) return

      container.classList.toggle('ut-disabled-setting', !enabled)
    })
  }
}

function findPluginForm () {
  for (const name of OWN_SETTING_NAMES) {
    const control = getNamedControls(name)[0]
    if (!control) continue

    const form = control.closest('form')
    if (form) return form
  }

  return null
}

function getControlLabelText (control) {
  if (!control) return ''

  if (control.tagName && control.tagName.toLowerCase() === 'input') {
    return String(control.value || '').trim()
  }

  return String(control.textContent || '').replace(/\s+/g, ' ').trim()
}

function findPrimarySaveControl () {
  const root = findPluginForm() || document

  const controls = Array.from(root.querySelectorAll('button, input[type="submit"]')).filter(function (control) {
    return !control.closest('.ut-section-save')
  })

  if (controls.length === 0) return null

  const preferred = controls.find(function (control) {
    const label = getControlLabelText(control).toLowerCase()
    return label === 'update plugin settings' || label === 'save'
  })

  if (preferred) return preferred

  return controls.find(function (control) {
    return control.type === 'submit'
  }) || controls[0]
}

function getSectionContainers () {
  return Array.from(document.querySelectorAll('.ut-section-copy'))
    .filter(function (sectionCopy) {
      return !sectionCopy.classList.contains('ut-section-copy--overview')
    })
    .map(function (sectionCopy, index) {
      const container = getSettingContainer(sectionCopy)
      if (!container) return null

      if (!container.dataset.utSectionKey) {
        container.dataset.utSectionKey = String(index)
      }

      return container
    })
    .filter(Boolean)
}

function buildSectionSaveAction (sectionKey, primarySaveControl) {
  const action = document.createElement('div')
  action.className = 'ut-section-save'
  action.dataset.utSectionSaveFor = sectionKey

  let button

  if (primarySaveControl.tagName && primarySaveControl.tagName.toLowerCase() === 'input') {
    button = document.createElement('input')
    button.type = 'button'
    button.value = getControlLabelText(primarySaveControl) || 'Update plugin settings'
    button.className = primarySaveControl.className
  } else {
    button = primarySaveControl.cloneNode(true)
    button.type = 'button'
    button.removeAttribute('id')
  }

  button.classList.add('ut-section-save__button')
  button.disabled = !!primarySaveControl.disabled
  button.setAttribute('aria-disabled', primarySaveControl.disabled ? 'true' : 'false')

  button.addEventListener('click', function (event) {
    event.preventDefault()
    if (primarySaveControl.disabled) return
    primarySaveControl.click()
  })

  action.appendChild(button)
  return action
}

function removeOrphanSectionSaveActions (sectionKeys) {
  const validKeys = new Set(sectionKeys)

  for (const action of Array.from(document.querySelectorAll('.ut-section-save'))) {
    if (validKeys.has(action.dataset.utSectionSaveFor)) continue
    action.remove()
  }
}

function ensureSectionSaveActions () {
  const primarySaveControl = findPrimarySaveControl()
  if (!primarySaveControl) return

  const sectionContainers = getSectionContainers()
  if (sectionContainers.length === 0) return

  const sectionSet = new Set(sectionContainers)
  const sectionKeys = sectionContainers.map(function (container) {
    return container.dataset.utSectionKey
  })

  removeOrphanSectionSaveActions(sectionKeys)

  for (const sectionContainer of sectionContainers) {
    const sectionKey = sectionContainer.dataset.utSectionKey
    let action = document.querySelector('.ut-section-save[data-ut-section-save-for="' + sectionKey + '"]')
    const label = getControlLabelText(primarySaveControl) || 'Update plugin settings'

    if (!action) {
      action = buildSectionSaveAction(sectionKey, primarySaveControl)
    } else {
      const existingButton = action.querySelector('button, input[type="button"]')
      if (existingButton) {
        if (existingButton.tagName && existingButton.tagName.toLowerCase() === 'input') {
          if (existingButton.value !== label) {
            existingButton.value = label
          }
        } else {
          if (getControlLabelText(existingButton) !== label) {
            existingButton.textContent = label
          }
        }

        existingButton.disabled = !!primarySaveControl.disabled
        existingButton.setAttribute('aria-disabled', primarySaveControl.disabled ? 'true' : 'false')
      }
    }

    let lastNode = sectionContainer
    let cursor = sectionContainer.nextElementSibling

    while (cursor) {
      if (cursor.classList && cursor.classList.contains('ut-section-save')) {
        cursor = cursor.nextElementSibling
        continue
      }

      if (sectionSet.has(cursor)) break

      lastNode = cursor
      cursor = cursor.nextElementSibling
    }

    if (lastNode.nextElementSibling !== action) {
      lastNode.insertAdjacentElement('afterend', action)
    }
  }
}

function injectStyles () {
  if (styleInjected) return

  const style = document.createElement('style')
  style.textContent = `
.ut-section-copy,
.ut-setting-block,
.ut-resolution-row,
.ut-section-save {
  max-width: 960px;
}

.ut-section-copy {
  margin: 0 0 1.4rem 0;
}

.ut-section-copy h3 {
  margin: 1.9rem 0 0.45rem 0;
}

.ut-section-copy--overview h3 {
  margin-top: 0;
}

.ut-section-copy p {
  margin: 0;
  max-width: 860px;
  line-height: 1.55;
}

.ut-section-save {
  margin: 0.35rem 0 1.6rem 0;
}

.ut-section-save__button {
  min-width: 220px;
}

.ut-setting-toggle,
.ut-setting-boolean {
  margin-bottom: 0.45rem;
}

.ut-setting-input {
  margin-bottom: 1.25rem;
  max-width: 320px;
}

.ut-setting-boolean {
  margin-top: 0.15rem;
  margin-bottom: 1.15rem;
}

.ut-disabled-setting {
  opacity: 0.55;
}

.ut-disabled-setting input,
.ut-disabled-setting select,
.ut-disabled-setting textarea {
  cursor: not-allowed;
}

.ut-resolution-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.1rem;
  margin-bottom: 0.95rem;
}

.ut-resolution-row__toggle {
  flex: 1 1 auto;
  max-width: none;
  margin-bottom: 0;
}

.ut-resolution-row__input {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 220px;
  min-width: 180px;
}

.ut-resolution-row__field {
  flex: 1 1 auto;
  max-width: none;
  margin-bottom: 0;
}

.ut-resolution-row__unit {
  font-size: 0.92rem;
  opacity: 0.8;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .ut-resolution-row {
    flex-direction: column;
    gap: 0.45rem;
  }

  .ut-resolution-row__input {
    flex-basis: auto;
    width: 100%;
    max-width: 320px;
  }
}
`

  document.head.appendChild(style)
  styleInjected = true
}

function hasPluginControls () {
  return OWN_SETTING_NAMES.some(function (name) {
    return getNamedControls(name).length > 0
  })
}

function applyEnhancements () {
  if (!hasPluginControls()) return

  injectStyles()
  markSettingContainers()
  ensureResolutionRows()
  updateFieldStates(getFormValuesFromDom())
  ensureSectionSaveActions()
}

function startObserver () {
  if (observer || typeof MutationObserver === 'undefined' || !document.body) return

  observer = new MutationObserver(function () {
    scheduleRender()
  })

  observer.observe(document.body, { childList: true, subtree: true })
}

function scheduleRender () {
  if (renderScheduled) return

  renderScheduled = true

  const run = function () {
    renderScheduled = false
    startObserver()
    applyEnhancements()
  }

  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    window.requestAnimationFrame(run)
    return
  }

  setTimeout(run, 0)
}

function register ({ registerHook }) {
  registerHook({
    target: 'action:application.init',
    handler: function () {
      scheduleRender()
    }
  })

  registerHook({
    target: 'action:router.navigation-end',
    handler: function () {
      scheduleRender()
    }
  })

  if (!listenersBound) {
    document.addEventListener('change', handleChangeEvent, true)
    document.addEventListener('input', scheduleRender, true)
    listenersBound = true
  }

  scheduleRender()
}

export { register }
