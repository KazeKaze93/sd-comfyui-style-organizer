# Changelog

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
