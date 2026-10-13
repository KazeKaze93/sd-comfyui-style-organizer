/**
 * Stub all /style_grid/** so the grid runs without ComfyUI backend.
 * @param {import('playwright').Page} page
 * @param {{ usage?: Record<string, { count: number }> }} [opts]
 */
export async function stubStyleGridApi(page, opts = {}) {
  const usageBody = opts.usage ?? {}
  await page.route('**/style_grid/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/\/+$/, '')
    const method = req.method().toUpperCase()

    /** @type {{ status?: number, body: unknown }} */
    let res = { body: {} }

    if (path.endsWith('/style_grid/usage') && method === 'GET') {
      res = { body: usageBody }
    } else if (path.endsWith('/style_grid/usage/increment') && method === 'POST') {
      res = { body: { ok: true } }
    } else if (path.endsWith('/style_grid/thumbnails/list') && method === 'GET') {
      res = { body: { has_thumbnail: [] } }
    } else if (path.endsWith('/style_grid/category_order') && method === 'GET') {
      res = { body: [] }
    } else if (path.endsWith('/style_grid/category_order') && method === 'POST') {
      res = { body: { ok: true } }
    } else if (path.endsWith('/style_grid/presets/list') && method === 'GET') {
      res = { body: {} }
    } else if (path.includes('/style_grid/presets/') && method === 'POST') {
      res = { body: { ok: true } }
    } else if (path.endsWith('/style_grid/styles') && method === 'GET') {
      res = { body: { categories: {} } }
    } else if (path.endsWith('/style_grid/backup') && method === 'POST') {
      res = { body: { ok: true, empty: true } }
    } else if (path.endsWith('/style_grid/export') && method === 'GET') {
      res = {
        status: 200,
        body: '',
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: Buffer.alloc(0),
      })
      return
    } else if (path.endsWith('/style_grid/import') && method === 'POST') {
      res = { body: { ok: true } }
    } else if (path.includes('/style_grid/thumbnail')) {
      await route.fulfill({ status: 404, body: 'not found' })
      return
    } else {
      res = { body: { ok: true } }
    }

    await route.fulfill({
      status: res.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(res.body),
    })
  })
}
