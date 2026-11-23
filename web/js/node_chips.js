/**
 * Style Grid (ComfyUI) — the applied-style chip row on the node: a pure model
 * built from the node's ledger and prompt text, and a vanilla DOM row that
 * renders it. No ComfyUI imports and no side effects at import time (ComfyUI
 * loads every .js under web/js); the row's <style> is injected on the first
 * createChipRow call, once per document.
 */
import { activeWildcardCategories, styleIsPresent } from "./prompt_text.js";

const KEY_SEP = "\0";
const WILDCARD_KIND_DECK = "sgd";
const MAX_ROWS = 2;
const STYLE_ELEMENT_ID = "sg-node-chips-style";
const MISSING_TITLE = "No longer in the library";
/** Same text as the panel's SHUFFLE_CHIP_TITLE (ui/src/lib/wildcardLabels.ts, ComfyUI platform). */
const SHUFFLE_CHIP_TITLE = "Shuffle: each style is used once before any repeats (one step per queue run)";
const DICE_MARKER = "\u{1F3B2}";

/** Same rule as ui/src/lib/trayDisplayName.ts: the style name without its category prefix. */
export function chipDisplayName(name) {
    return name.includes("_") ? name.split("_").slice(1).join(" ") : name;
}

/** Same format as the iframe's styleRowKey and the host ledger key. */
export function chipStyleKey(name, sourceFile) {
    return `${sourceFile || ""}${KEY_SEP}${name}`;
}

function sourceBasename(p) {
    const s = String(p || "").replace(/\\/g, "/");
    const i = s.lastIndexOf("/");
    return i < 0 ? s : s.slice(i + 1);
}

/**
 * What the node's chip row shows. Never mutates its input; (source_file, name)
 * is the identity, entries are never merged by name.
 *
 * @param {{
 *   ledgerEntries: Array<{name: string, source_file: string, prompt: string, negative_prompt: string}>,
 *   text: string,
 *   negativeText: string,
 *   catalogKeys?: Set<string> | null,
 * }} input
 */
export function nodeChipModel({ ledgerEntries, text, negativeText, catalogKeys }) {
    const pos = text || "";
    const neg = negativeText || "";
    const styles = (ledgerEntries || [])
        .filter((entry) => styleIsPresent(pos, neg, entry))
        .map((entry) => {
            const key = chipStyleKey(entry.name, entry.source_file);
            return {
                key,
                name: entry.name,
                source_file: entry.source_file || "",
                label: chipDisplayName(entry.name),
                title: `${entry.name} — ${sourceBasename(entry.source_file)}`,
                missing: catalogKeys ? !catalogKeys.has(key) : false,
            };
        });
    const wildcards = activeWildcardCategories(pos, neg).map((w) => ({
        key: [w.category, String(w.spec || "").toLowerCase(), w.kind].join(KEY_SEP),
        category: w.category,
        spec: w.spec,
        kind: w.kind,
        label: w.spec ? `${w.category} (slice)` : w.category,
    }));
    const signature = JSON.stringify([
        styles.map((s) => [s.key, s.label, s.title, s.missing ? 1 : 0]),
        wildcards.map((w) => [w.key, w.label]),
    ]);
    return { styles, wildcards, signature };
}

const CSS = `
.sg-chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px;box-sizing:border-box;width:100%;padding:2px 0;font-family:inherit;font-size:11px;line-height:1}
.sg-chip,.sg-chip-more{display:inline-flex;align-items:stretch;box-sizing:border-box;height:20px;max-width:100%;border:1px solid var(--border-color,#4b5563);border-radius:10px;background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);overflow:hidden}
.sg-chip--wildcard{background:rgba(168,85,247,.2);border-color:rgba(168,85,247,.45)}
.sg-chips button{appearance:none;margin:0;border:0;background:none;color:inherit;font:inherit;line-height:1;cursor:pointer}
.sg-chip-body{display:inline-flex;align-items:center;gap:3px;min-width:0;max-width:160px;padding:0 2px 0 7px}
.sg-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg-chip--missing .sg-chip-label{text-decoration:line-through;opacity:.55}
.sg-chip-x{padding:0 6px 0 4px;opacity:.65}
.sg-chip-x:hover{opacity:1}
.sg-chip-more{padding:0 7px;align-items:center}
.sg-chip-icon{width:12px;height:12px;flex-shrink:0}
.sg-chips button:focus-visible{outline:2px solid var(--p-primary-color,#60a5fa);outline-offset:-2px;border-radius:10px}
.sg-chip:hover,.sg-chip-more:hover{filter:brightness(1.15)}
.sg-chips [hidden]{display:none!important}
.sg-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

/** Row geometry, matching the CSS below: 20px chips, 4px gap, 2px top and bottom padding. */
export const CHIP_HEIGHT = 20;
export const CHIP_ROW_GAP = 4;
export const CHIP_ROW_PADDING = 2;

/**
 * Height of the chip widget for a row count (0 → 0), including the DOM
 * widget's margin above and below.
 *
 * @param {number} rows
 * @param {number} margin the DOM widget's margin
 */
export function chipRowsHeight(rows, margin) {
    if (!rows) return 0;
    return rows * CHIP_HEIGHT + (rows - 1) * CHIP_ROW_GAP + 2 * CHIP_ROW_PADDING + 2 * margin;
}

/**
 * The node height after the chip row changed from prevRowsHeight to
 * newRowsHeight: null when it did not change (no setSize); otherwise the
 * current height moved by the difference, never below the node's minimum.
 * Extra height the user added by resizing stays.
 *
 * fit: the row was rebuilt from a loaded workflow or a fresh catalog, not by
 * an edit, so the saved size may already hold it. Only grow to the minimum;
 * never move by the difference (a reload must not grow the node again).
 *
 * @param {{currentHeight: number, minHeight: number, prevRowsHeight: number, newRowsHeight: number, fit?: boolean}} input
 * @returns {number|null}
 */
export function nextNodeHeight({ currentHeight, minHeight, prevRowsHeight, newRowsHeight, fit }) {
    if (fit) return currentHeight < minHeight ? minHeight : null;
    if (prevRowsHeight === newRowsHeight) return null;
    const delta = newRowsHeight - prevRowsHeight;
    return delta > 0
        ? Math.max(currentHeight + delta, minHeight)
        : Math.max(currentHeight - Math.abs(delta), minHeight);
}

function injectStyles(doc) {
    if (doc.getElementById(STYLE_ELEMENT_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
}

let deckIconSeq = 0;

/** The panel's DeckIcon (ui/src/components/DeckIcon.tsx) as static SVG markup. */
function deckIconMarkup() {
    deckIconSeq += 1;
    const back = `sg-node-deck-back-${deckIconSeq}`;
    const mid = `sg-node-deck-mid-${deckIconSeq}`;
    const card = 'x="7" y="5" width="10" height="14" rx="2"';
    const cut = 'fill="black" stroke="black" stroke-width="3.6"';
    const full = '<rect width="24" height="24" fill="white" stroke="none"/>';
    const mask = (id, body) =>
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">${full}${body}</mask>`;
    return (
        '<svg class="sg-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
        + ' stroke-linejoin="round" aria-hidden="true" focusable="false"><defs>'
        + mask(back, `<rect ${card} ${cut}/><rect ${card} transform="rotate(20 12 20)" ${cut}/>`)
        + mask(mid, `<rect ${card} transform="rotate(20 12 20)" ${cut}/>`)
        + `</defs><g mask="url(#${back})"><rect ${card} transform="rotate(-20 12 20)"/></g>`
        + `<g mask="url(#${mid})"><rect ${card}/></g>`
        + `<rect ${card} transform="rotate(20 12 20)"/></svg>`
    );
}

/** Row index (0-based) of each element, from its offsetTop. */
function measureByOffsetTop(elements) {
    const tops = [...new Set(elements.map((e) => e.offsetTop))].sort((a, b) => a - b);
    return elements.map((e) => tops.indexOf(e.offsetTop));
}

function isRemoveKey(e) {
    return e.key === "Delete" || e.key === "Backspace";
}

/**
 * The chip row element. render(model) rebuilds it; the callbacks get the
 * chip's identity, never an index.
 *
 * @param {{
 *   doc: Document,
 *   onOpen: function(): void,
 *   onRemoveStyle: function({source_file: string, name: string}): void,
 *   onRemoveWildcard: function({category: string, spec: string, kind: string}): void,
 *   measureRows?: function(HTMLElement[]): number[],
 * }} opts
 */
export function createChipRow({ doc, onOpen, onRemoveStyle, onRemoveWildcard, measureRows }) {
    injectStyles(doc);
    const measure = measureRows || measureByOffsetTop;
    const el = doc.createElement("div");
    el.className = "sg-chips";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Applied styles");

    /** "keyboard" | "pointer": what moved focus last. */
    let modality = "pointer";
    let focusFromKeyboard = false;
    /** chip element → remove action */
    const removers = new WeakMap();

    const onDocKeydown = () => { modality = "keyboard"; };
    const onDocPointerdown = () => { modality = "pointer"; };
    const onPointerdown = (e) => {
        modality = "pointer";
        e.stopPropagation();
    };
    const onFocus = () => { focusFromKeyboard = modality === "keyboard"; };
    const onClick = (e) => {
        const button = e.target instanceof Element ? e.target.closest("button") : null;
        if (!button || !el.contains(button)) return;
        const action = button.dataset.sgAction;
        if (action === "open") onOpen();
        else if (action === "remove") removers.get(button.closest(".sg-chip"))?.();
        if (modality === "pointer") button.blur();
    };
    const onKeydown = (e) => {
        if (!isRemoveKey(e) || !focusFromKeyboard) return;
        const button = e.target instanceof Element ? e.target.closest("button") : null;
        const chip = button?.closest(".sg-chip");
        const remove = chip ? removers.get(chip) : undefined;
        if (!remove) return;
        e.preventDefault();
        e.stopPropagation();
        remove();
    };

    doc.addEventListener("keydown", onDocKeydown, true);
    doc.addEventListener("pointerdown", onDocPointerdown, true);
    el.addEventListener("pointerdown", onPointerdown);
    el.addEventListener("focus", onFocus, true);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeydown);

    function button(className, action) {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = className;
        b.dataset.sgAction = action;
        return b;
    }

    function chip(extraClass, title, markerFor, label, removeLabel, remove) {
        const c = doc.createElement("div");
        c.className = `sg-chip${extraClass}`;
        const body = button("sg-chip-body", "open");
        if (title) body.title = title;
        if (markerFor) markerFor(body);
        const span = doc.createElement("span");
        span.className = "sg-chip-label";
        span.textContent = label;
        body.appendChild(span);
        const x = button("sg-chip-x", "remove");
        x.setAttribute("aria-label", removeLabel);
        x.textContent = "✕";
        c.append(body, x);
        removers.set(c, remove);
        return c;
    }

    function styleChip(s) {
        return chip(
            s.missing ? " sg-chip--missing" : "",
            s.missing ? `${s.title}\n${MISSING_TITLE}` : s.title,
            null,
            s.label,
            `Remove ${s.name}`,
            () => onRemoveStyle({ source_file: s.source_file, name: s.name }),
        );
    }

    function wildcardChip(w) {
        const isDeck = w.kind === WILDCARD_KIND_DECK;
        const title = isDeck
            ? (w.spec ? `${SHUFFLE_CHIP_TITLE}. Slice: ${w.spec}` : SHUFFLE_CHIP_TITLE)
            : (w.spec ? `Slice: ${w.spec}` : "");
        const marker = (body) => {
            const m = doc.createElement("span");
            m.setAttribute("aria-hidden", "true");
            if (isDeck) m.innerHTML = deckIconMarkup();
            else m.textContent = DICE_MARKER;
            body.appendChild(m);
            if (isDeck) {
                const sr = doc.createElement("span");
                sr.className = "sg-sr-only";
                sr.textContent = SHUFFLE_CHIP_TITLE;
                body.appendChild(sr);
            }
        };
        return chip(
            " sg-chip--wildcard",
            title,
            marker,
            w.label,
            `Remove wildcard ${w.category}`,
            () => onRemoveWildcard({ category: w.category, spec: w.spec, kind: w.kind }),
        );
    }

    /** @returns {{rows: 0|1|2}} */
    function render(model) {
        el.replaceChildren();
        const chips = [
            ...(model?.styles || []).map(styleChip),
            ...(model?.wildcards || []).map(wildcardChip),
        ];
        if (!chips.length) return { rows: 0 };
        el.append(...chips);

        const rowsOf = (elements) => measure(elements);
        let rows = rowsOf(chips);
        if (Math.max(...rows) < MAX_ROWS) return { rows: Math.max(...rows) + 1 };

        const more = button("sg-chip-more", "open");
        el.appendChild(more);
        let shown = rows.filter((r) => r < MAX_ROWS).length;
        for (;;) {
            chips.forEach((c, i) => { c.hidden = i >= shown; });
            const hiddenCount = chips.length - shown;
            more.textContent = `+${hiddenCount}`;
            more.setAttribute("aria-label", `Show ${hiddenCount} more in Style Grid`);
            const visible = [...chips.slice(0, shown), more];
            rows = rowsOf(visible);
            if (rows[rows.length - 1] < MAX_ROWS || shown === 0) break;
            shown -= 1;
        }
        return { rows: Math.min(MAX_ROWS, Math.max(...rows) + 1) };
    }

    function destroy() {
        doc.removeEventListener("keydown", onDocKeydown, true);
        doc.removeEventListener("pointerdown", onDocPointerdown, true);
        el.removeEventListener("pointerdown", onPointerdown);
        el.removeEventListener("focus", onFocus, true);
        el.removeEventListener("click", onClick);
        el.removeEventListener("keydown", onKeydown);
        el.remove();
    }

    return { el, render, destroy };
}
