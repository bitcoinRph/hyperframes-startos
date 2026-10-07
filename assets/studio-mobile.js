/*
 * HyperFrames Studio on a phone (StartOS package overlay).
 *
 * Studio's dock needs 600 px: a 360 px preview and two 120 px side columns.
 * On a narrower screen this script closes the side groups once, nudges the
 * dock to lay itself out again, and adds a bar with three buttons: Preview and
 * Timeline maximize or restore that group, Panels opens Studio's own Window
 * menu, where every panel and "Reset layout" live. It drives Studio only
 * through controls Studio renders itself (the tab strip, "Maximize panel",
 * "Restore panel", "Close group", "Window"), so it needs no access to the
 * React tree. assets/patch-studio.mjs refuses to install it when those
 * controls are missing from the bundle.
 */
;(() => {
  const narrow = matchMedia('(max-width: 599px)')
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const nextFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  // Studio's buttons are React handlers; a full pointer sequence satisfies both
  // the tab strip (pointerdown) and buttons (click).
  function fire(el) {
    if (!el) return false
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'touch', isPrimary: true }))
    }
    return true
  }

  const groups = () => Array.from(document.querySelectorAll('.dv-groupview'))
  const tabsOf = (group) => Array.from(group.querySelectorAll('.dv-tab')).map((t) => t.textContent.trim())
  const groupWith = (title) => groups().find((g) => tabsOf(g).includes(title))
  const isSide = (group) => !tabsOf(group).some((t) => t === 'Preview' || t === 'Timeline')
  const buttonIn = (group, label) => Array.from(group.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label)

  // Group actions render on the active group only, so activate first.
  async function act(group, label) {
    fire(group.querySelector('.dv-tab'))
    await sleep(150)
    return fire(buttonIn(group, label))
  }

  // Dockview sizes from a ResizeObserver on its shell; closing a group alone
  // leaves the old 600 px until the shell's size changes.
  async function relayout() {
    const shell = document.querySelector('.dv-shell')
    if (!shell) return
    shell.style.width = 'calc(100% - 1px)'
    await nextFrames()
    shell.style.width = ''
    await sleep(300)
  }

  async function compact() {
    const sides = groups().filter(isSide)
    for (const group of sides) await act(group, 'Close group')
    if (sides.length) await relayout()
  }

  async function toggle(title) {
    const group = groupWith(title)
    if (!group) return
    fire(group.querySelector('.dv-tab'))
    await sleep(150)
    if (buttonIn(group, 'Restore panel')) fire(buttonIn(group, 'Restore panel'))
    else fire(buttonIn(group, 'Maximize panel'))
    await sleep(200)
    refresh()
  }

  function panels() {
    const button = Array.from(document.querySelectorAll('#root button')).find((b) => b.textContent.trim() === 'Window')
    fire(button)
  }

  let bar = null
  function refresh() {
    if (!bar) return
    for (const button of bar.querySelectorAll('button[data-group]')) {
      const group = groupWith(button.dataset.group)
      const maximized = !!group && !!buttonIn(group, 'Restore panel')
      button.setAttribute('aria-pressed', String(maximized))
      button.disabled = !group
    }
  }

  function mountBar() {
    if (bar) return
    bar = document.createElement('nav')
    bar.className = 'hf-startos-bar'
    bar.setAttribute('aria-label', 'Studio panels')
    for (const [label, handler, group] of [
      ['Preview', () => toggle('Preview'), 'Preview'],
      ['Timeline', () => toggle('Timeline'), 'Timeline'],
      ['Panels', panels, null],
    ]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      if (group) button.dataset.group = group
      button.addEventListener('click', handler)
      bar.appendChild(button)
    }
    document.body.appendChild(bar)
    refresh()
  }

  function unmountBar() {
    bar?.remove()
    bar = null
  }

  // Studio shows a splash until the project resolves; wait for the dock.
  function whenDockReady(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now()
      let lastCount = 0
      let stableSince = 0
      const check = () => {
        const count = groups().length
        if (count >= 2 && count === lastCount) {
          if (!stableSince) stableSince = Date.now()
          if (Date.now() - stableSince > 400) return resolve(true)
        } else {
          stableSince = 0
          lastCount = count
        }
        if (Date.now() - started > timeoutMs) return resolve(false)
        setTimeout(check, 150)
      }
      check()
    })
  }

  let started = false
  async function start() {
    if (started) return
    started = true
    const ready = await whenDockReady(30000)
    if (!ready) return
    if (narrow.matches) {
      await compact()
      mountBar()
    }
    const observer = new MutationObserver(() => refresh())
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
  }

  narrow.addEventListener('change', (e) => {
    if (e.matches) start().then(mountBar)
    else unmountBar()
  })
  if (narrow.matches) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start())
    else void start()
  }
})()
