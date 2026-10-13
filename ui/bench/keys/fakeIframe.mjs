/**
 * Keys-bench fake iframe (Comfy).
 *
 * Shared `benchHost.installFakeIframe` nests `#root` under the fake
 * `frameElement`. That makes Floating UI `getOverflowAncestors` walk
 * `root → … → frameElement → … → root` and stack-overflow on Tab.
 *
 * WebUI keys use a real `<iframe>` so `frameElement` lives in the *parent*
 * document and is never an ancestor of `#root`. Mirror that invariant here:
 * `frameElement` is a sibling marker under the wrapper; `#root` is NOT inside it.
 */

/**
 * Install / repair fake iframe so App.toggleFullscreen still sees
 * `window.frameElement.parentElement`, without nesting React under frameElement.
 *
 * @param {import('playwright').Page} page
 */
export async function installSafeFakeIframe(page) {
  const result = await page.evaluate(() => {
    const root = document.getElementById('root')
    let host = document.getElementById('sg-fake-frame-host')
    let frame = document.getElementById('sg-fake-frame')

    if (!host) {
      host = document.createElement('div')
      host.id = 'sg-fake-frame-host'
      Object.assign(host.style, {
        position: 'fixed',
        inset: '0',
        display: 'flex',
        flexDirection: 'column',
      })
      document.body.prepend(host)
    }

    if (!frame) {
      frame = document.createElement('div')
      frame.id = 'sg-fake-frame'
      host.insertBefore(frame, host.firstChild)
    }

    // Marker only — must not participate in layout or contain #root.
    Object.assign(frame.style, {
      position: 'absolute',
      width: '0',
      height: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      flex: '0 0 0',
    })

    if (root) {
      // Move #root out of frameElement if the shared helper nested it.
      if (frame.contains(root)) {
        host.appendChild(root)
      } else if (root.parentElement !== host) {
        host.appendChild(root)
      }
      Object.assign(root.style, {
        flex: '1',
        minHeight: '0',
        minWidth: '0',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      })
    }

    Object.defineProperty(window, 'frameElement', {
      configurable: true,
      get: () => frame,
    })

    const fe = window.frameElement
    const nested = Boolean(root && fe && fe.contains(root))
    return {
      ok: !nested && fe != null && fe.parentElement === host,
      nested,
      hostId: host.id,
      frameId: frame.id,
      rootParent: root?.parentElement?.id || null,
    }
  })

  if (!result.ok) {
    throw new Error(
      `installSafeFakeIframe failed: nested=${result.nested} rootParent=${result.rootParent}`,
    )
  }
  return result
}
