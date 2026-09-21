# Changelog

## Unreleased

### Fixed
- **Thumbnail identity:** previews and `has_thumbnail` / `SG_THUMB_DONE` matching use **`(source file, name)`**. Legacy name-only files migrate when unique across packs; ambiguous duplicates need regeneration. Thumbnail GET/upload/delete require `source`.

## 0.0.6 — 2026-09-17

### Fixed
- Search: the autocomplete dropdown and the main grid now use the same matching logic — previously the dropdown matched style names only while the grid also matched descriptions, so a query could return cards in the grid but "no styles found" in the dropdown right above it
- StyleCard re-render cost: every mounted card was subscribed to the whole selection state, so clicking one card re-rendered every card on screen; each card now tracks only its own selection, favorite, and usage-count state
- Presets: a set applied via a preset never showed up in the sidebar's Recent list, unlike manually clicking a style
- Presets: the Save set dialog could suggest the name of a preset that was no longer actually active, since the field tracking it was never reset by ordinary manual clicks; it now checks the current selection directly against every saved preset
- Presets: a preset created straight from a manual selection didn't respond to Unapply — saving now formally claims ownership of those styles instead of leaving them tagged only as manually selected
- Presets: saving could silently overwrite an existing preset under the same name with no warning; saving now requires explicit confirmation when the name already exists
- A duplicate hex value in the category color palette meant two categories could render in the same color
- The chip row at the bottom of the panel sat flush against the edge with no padding when no wildcards were active

### Added
- Presets: a full rewrite of save and load. Save set opens a dialog with the name pre-filled from the current selection, an optional note, and an inline warning (not a browser confirm) if the name already exists. The library renders as a list of rows showing full composition, missing members, and their source pack without loading the preset first
- Presets: Apply and Unapply. Clicking Apply merges a preset into the current selection; clicking it again removes exactly that preset's own contribution, leaving alone anything a still-active preset or a manual click also wants there. Multiple presets can be active at once, each shown independently
- Presets: the saved format now includes wildcards, an optional note, and creation/last-used timestamps, not just a bare list of style names
- Toolbar: icons replaced the emoji set, grouped by action with dividers and color coding, and given accessible labels
- Sidebar: Favorites and Recent now always show, muted when empty, instead of disappearing until first used
- Fullscreen: window size and position are remembered across toggling fullscreen and across page reloads, instead of resetting to a fixed size every time

### Removed
- Random Style — the wildcard system already covers randomization at generation time, and the button picked from the entire library regardless of the active filter, which was more confusing than useful
- The old preset toolbar button, its confirm-dialog save flow, and the alternate preset-mode rendering on style cards — replaced by the rewrite above

### Changed
- StyleInfoBar and SelectedBar merged into one panel with a single height animation, instead of two independent ones that could jostle the grid above out of sync with each other

## 0.0.5 — 2026-09-13

### Fixed
- Clear all: the toolbar button now actually clears. It previously fanned out per-style unapply messages and left wildcard tokens and stale per-node bookkeeping behind; it now uses the host's complete clear path and resets the panel selection in one step
- Slice selection mode listed no styles when it was opened for a category other than the one selected in the sidebar
- Prompt text is now split on top-level commas only, treating braces as well as parentheses as grouping. Slice tokens contain commas inside their spec, so the previous splitting shredded them; this also stops weighted groups such as `(smiling, happy:1.2)` from being broken apart during apply, unapply and reorder
- Package size: stale hashed bundles are no longer accumulated in the published package — roughly 28 MB of dead build output removed, and builds now replace the output directory instead of piling onto it

### Added
- Wildcard slices: a `{sg:<category>:<spec>}` token form that randomizes over a chosen subset of a category instead of the whole thing. Spec entries are style-name suffixes with the category prefix omitted; `-` excludes, a trailing `*` is a prefix glob, and the two combine. Includes are unioned first, then excludes subtract. A spec whose names have all been removed from the CSV falls back to the full category rather than vanishing from the prompt
- Slice selection UI: the category context menu gains an entry that puts the grid into a checkbox selection mode with Select all / Clear all / Add as wildcard / Cancel. Search and the source filter stay active inside the mode, and Select all covers only what the current filter shows. The inserted token is compacted to the shortest correct form, so selecting almost an entire category writes a short exclude token rather than a long list
- Wildcard chips can be dragged to reorder, and a slice chip shows how many styles it can resolve to, with their names in the tooltip
- Test suite and CI: pytest coverage for the resolver, vitest coverage for the slice compactor, a shared fixture pinning the Python and TypeScript implementations of the slice grammar to each other, and a GitHub Actions workflow running both suites plus typechecks and lint on every push and pull request

## 0.0.4 — 2026-09-12

### Fixed
- Wrap-style templates: prompts wrapping `{prompt}` more than once now have every occurrence replaced, not just the first
- Thumbnails: styles with the same name across different packs no longer overwrite each other's cached preview version
- Style delete: the thumbnail file is now removed along with the style row instead of being left orphaned on disk
- Bundled demo pack: sample style names are now namespaced (`Demo` marker after the category prefix) so they no longer collide with real distributed packs sharing the same category taxonomy

### Added
- Click-outside-to-close: clicking outside the Style Grid panel closes it again, via a dedicated backdrop (replaces the old approach that stopped working reliably)

## 0.0.3 — 2026-08-11

### Fixed
- Wildcard source scoping: `{sg:category}` now correctly respects the selected CSV pack instead of silently falling back to the entire library
- Wildcard resolution: empty-prompt styles no longer leave literal `{sg:...}` tokens in the generated text; nested wildcards now resolve instead of surviving as raw tokens
- Style apply/unapply: fixed several cases where Clear All, rehydrate, or nested `{prompt}`-wrap styles could leave stale or incorrect tags in the node text
- Conflict detection: replaced substring matching with exact tag comparison to eliminate false-positive conflict warnings
- Usage counters: corrupted `usage.json` no longer wipes all history on the next click; writes are now atomic
- Category order: persisting a custom sidebar order now actually reaches the server (was silently failing before)
- Source filter: the selected CSV pack now consistently drives search, wildcards, and card display
- Style CRUD: editing, duplicating, or deleting styles now correctly targets the right pack when duplicate names exist across CSVs; `data/imports/` styles are now properly editable
- Thumbnails: unified the upload/list/cleanup hash scheme so previews no longer silently disappear or get wiped by cleanup
- Backup: snapshots are now a single zip (no more orphaned folders), packs with the same filename no longer overwrite each other, and Backup zips can now be restored via Import
- Import: malformed or empty import payloads now fail with a clear message instead of silently reporting success

### Added
- Delete preview option in the style card menu
- Clear Favorites / Clear Recent actions in the sidebar
- Backup zip restore support through the Import flow

### Changed
- Random style, Select All, and Presets now respect the active search/source filters instead of pulling from the full unfiltered library
- README clarified: Backup and Import/Export are documented as separate features with accurate scope

## 0.0.2 — 2026-07-21

Initial documented release on the Registry. See Registry version history for details.

## 0.0.1 — 2026-07-20

First publish.
