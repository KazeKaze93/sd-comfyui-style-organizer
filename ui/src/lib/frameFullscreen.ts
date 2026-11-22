/**
 * Fullscreen by resizing the iframe's own host wrapper (PLATFORM.fullscreenMode
 * 'frame-element'; ComfyUI). The panel overlay in web/js/style_grid.js is the
 * iframe's parent element; same-origin, so the iframe may restyle it.
 *
 * The windowed geometry is remembered in localStorage (WINDOWED_SIZE_KEY) when
 * entering fullscreen and restored when leaving it.
 */

export const WINDOWED_SIZE_KEY = 'sg_windowed_size'

type SavedGeometry = { top?: string; right?: string; width?: string; height?: string }

function hostWrapper(): HTMLElement | null {
  const frame = window.frameElement as HTMLElement | null
  return (frame?.parentElement as HTMLElement | null) ?? null
}

/**
 * Enter (`fullscreen` true) or leave fullscreen. Returns the new state, or null
 * when there is no host wrapper (not embedded): nothing changed.
 */
export function setFrameFullscreen(fullscreen: boolean): boolean | null {
  const wrapper = hostWrapper()
  if (!wrapper) return null

  if (!fullscreen) {
    let saved: SavedGeometry = {}
    try {
      const raw = localStorage.getItem(WINDOWED_SIZE_KEY)
      if (raw) saved = JSON.parse(raw) as SavedGeometry
    } catch {
      /* malformed or unavailable storage: defaults below */
    }
    wrapper.style.top = saved.top || '80px'
    wrapper.style.right = saved.right || '16px'
    wrapper.style.left = 'auto'
    wrapper.style.transform = 'none'
    wrapper.style.width = saved.width || '1000px'
    wrapper.style.height = saved.height || '650px'
    wrapper.style.minWidth = '600px'
    wrapper.style.minHeight = '400px'
    wrapper.style.maxWidth = '95vw'
    wrapper.style.maxHeight = '90vh'
    wrapper.style.borderRadius = '12px'
    wrapper.style.boxShadow = '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
    wrapper.style.resize = 'both'
    return false
  }

  try {
    localStorage.setItem(
      WINDOWED_SIZE_KEY,
      JSON.stringify({
        top: wrapper.style.top,
        right: wrapper.style.right,
        width: wrapper.style.width,
        height: wrapper.style.height,
      }),
    )
  } catch {
    /* storage unavailable: leaving fullscreen falls back to the defaults */
  }
  wrapper.style.top = '0'
  wrapper.style.right = 'auto'
  wrapper.style.left = '0'
  wrapper.style.transform = 'none'
  wrapper.style.width = '100vw'
  wrapper.style.height = '100vh'
  wrapper.style.minWidth = ''
  wrapper.style.minHeight = ''
  wrapper.style.maxWidth = ''
  wrapper.style.maxHeight = ''
  wrapper.style.borderRadius = '0'
  wrapper.style.boxShadow = 'none'
  wrapper.style.resize = 'none'
  return true
}
