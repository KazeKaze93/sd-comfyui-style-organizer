/**
 * MENU-DIAG assertion: floating menu fully inside the iframe viewport
 * with MENU_MARGIN padding on every side.
 *
 * MENU_MARGIN mirrors app `MENU_VIEWPORT_PAD` in
 * `ui/src/lib/fitFixedMenuPosition.ts` (currently 8). Card menu / source
 * picker do not call that helper today — this assert is the bench contract
 * Wave 2 FIX-MENU must satisfy.
 */

/** @typedef {{ left: number, top: number, right: number, bottom: number, width?: number, height?: number }} DomRectLike */
/** @typedef {{ width: number, height: number }} ViewportLike */

/** Same value as `MENU_VIEWPORT_PAD` / Wave-2 `MENU_MARGIN`. */
export const MENU_MARGIN = 8

/**
 * @param {DomRectLike} menuRect
 * @param {ViewportLike} viewport
 * @param {number} [margin=MENU_MARGIN]
 */
export function checkMenuInsideViewport(menuRect, viewport, margin = MENU_MARGIN) {
  const overflow = {
    left: Math.max(0, margin - menuRect.left),
    top: Math.max(0, margin - menuRect.top),
    right: Math.max(0, menuRect.right - (viewport.width - margin)),
    bottom: Math.max(0, menuRect.bottom - (viewport.height - margin)),
  }
  const overflowPx =
    overflow.top + overflow.right + overflow.bottom + overflow.left
  return {
    ok: overflowPx === 0,
    margin,
    overflow,
    overflowPx,
  }
}

/**
 * @param {DomRectLike} menuRect
 * @param {ViewportLike} viewport
 * @param {number} [margin=MENU_MARGIN]
 * @param {string} [label]
 */
export function assertMenuInsideViewport(
  menuRect,
  viewport,
  margin = MENU_MARGIN,
  label = 'menu',
) {
  const result = checkMenuInsideViewport(menuRect, viewport, margin)
  if (result.ok) return result
  const parts = Object.entries(result.overflow)
    .filter(([, v]) => v > 0)
    .map(([side, v]) => `${side}=${v.toFixed(1)}px`)
  throw new Error(
    `${label} overflows viewport (margin=${margin}): ${parts.join(', ')} ` +
      `menu=[${menuRect.left.toFixed(1)},${menuRect.top.toFixed(1)}→` +
      `${menuRect.right.toFixed(1)},${menuRect.bottom.toFixed(1)}] ` +
      `viewport=${viewport.width}x${viewport.height}`,
  )
}
