# Screenshots for `README.md`

The pictures are taken from the real panel, built from `ui/`, on a local test
page. The style library is a neutral demo set (photography and art terms),
previews are placeholder gradients, and the ComfyUI canvas around the node is
a hand-drawn stand-in: only the panel and the chip row on the node are the
real code. Dark theme, device scale 1.

## Regenerate

```powershell
cd ui
node bench/screenshots/capture.mjs
```

The script builds the bench preview, serves it, answers every `/style_grid/*`
request from `ui/bench/screenshots/dataset.mjs`, and writes the PNGs here.
`--only name1,name2` retakes some shots; `--no-build` reuses the last build.
The script, the dataset and the two mock host pages are the same files in the
WebUI repo (`sd-webui-style-organizer`); the platform is the repo they run in.

Keep the file names: `README.md` links them.

| File | What it shows |
|------|---------------|
| `grid-overview.png` | The panel open over the canvas, styles selected, a wildcard chip |
| `wildcards.png` | Sidebar category menu (Random, Shuffle, Pick styles…), wildcard chips and the deck strip |
| `node-wiring.png` | The Style Grid node wired to two CLIP Text Encode nodes |
| `node-chips.png` | Chips on the node for applied styles and wildcards |
| `style-card-context-menu.png` | Right-click menu of a style card |
| `edit-dialog.png` | Edit style dialog with Works with chips |
| `move-category-dialog.png` | Move to category dialog |
| `read-only-samples.png` | Menu of a style from the read-only `samples/demo.csv` |
| `presets.png` | Presets view (cards, a missing style, a wildcard) |
| `import-export-menu.png` | ⋯ More menu |
| `search-autocomplete.png` | Search with suggestions |
| `tile-expand.png` | A long name shown whole on hover |
| `gallery-view.png` | Gallery view with previews |
| `fullscreen-mode.png` | The panel in fullscreen |
