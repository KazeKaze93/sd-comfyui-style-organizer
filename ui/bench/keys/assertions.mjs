/**
 * Keyboard a11y prod-bench assertions (Comfy Style Organizer).
 *
 * Target contract (same matrix as WebUI twin KEYS-E2E):
 *   Tab into/out of grid · arrows · Enter/Space select · Home/End/Ctrl/PageDown
 *   focus survives 3-screen scroll · ContextMenu/Shift+F10 + Escape restore
 *   Escape layering · dialog trap+restore · no body focus
 *
 * READ-ONLY app code. Incomplete / crashing keyboard UI → FAIL (not skipped).
 */

export const CARD_SEL = '[data-sg-card="true"]'
export const GRID_SEL = '[role="grid"][data-sg-item-count]'
export const MAX_TAB_STEPS = 60

/**
 * @typedef {{ id: string, ok: boolean, detail: string }} AssertionResult
 */

/**
 * @param {import('playwright').Page} page
 */
export async function installCloseProbe(page) {
  await page.evaluate(() => {
    window.__sgKeysClose = []
    if (window.__sgKeysCloseListening) return
    window.__sgKeysCloseListening = true
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SG_CLOSE_REQUEST') {
        window.__sgKeysClose.push(Date.now())
      }
    })
  })
}

/**
 * @param {import('playwright').Page} page
 * @param {string[]} [bucket]
 * @returns {{ getErrors: () => string[], attach: (p: import('playwright').Page) => void }}
 */
export function installPageErrorProbe(page, bucket = []) {
  const attach = (/** @type {import('playwright').Page} */ p) => {
    p.on('pageerror', (err) => {
      bucket.push(err.message)
    })
  }
  attach(page)
  return {
    getErrors: () => bucket.slice(),
    attach,
  }
}

/**
 * @param {import('playwright').Page} page
 */
export async function clearCloseProbe(page) {
  await page.evaluate(() => {
    window.__sgKeysClose = []
  })
}

/**
 * @param {import('playwright').Page} page
 */
export async function closeCount(page) {
  return page.evaluate(() => (window.__sgKeysClose || []).length)
}

/**
 * @param {import('playwright').Page} page
 */
export async function focusSnapshot(page) {
  return page.evaluate(({ cardSel, gridSel }) => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) {
      return {
        kind: 'body',
        tag: el?.tagName || 'NONE',
        role: null,
        tabIndex: -1,
        isCard: false,
        inGrid: false,
        isDialog: false,
        isMenu: false,
        label: '',
        selected: false,
        rootAlive: (document.getElementById('root')?.childElementCount ?? 0) > 0,
      }
    }
    const card = el.closest(cardSel) || (el.matches?.(cardSel) ? el : null)
    const gridcell = el.getAttribute('role') === 'gridcell' ? el : el.closest('[role="gridcell"]')
    const grid = el.closest(gridSel)
    const dialog = el.closest('[role="dialog"], [role="alertdialog"]')
    const menuHost = el.closest('[role="menu"]') || el.closest('.fixed')
    const menu =
      menuHost &&
      /Select|Deselect|Favorite|Edit|Duplicate|Delete|Copy/i.test(menuHost.textContent || '')
        ? menuHost
        : null
    return {
      kind: card || gridcell ? 'card' : dialog ? 'dialog' : menu ? 'menu' : grid ? 'grid' : 'other',
      tag: el.tagName,
      role: el.getAttribute('role'),
      tabIndex: el.tabIndex,
      isCard: Boolean(card || (gridcell && gridcell.hasAttribute('data-sg-card'))),
      inGrid: Boolean(grid || card || gridcell),
      isDialog: Boolean(dialog),
      isMenu: Boolean(menu),
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80),
      selected:
        el.getAttribute('aria-selected') === 'true' ||
        Boolean(
          card &&
            (card.querySelector('.sr-only')?.textContent || '').includes('Selected'),
        ),
      rootAlive: (document.getElementById('root')?.childElementCount ?? 0) > 0,
    }
  }, { cardSel: CARD_SEL, gridSel: GRID_SEL })
}

/**
 * @param {import('playwright').Page} page
 */
export async function selectedCardCount(page) {
  return page.evaluate((cardSel) => {
    return [...document.querySelectorAll(cardSel)].filter(
      (c) =>
        c.getAttribute('aria-selected') === 'true' ||
        (c.querySelector('.sr-only')?.textContent || '').includes('Selected'),
    ).length
  }, CARD_SEL)
}

/**
 * @param {import('playwright').Page} page
 */
export async function isContextMenuOpen(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('button')].some((b) => {
      const t = (b.textContent || '').trim()
      if (!/Select|Deselect|Favorites|Copy prompt|Edit|Duplicate|Delete/i.test(t)) {
        return false
      }
      return Boolean(b.closest('.fixed') || b.closest('[role="menu"]'))
    })
  })
}

/**
 * @param {import('playwright').Page} page
 */
export async function isSourcePickerOpen(page) {
  return page.evaluate(() => {
    // Source picker items are portaled buttons (pack_*.csv stems), not the toolbar <select>.
    return [...document.querySelectorAll('.fixed button')].some((b) =>
      /pack_|_alpha|_beta|_gamma|\.csv/i.test((b.textContent || '').trim()),
    )
  })
}

/**
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    if (!(await isContextMenuOpen(page)) && !(await isSourcePickerOpen(page))) {
      return
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(40)
  }
  // Backdrop click fallback (ViewportFixedMenu).
  const backdrop = page.locator('.fixed.inset-0').first()
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 2, y: 2 }, timeout: 1_000 }).catch(() => {})
    await page.waitForTimeout(40)
  }
}

/**
 * Wait for App mount autofocus onto a grid card/cell.
 * @param {import('playwright').Page} page
 */
export async function waitForCardFocus(page) {
  for (let i = 0; i < 40; i += 1) {
    const snap = await focusSnapshot(page)
    if (snap.rootAlive && (snap.isCard || snap.role === 'gridcell')) return snap
    await page.waitForTimeout(50)
  }
  return focusSnapshot(page)
}

/**
 * Ensure a style **card** is focused (not a header gridcell).
 * Avoids toolbar `.focus()` — that currently stack-overflows.
 * @param {import('playwright').Page} page
 */
export async function ensureCardFocus(page) {
  let snap = await focusSnapshot(page)
  if (snap.rootAlive && snap.isCard) return snap
  await page.evaluate((cardSel) => {
    const el =
      document.querySelector(`${cardSel}[tabindex="0"]`) ||
      document.querySelector(`${cardSel}[role="gridcell"]`) ||
      document.querySelector(cardSel)
    if (el instanceof HTMLElement) el.focus()
  }, CARD_SEL)
  await page.waitForTimeout(30)
  snap = await focusSnapshot(page)
  if (snap.isCard) return snap
  // Arrow off headers onto a card.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(20)
    snap = await focusSnapshot(page)
    if (snap.isCard) return snap
  }
  return snap
}

/**
 * Tab from search toward the grid. Records crash if chrome focus loops.
 * @param {import('playwright').Page} page
 * @param {() => string[]} getErrors
 */
export async function tabUntilCard(page, getErrors) {
  const alive = await page.evaluate(
    () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
  )
  if (!alive) {
    return {
      ok: false,
      steps: 0,
      snap: await focusSnapshot(page),
      detail: 'root unmounted before Tab probe',
    }
  }

  // Search focus is safe; toolbar button .focus() currently stack-overflows.
  const search = page.locator('#root input').first()
  if (await search.count()) {
    await search.focus({ timeout: 5_000 })
  }

  for (let i = 0; i < MAX_TAB_STEPS; i += 1) {
    const errsBefore = getErrors().length
    await page.keyboard.press('Tab')
    await page.waitForTimeout(20)
    const errs = getErrors()
    if (errs.length > errsBefore) {
      return {
        ok: false,
        steps: i + 1,
        snap: await focusSnapshot(page),
        detail: `pageerror on Tab #${i + 1}: ${errs[errs.length - 1]}`,
      }
    }
    const snap = await focusSnapshot(page)
    if (!snap.rootAlive) {
      return {
        ok: false,
        steps: i + 1,
        snap,
        detail: `React root unmounted after Tab #${i + 1}`,
      }
    }
    if (snap.isCard || snap.role === 'gridcell') {
      return { ok: true, steps: i + 1, snap, detail: `focused card after ${i + 1} Tabs` }
    }
  }
  return {
    ok: false,
    steps: MAX_TAB_STEPS,
    snap: await focusSnapshot(page),
    detail: `no card/gridcell after ${MAX_TAB_STEPS} Tabs from search`,
  }
}

/**
 * @param {import('playwright').Page} page
 */
export async function scrollGridToTop(page) {
  await page.evaluate(() => {
    const grid = document.querySelector('[data-sg-item-count]')
    const scrollEl = grid?.parentElement
    if (scrollEl) scrollEl.scrollTop = 0
  })
  await page.waitForTimeout(80)
}

/**
 * Click the card context-menu Select action (not category "Select All").
 * @param {import('playwright').Page} page
 */
async function clickMenuSelect(page) {
  const item = page
    .locator('.fixed button')
    .filter({ hasText: /^(✓ Select|✕ Deselect)$/ })
    .first()
  if (await item.count()) {
    await item.click({ timeout: 5_000 })
    return
  }
  // Fallback: any fixed-portal Select that is not "Select All"
  await page
    .locator('.fixed button')
    .filter({ hasText: /^✓?\s*Select$/ })
    .first()
    .click({ timeout: 5_000 })
}

/**
 * Move to a card where Enter toggles selection (skip multi-source picker).
 * @param {import('playwright').Page} page
 */
async function focusSelectableCard(page) {
  await scrollGridToTop(page)
  await dismissOverlays(page)
  await ensureCardFocus(page)
  // Synthetic catalogs attach duplicate sources to early unique names first —
  // skip several pages so Enter toggles selection instead of opening the picker.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(30)
  }
  await dismissOverlays(page)
  let stuck = 0
  let prevLabel = ''
  for (let i = 0; i < 80; i += 1) {
    const snap = await focusSnapshot(page)
    if (!snap.isCard) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(20)
      continue
    }
    const before = await selectedCardCount(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(40)
    if (await isSourcePickerOpen(page)) {
      await dismissOverlays(page)
      await page.keyboard.press(i % 2 === 0 ? 'ArrowRight' : 'ArrowDown')
      await page.waitForTimeout(20)
      continue
    }
    if (await isContextMenuOpen(page)) {
      await dismissOverlays(page)
    }
    const after = await selectedCardCount(page)
    if (after !== before) {
      // Return to unselected for caller by pressing Enter again.
      await page.keyboard.press('Enter')
      await page.waitForTimeout(40)
      return true
    }
    await page.keyboard.press(i % 3 === 2 ? 'ArrowDown' : 'ArrowRight')
    await page.waitForTimeout(20)
    const now = (await focusSnapshot(page)).label
    if (now === prevLabel) {
      stuck += 1
      if (stuck >= 3) {
        await page.keyboard.press('ArrowDown')
        stuck = 0
      }
    } else {
      stuck = 0
      prevLabel = now
    }
  }
  return false
}

/**
 * @param {string} id
 * @param {() => Promise<{ ok: boolean, detail: string }>} fn
 * @returns {Promise<AssertionResult>}
 */
async function wrap(id, fn) {
  try {
    const r = await fn()
    return { id, ok: r.ok, detail: r.detail }
  } catch (err) {
    return {
      id,
      ok: false,
      detail: `exception: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {{
 *   scrollThreeScreens: (p: import('playwright').Page) => Promise<void>
 *   getErrors: () => string[]
 *   reopen: () => Promise<import('playwright').Page>
 *   getPage: () => import('playwright').Page
 * }} helpers
 * @returns {Promise<AssertionResult[]>}
 */
export async function runKeyAssertions(page, helpers) {
  /** @type {AssertionResult[]} */
  const results = []
  let active = page
  const { getErrors, reopen, getPage } = helpers

  const syncPage = () => {
    active = getPage()
    return active
  }

  const rootAlive = async () =>
    active.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)

  const ensureLive = async () => {
    syncPage()
    if (await rootAlive()) {
      await installCloseProbe(active)
      return active
    }
    active = await reopen()
    await installCloseProbe(active)
    await waitForCardFocus(active)
    return active
  }

  await installCloseProbe(active)
  await waitForCardFocus(active)

  // Non-destructive grid ops first (Tab into/out can crash the tree today).
  results.push(
    await wrap('arrow_nav', async () => {
      const p = await ensureLive()
      const start = await ensureCardFocus(p)
      if (!start.isCard && start.role !== 'gridcell') {
        return { ok: false, detail: 'precondition: no card focus' }
      }
      const before = await focusSnapshot(p)
      await p.keyboard.press('ArrowRight')
      const mid = await focusSnapshot(p)
      await p.keyboard.press('ArrowDown')
      const after = await focusSnapshot(p)
      if ([before, mid, after].some((s) => s.kind === 'body' || !s.rootAlive)) {
        return { ok: false, detail: 'arrow nav lost focus / crashed' }
      }
      const moved = mid.label !== before.label || after.label !== before.label
      if (!moved || !mid.inGrid || !after.inGrid) {
        return {
          ok: false,
          detail: `arrows did not move card focus ("${before.label}" → "${mid.label}" → "${after.label}")`,
        }
      }
      return {
        ok: true,
        detail: `ArrowRight/Down moved focus ("${before.label}" → "${after.label}")`,
      }
    }),
  )

  results.push(
    await wrap('enter_space_select', async () => {
      const p = await ensureLive()
      const found = await focusSelectableCard(p)
      if (!found) {
        return {
          ok: false,
          detail: 'could not find single-source card where Enter toggles selection',
        }
      }
      const before = await selectedCardCount(p)
      await p.keyboard.press('Enter')
      await p.waitForTimeout(40)
      const afterEnter = await selectedCardCount(p)
      await p.keyboard.press('Space')
      await p.waitForTimeout(40)
      const afterSpace = await selectedCardCount(p)
      if (afterEnter === before || afterSpace === afterEnter) {
        return {
          ok: false,
          detail: `Enter/Space did not toggle selection (${before}→${afterEnter}→${afterSpace})`,
        }
      }
      return {
        ok: true,
        detail: `Enter/Space toggled selection (${before}→${afterEnter}→${afterSpace})`,
      }
    }),
  )

  results.push(
    await wrap('home_end_ctrl_pagedown', async () => {
      const p = await ensureLive()
      await ensureCardFocus(p)
      const start = await focusSnapshot(p)
      await p.keyboard.press('End')
      const atEnd = await focusSnapshot(p)
      await p.keyboard.press('Home')
      const atHome = await focusSnapshot(p)
      await p.keyboard.press('Control+End')
      const atCtrlEnd = await focusSnapshot(p)
      await p.keyboard.press('Control+Home')
      const atCtrlHome = await focusSnapshot(p)
      await p.keyboard.press('PageDown')
      const atPgDn = await focusSnapshot(p)

      const snaps = [atEnd, atHome, atCtrlEnd, atCtrlHome, atPgDn]
      if (snaps.some((s) => s.kind === 'body' || !s.rootAlive)) {
        return { ok: false, detail: 'Home/End/Ctrl/PageDown lost focus to body/crash' }
      }
      const anyMove =
        atEnd.label !== start.label ||
        atHome.label !== atEnd.label ||
        atPgDn.label !== atHome.label ||
        atCtrlEnd.label !== atHome.label
      if (!anyMove || !snaps.every((s) => s.inGrid)) {
        return {
          ok: false,
          detail: `nav keys did not move within grid (end="${atEnd.label}" home="${atHome.label}" pgdn="${atPgDn.label}")`,
        }
      }
      return {
        ok: true,
        detail: `Home/End/Ctrl/PageDown kept grid focus (pgdn="${atPgDn.label}")`,
      }
    }),
  )

  results.push(
    await wrap('focus_survives_scroll3', async () => {
      const p = await ensureLive()
      const before = await ensureCardFocus(p)
      if (!before.isCard && before.role !== 'gridcell') {
        return { ok: false, detail: 'precondition: no card focus' }
      }
      await helpers.scrollThreeScreens(p)
      await p.waitForTimeout(100)
      const after = await focusSnapshot(p)
      if (!after.rootAlive) return { ok: false, detail: 'root dead after scroll' }
      if (after.kind === 'body') {
        return {
          ok: false,
          detail: `focus lost to body after 3-screen scroll (was "${before.label}")`,
        }
      }
      if (!after.isCard && !after.inGrid) {
        return {
          ok: false,
          detail: `focus left grid after scroll (kind=${after.kind} "${after.label}")`,
        }
      }
      return {
        ok: true,
        detail: `focus remained in grid after scroll3 ("${after.label}")`,
      }
    }),
  )

  results.push(
    await wrap('contextmenu_shift_f10_escape', async () => {
      const p = await ensureLive()
      await scrollGridToTop(p)
      await ensureCardFocus(p)
      const cardLabel = (await focusSnapshot(p)).label
      await clearCloseProbe(p)
      await p.keyboard.press('Shift+F10')
      await p.waitForTimeout(80)
      let open = await isContextMenuOpen(p)
      if (!open) {
        await p.keyboard.press('ContextMenu')
        await p.waitForTimeout(80)
        open = await isContextMenuOpen(p)
      }
      if (!open) {
        return {
          ok: false,
          detail: 'Shift+F10/ContextMenu did not open card context menu',
        }
      }
      await p.keyboard.press('Escape')
      await p.waitForTimeout(80)
      const stillOpen = await isContextMenuOpen(p)
      const closes = await closeCount(p)
      const after = await focusSnapshot(p)
      if (stillOpen) return { ok: false, detail: 'Escape did not dismiss context menu' }
      if (closes > 0) {
        return {
          ok: false,
          detail: `Escape on menu sent SG_CLOSE_REQUEST (${closes})`,
        }
      }
      if (!after.isCard && !after.inGrid) {
        return {
          ok: false,
          detail: `focus not restored to card (kind=${after.kind} "${after.label}", was "${cardLabel}")`,
        }
      }
      return {
        ok: true,
        detail: `menu via keyboard; Escape restored "${after.label}" without panel close`,
      }
    }),
  )

  results.push(
    await wrap('escape_layering', async () => {
      let p = await ensureLive()
      await scrollGridToTop(p)
      /** @type {string[]} */
      const parts = []

      await p.locator(CARD_SEL).first().click({ button: 'right', timeout: 10_000 })
      await p.waitForTimeout(80)
      if (!(await isContextMenuOpen(p))) {
        return { ok: false, detail: 'setup: right-click did not open context menu' }
      }
      await clearCloseProbe(p)
      await p.keyboard.press('Escape')
      await p.waitForTimeout(80)
      if ((await isContextMenuOpen(p)) || (await closeCount(p)) > 0) {
        return {
          ok: false,
          detail: `menu Escape: open=${await isContextMenuOpen(p)} closeMsg=${await closeCount(p)}`,
        }
      }
      parts.push('menu:ok')

      await ensureCardFocus(p)
      await p.keyboard.press('Shift+F10')
      await p.waitForTimeout(80)
      if (!(await isContextMenuOpen(p))) {
        return { ok: false, detail: 'setup: Shift+F10 menu missing before Save set' }
      }
      await clickMenuSelect(p)
      await p.waitForTimeout(80)
      const saveBtn = p.getByRole('button', { name: /Save set/i })
      if (!(await saveBtn.count())) {
        return { ok: false, detail: 'setup: Save set button missing after select' }
      }
      await saveBtn.click()
      await p.waitForSelector('[role="dialog"]', { timeout: 5_000 })
      await clearCloseProbe(p)
      await p.keyboard.press('Escape')
      await p.waitForTimeout(100)
      const dialogStill = await p.locator('[role="dialog"]').count()
      const dialogCloses = await closeCount(p)
      if (dialogStill > 0 || dialogCloses > 0) {
        return {
          ok: false,
          detail: `dialog Escape: dialogCount=${dialogStill} SG_CLOSE_REQUEST=${dialogCloses}`,
        }
      }
      parts.push('dialog:ok')

      // Isolate search/panel probes on a fresh page (dialog path can leave chrome unstable).
      p = await reopen()
      syncPage()
      await installCloseProbe(p)
      await waitForCardFocus(p)

      const searchBox = p.getByRole('combobox', { name: /Search styles/i })
      if (!(await searchBox.count())) {
        return { ok: false, detail: 'setup: search combobox missing after reopen' }
      }
      // No-suggestion query so Escape clears via App (not popover-only first press).
      await searchBox.click()
      await searchBox.pressSequentially('ZZZNOMATCH', { delay: 15 })
      await p.waitForTimeout(80)
      const filled = await p.evaluate(() => {
        const input = document.querySelector('input[aria-label="Search styles"]')
        return input instanceof HTMLInputElement ? input.value : ''
      })
      if (filled !== 'ZZZNOMATCH') {
        return {
          ok: false,
          detail: `setup: search type failed (dom="${filled}")`,
        }
      }

      await clearCloseProbe(p)
      await p.keyboard.press('Escape')
      await p.waitForTimeout(120)
      const afterSearch = await p.evaluate(() => {
        const input = document.querySelector('input[aria-label="Search styles"]')
        return {
          exists: input instanceof HTMLInputElement,
          value: input instanceof HTMLInputElement ? input.value : '__missing__',
          root: (document.getElementById('root')?.childElementCount ?? 0) > 0,
          expanded: input?.getAttribute('aria-expanded'),
        }
      })
      const searchCloses = await closeCount(p)
      if (
        !afterSearch.exists ||
        !afterSearch.root ||
        afterSearch.value !== '' ||
        searchCloses > 0
      ) {
        return {
          ok: false,
          detail: `search Escape: value="${afterSearch.value}" exists=${afterSearch.exists} root=${afterSearch.root} expanded=${afterSearch.expanded} SG_CLOSE_REQUEST=${searchCloses}`,
        }
      }
      parts.push('search:ok')

      await ensureCardFocus(p)
      await clearCloseProbe(p)
      await p.keyboard.press('Escape')
      await p.waitForTimeout(80)
      const panelCloses = await closeCount(p)
      if (panelCloses < 1) {
        return {
          ok: false,
          detail: `idle Escape: SG_CLOSE_REQUEST=${panelCloses}`,
        }
      }
      parts.push('panel:ok')
      return { ok: true, detail: parts.join(' · ') }
    }),
  )

  results.push(
    await wrap('dialog_trap_restore', async () => {
      const p = await ensureLive()
      await scrollGridToTop(p)
      await ensureCardFocus(p)
      await p.keyboard.press('Shift+F10')
      await p.waitForTimeout(80)
      if (!(await isContextMenuOpen(p))) {
        return { ok: false, detail: 'setup: Shift+F10 did not open menu' }
      }
      await clickMenuSelect(p)
      await p.waitForTimeout(80)
      const saveBtn = p.getByRole('button', { name: /Save set/i })
      if (!(await saveBtn.count())) {
        return { ok: false, detail: 'setup: Save set missing' }
      }
      await saveBtn.click()
      await p.waitForSelector('[role="dialog"]', { timeout: 5_000 })

      /** @type {string[]} */
      const escaped = []
      for (let i = 0; i < 12; i += 1) {
        await p.keyboard.press('Tab')
        const snap = await focusSnapshot(p)
        if (!snap.isDialog) escaped.push(`${snap.kind}/${snap.tag}`)
      }
      if (escaped.length) {
        return {
          ok: false,
          detail: `Tab escaped dialog trap (${escaped.slice(0, 4).join(', ')})`,
        }
      }

      await clearCloseProbe(p)
      await p.keyboard.press('Escape')
      await p.waitForTimeout(100)
      const dialogLeft = await p.locator('[role="dialog"]').count()
      const closes = await closeCount(p)
      const after = await focusSnapshot(p)
      if (dialogLeft > 0) return { ok: false, detail: 'Escape did not close dialog' }
      if (closes > 0) {
        return { ok: false, detail: `dialog Escape sent SG_CLOSE_REQUEST (${closes})` }
      }
      if (after.kind === 'body') {
        return { ok: false, detail: 'focus restored to body after dialog close' }
      }
      const restored = /Save set/i.test(after.label) || after.isCard || after.inGrid
      if (!restored) {
        return {
          ok: false,
          detail: `focus not restored (got ${after.kind} "${after.label}")`,
        }
      }
      return {
        ok: true,
        detail: `trap held 12 Tabs; Escape restored "${after.label}"`,
      }
    }),
  )

  // Destructive Tab probes last — reopen between them.
  results.push(
    await wrap('tab_into_grid', async () => {
      const p = await ensureLive()
      const r = await tabUntilCard(p, getErrors)
      return { ok: r.ok, detail: r.detail || (r.ok ? 'ok' : 'fail') }
    }),
  )

  results.push(
    await wrap('tab_out_of_grid', async () => {
      const p = await ensureLive()
      const start = await ensureCardFocus(p)
      if (!start.isCard && start.role !== 'gridcell') {
        return { ok: false, detail: 'precondition: no card focus' }
      }
      for (let i = 0; i < MAX_TAB_STEPS; i += 1) {
        const errsBefore = getErrors().length
        await p.keyboard.press('Tab')
        await p.waitForTimeout(20)
        if (getErrors().length > errsBefore) {
          return {
            ok: false,
            detail: `pageerror on Tab out #${i + 1}: ${getErrors().at(-1)}`,
          }
        }
        const snap = await focusSnapshot(p)
        if (!snap.rootAlive) {
          return { ok: false, detail: `root unmounted on Tab out #${i + 1}` }
        }
        if (snap.kind === 'body') {
          return { ok: false, detail: 'Tab from grid landed on body' }
        }
        if (!snap.inGrid && !snap.isCard) {
          return {
            ok: true,
            detail: `left grid after ${i + 1} Tabs → ${snap.tag} "${snap.label}"`,
          }
        }
      }
      return { ok: false, detail: `still inside grid after ${MAX_TAB_STEPS} Tabs` }
    }),
  )

  results.push(
    await wrap('no_body_focus', async () => {
      const p = await ensureLive()
      await ensureCardFocus(p)
      const keys = [
        'ArrowDown',
        'ArrowRight',
        'ArrowUp',
        'ArrowLeft',
        'Home',
        'End',
        'PageDown',
        'PageUp',
      ]
      for (const k of keys) {
        await p.keyboard.press(k)
        const snap = await focusSnapshot(p)
        if (!snap.rootAlive) return { ok: false, detail: `root dead after ${k}` }
        if (snap.kind === 'body') {
          return { ok: false, detail: `body focus after key ${k}` }
        }
      }
      await p.keyboard.press('Tab')
      const afterTab = await focusSnapshot(p)
      if (!afterTab.rootAlive) {
        return { ok: false, detail: 'root dead after Tab (chrome focus crash)' }
      }
      if (afterTab.kind === 'body') {
        return { ok: false, detail: 'body focus after Tab from card' }
      }
      return {
        ok: true,
        detail: `no body focus across ${keys.length} nav keys + Tab (final=${afterTab.kind})`,
      }
    }),
  )

  return results
}
