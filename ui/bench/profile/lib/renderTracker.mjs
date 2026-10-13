/**
 * Init-script: React DevTools-lite hook counting PerformedWork for an
 * allowlisted set of app components (keeps walk cheap so it stays out of
 * CDP top frames). Also tracks card class mutations for selection accent.
 */

/** @returns {string} injected into page as addInitScript */
export function renderTrackerSource() {
  return `(() => {
  const PERFORMED_WORK = 1;
  const ALLOW = new Set([
    'App', 'StyleGrid', 'StyleCard', 'ThumbnailPreview', 'Sidebar',
    'SearchBar', 'SelectedBar', 'StyleInfoPanel', 'CategoryTitle',
    'CategoryName', 'ConfirmDialog', 'ConfirmInputDialog', 'EditStyleDialog',
    'PresetList', 'PresetRow', 'SourceFilter', 'BottomPanel', 'Toast',
    'AnimatePresence', 'motion.div', 'MeasureLayout',
  ]);
  const stats = {
    commits: 0,
    byName: Object.create(null),
    lastCommit: null,
    cardClassMutations: 0,
    reset() {
      this.commits = 0;
      this.byName = Object.create(null);
      this.lastCommit = null;
      this.cardClassMutations = 0;
    },
    snapshot() {
      const entries = Object.entries(this.byName)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      return {
        commits: this.commits,
        byName: entries,
        lastCommit: this.lastCommit,
        cardClassMutations: this.cardClassMutations,
      };
    },
  };
  window.__sgRenderStats = stats;

  function displayName(fiber) {
    const t = fiber.type;
    if (t == null) return null;
    if (typeof t === 'string') return null;
    if (typeof t === 'function') return t.displayName || t.name || null;
    if (typeof t === 'object') {
      if (t.displayName) return t.displayName;
      if (typeof t.render === 'function') {
        return t.render.displayName || t.render.name || 'ForwardRef';
      }
      if (t.type) return displayName({ type: t.type });
    }
    return null;
  }

  function walk(fiber, counts) {
    let node = fiber;
    while (node) {
      if ((node.flags & PERFORMED_WORK) !== 0) {
        const name = displayName(node);
        if (name && ALLOW.has(name)) counts[name] = (counts[name] || 0) + 1;
      }
      if (node.child) walk(node.child, counts);
      node = node.sibling;
    }
  }

  const hook = {
    supportsFiber: true,
    renderers: new Map(),
    _rid: 0,
    inject(renderer) {
      const id = ++this._rid;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(id, root) {
      try {
        const counts = Object.create(null);
        const fiber = root.current;
        if (fiber) walk(fiber, counts);
        stats.commits += 1;
        for (const [name, c] of Object.entries(counts)) {
          stats.byName[name] = (stats.byName[name] || 0) + c;
        }
        stats.lastCommit = {
          at: performance.now(),
          byName: Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
        };
      } catch (_) { /* ignore */ }
    },
    onCommitFiberUnmount() {},
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  const bootObserver = () => {
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.attributeName === 'class') {
          const el = r.target;
          if (
            el &&
            el.classList &&
            el.classList.contains('cursor-pointer') &&
            el.classList.contains('rounded-lg')
          ) {
            stats.cardClassMutations += 1;
          }
        }
      }
    });
    obs.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  };
  if (document.documentElement) bootObserver();
  else document.addEventListener('DOMContentLoaded', bootObserver);
})();`
}
