### Fixed
- Search: the autocomplete dropdown and the main grid now use the same matching logic — previously the dropdown matched style names only while the grid also matched descriptions, so a query could return cards in the grid but "no styles found" in the dropdown right above it
- StyleCard re-render cost: every mounted card was subscribed to the whole selection state, so clicking one card re-rendered every card on screen; each card now tracks only its own selection, favorite, and usage-count state
- Presets: a set applied via a preset never showed up in the sidebar's Recent list, unlike manually clicking a style
- Presets: the Save set dialog could suggest the name of a preset that was no longer actually active; it now checks the current selection directly against every saved preset
- Presets: a preset created straight from a manual selection didn't respond to Unapply — saving now formally claims ownership of those styles
- Presets: saving could silently overwrite an existing preset under the same name; saving now requires explicit confirmation
- A duplicate hex value in the category color palette meant two categories could render in the same color
- The chip row at the bottom of the panel sat flush against the edge with no padding when no wildcards were active

### Added
- Presets: a full rewrite of save and load. Save set opens a dialog with the name pre-filled from the current selection, an optional note, and an inline warning if the name already exists. The library renders as a list of rows showing full composition, missing members, and their source pack without loading the preset first
- Presets: Apply and Unapply. Clicking Apply merges a preset into the current selection; clicking it again removes exactly that preset's own contribution. Multiple presets can be active at once
- Presets: the saved format now includes wildcards, an optional note, and creation/last-used timestamps
- Toolbar: icons replaced the emoji set, grouped by action with dividers and color coding, with accessible labels
- Sidebar: Favorites and Recent now always show, muted when empty
- Fullscreen: window size and position are remembered across toggling and across page reloads

### Removed
- Random Style — the wildcard system already covers randomization at generation time
- The old preset toolbar button, its confirm-dialog save flow, and the alternate preset-mode rendering on style cards

### Changed
- StyleInfoBar and SelectedBar merged into one panel with a single height animation
