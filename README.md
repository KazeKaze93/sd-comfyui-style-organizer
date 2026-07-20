# Style Grid for ComfyUI

Searchable, categorized visual card grid for browsing and applying prompt styles in ComfyUI. A ComfyUI node port of the [WebUI extension](https://github.com/KazeKaze93/sd-webui-style-organizer) with the same idea: search, favorites, presets, and a visual grid instead of a flat dropdown.

## Features

- Search and category filtering across your style packs
- Multi-select with conflict detection
- Favorites and recently used
- Presets: save and load groups of styles at once
- Create, edit, duplicate, and delete styles from the grid
- Move styles between categories
- Thumbnail previews with manual upload
- Import and export your styles and presets, with automatic backup
- Wildcard support: `{sg:category}` resolves to a random style from that category at generation time
- Works with multiple CSV sources at once, or filtered to one

## Installation

Clone into your `custom_nodes` folder:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/KazeKaze93/sd-comfyui-style-organizer
```

Restart ComfyUI. The Style Grid node will be available under the node search.

(Once published to the ComfyUI Registry, this section will be updated with a Manager install option.)

## Usage

Add the **Style Grid** node to your workflow. It outputs two STRING values, positive and negative, meant to feed directly into your text encode nodes. Click **Browse Styles** to open the grid, search or browse by category, and apply styles to the node's text fields directly.

## Style packs

Style Grid ships with one small sample pack (`styles_sfw.csv`) so the grid isn't empty on first install. Full style packs are distributed separately on [CivitAI](https://civitai.com/models/2409619/sfw-prompt-pack). Drop CSV files into the node's `data/` folder to add more.

## BREAK and prompt chunking

Style Grid does not insert or manage `BREAK` tokens itself. If your styles or prompts use `BREAK`, ComfyUI's built-in CLIP Text Encode node treats it as a literal word rather than a chunk separator. Use a BREAK-aware text encoder such as [CLIPTextEncodeBREAK](https://github.com/pamparamm/ComfyUI-ppm) if you rely on BREAK in your prompts.

## Generated files and cleanup

Style Grid writes runtime data under `data/` inside the extension
folder:

| Path | What it is | Safe to delete? |
|------|-----------|------------------|
| `data/*.csv` | Your own style packs (created via New style, or Duplicate/Move/Edit on non-protected styles) | Only if you don't need them — this is your data |
| `data/imports/*.csv` | Style packs created by the Import feature | Yes, anytime |
| `data/backups/` | CSV backup snapshots (created by the Backup button) | Yes, oldest are auto-pruned past 20 |
| `data/presets.json` | Saved presets | Only if you don't need them |
| `data/usage.json` | Local usage counters (which styles you click most) | Yes, purely informational |
| `data/thumbnails/` | Uploaded/generated preview images | Yes, previews just won't show until re-uploaded |

`samples/styles_sfw.csv` (the bundled demo pack) is read-only by
design — Edit, Move, and Delete are blocked on styles from this file.
Use Duplicate to create an editable copy in `data/` first.

## License

AGPL-3.0. See [LICENSE](LICENSE).
