import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { DECK_INDEX_WIDGET, DECK_SEED_WIDGET, repairRestoredWidgets, toWidgetInt } from "./restored_widgets.js";
import {
    LEDGER_FIELD,
    parseLedger,
    serializeLedger,
    subsumePresent,
    selectFromLedger,
    syntheticStyle,
} from "./applied_ledger.js";
import { parseFrameMessage } from "./frame_messages.js";
import {
    clearNodePrompts,
    refreshCatalog,
    renameLedgerEntries,
    shouldSyncPanel,
    uploadPreview,
} from "./host_actions.js";
import {
    activeWildcardCategories,
    normalizeWildcardKind,
    parseSgInner,
    parseTags,
    splitTopLevelCommas,
    styleIsPresent,
    tagKey,
} from "./prompt_text.js";
import { chipRowsHeight, createChipRow, nextNodeHeight, nodeChipModel } from "./node_chips.js";

const IFRAME_SRC = "/extensions/sd-comfyui-style-organizer/ui/index.html";
/** Target origin for host -> iframe messages; IFRAME_SRC is an absolute same-origin path. */
const IFRAME_ORIGIN = window.location.origin;

const THEME_CANDIDATES = () => [document.body, document.documentElement];
const THEME_LIGHT_LUMINANCE = 0.4;
const THEME_DEBOUNCE_MS = 100;
const OVERLAY_BG = { dark: "#111111", light: "#f8fafc" };

let overlay = null;
let backdrop = null;
let iframe = null;
let ready = false;
let currentNode = null;
let currentTheme = "dark";
let themeTimer = null;
let allStylesCache = [];
/** Element that had focus when the browser was opened (restore on close). */
let openerEl = null;
/** node → Map<styleKey, { name, source_file, prompt, negative_prompt }> written at apply time. */
const appliedByNode = new WeakMap();
/** Legacy rehydrate display list (no persisted ledger yet), used to seed a ledger on first mutate. */
const legacyShown = new WeakMap();

const STYLE_KEY_SEP = "\0";

/** Same format as ui/src/store/stylesStore.ts styleRowKey. */
function styleKey(name, sourceFile) {
    return `${sourceFile || ""}${STYLE_KEY_SEP}${name}`;
}

function parseStyleKey(id) {
    const i = typeof id === "string" ? id.indexOf(STYLE_KEY_SEP) : -1;
    if (i < 0) return null;
    return { source_file: id.slice(0, i), name: id.slice(i + 1) };
}

function sameStyleContent(a, b) {
    return (a.prompt || "") === (b.prompt || "")
        && (a.negative_prompt || "") === (b.negative_prompt || "");
}

/**
 * Resolve a catalog row. Returns { row, status } where status is
 * "exact" | "unique" | "content" | "ambiguous" | "missing".
 * content (optional) = { prompt, negative_prompt } used only when sourceFile is empty and the name is ambiguous.
 */
function resolveStyleRow(name, sourceFile, content) {
    if (sourceFile) {
        const row = allStylesCache.find((s) =>
            s.name === name && String(s.source_file || "") === String(sourceFile)
        );
        return row ? { row, status: "exact" } : { row: null, status: "missing" };
    }
    const byName = allStylesCache.filter((s) => s.name === name);
    if (byName.length === 0) return { row: null, status: "missing" };
    if (byName.length === 1) return { row: byName[0], status: "unique" };
    if (content) {
        const byContent = byName.filter((s) => sameStyleContent(s, content));
        if (byContent.length === 1) return { row: byContent[0], status: "content" };
    }
    return { row: null, status: "ambiguous" };
}

function postToIframe(msg) {
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(msg, IFRAME_ORIGIN);
}

function postInfoToast(message) {
    if (iframe?.contentWindow) {
        postToIframe({ type: "SG_TOAST", message, variant: "info" });
    }
}

function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function detectTheme() {
    for (const el of THEME_CANDIDATES()) {
        if (!el) continue;
        const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
        if (!(a > 0)) continue;
        const luminance =
            0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
        return luminance > THEME_LIGHT_LUMINANCE ? "light" : "dark";
    }
    return "dark";
}

function postTheme() {
    if (iframe?.contentWindow) {
        postToIframe({ type: "SG_THEME", mode: currentTheme });
    }
}

function applyOverlayTheme() {
    if (overlay) overlay.style.background = OVERLAY_BG[currentTheme];
}

function scheduleThemeCheck() {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => {
        const next = detectTheme();
        if (next === currentTheme) return;
        currentTheme = next;
        applyOverlayTheme();
        postTheme();
    }, THEME_DEBOUNCE_MS);
}

function closeStyleBrowser() {
    if (backdrop) backdrop.style.display = "none";
    if (overlay) overlay.style.display = "none";
    const restore = openerEl;
    openerEl = null;
    if (restore && document.contains(restore) && typeof restore.focus === "function") {
        restore.focus();
    }
}

function mergeTagsIntoText(baseText, addition) {
    if (!addition) return baseText;
    const current = parseTags(baseText);
    const seen = new Set(current.map(tagKey));
    const result = current.slice();
    for (const tag of parseTags(addition)) {
        const key = tagKey(tag);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(tag);
        }
    }
    return result.join(", ");
}

function removeTagsFromText(baseText, removal, protectedTags) {
    if (!removal) return baseText;
    const removeKeys = new Set(parseTags(removal).map(tagKey));
    const protect = new Set((protectedTags || []).map(tagKey));
    return parseTags(baseText)
        .filter((tag) => {
            const key = tagKey(tag);
            return !removeKeys.has(key) || protect.has(key);
        })
        .join(", ");
}

// A style's prompt/negative_prompt may be a plain tag list, or a {prompt}-wrapping
// template (e.g. "best quality, {prompt}, detailed"). Wrap templates transform the whole
// string rather than adding tags, so they're handled separately from the tag-key path,
// mirroring the WebUI host's wrapTemplate prefix/suffix logic.
function applyStyleText(baseText, template) {
    if (!template) return baseText;
    if (template.includes("{prompt}")) {
        return template.split("{prompt}").join(baseText);
    }
    return mergeTagsIntoText(baseText, template);
}

function removeStyleText(baseText, template, protectedTags) {
    if (!template) return baseText;
    if (template.includes("{prompt}")) {
        const [rawPrefix, rawSuffix] = template.split("{prompt}");
        const prefix = (rawPrefix || "").replace(/,\s*$/, "").trim();
        const suffix = (rawSuffix || "").replace(/^,\s*/, "").trim();
        let current = baseText.trim();
        if (prefix && current.indexOf(prefix) === 0) {
            current = current.slice(prefix.length).replace(/^,\s*/, "").trim();
        }
        if (suffix && current.length >= suffix.length &&
            current.lastIndexOf(suffix) === current.length - suffix.length) {
            current = current.slice(0, current.length - suffix.length).replace(/,\s*$/, "").trim();
        }
        return current;
    }
    return removeTagsFromText(baseText, template, protectedTags);
}

function getTextWidgets(node) {
    return {
        text: node?.widgets?.find((w) => w.name === "text"),
        neg: node?.widgets?.find((w) => w.name === "negative_text"),
    };
}

const DECK_SEED_RANDOM_MASK = 0x7fffffff; // new decks stay far below 2^53 (JS numbers)
const DECK_HOOKED_FLAG = "__sgDeckHooked";

/** Hide a widget (and its linked control widget) on the node. `hidden` is the supported API in the current
 * frontend; computeSize covers older frontends. The widget stays in node.widgets, so it still serializes,
 * is sent to the backend and keeps running control_after_generate. */
function hideWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    for (const linked of widget.linkedWidgets || []) {
        hideWidget(linked);
    }
}

function getDeckWidgets(node) {
    return {
        seed: node?.widgets?.find((w) => w.name === DECK_SEED_WIDGET),
        index: node?.widgets?.find((w) => w.name === DECK_INDEX_WIDGET),
    };
}

function postDeckState(node) {
    if (!ready || !iframe?.contentWindow || node !== currentNode) return;
    const { seed, index } = getDeckWidgets(node);
    if (!seed || !index) return;
    postToIframe(
        { type: "SG_DECK_STATE", seed: toWidgetInt(seed.value), index: toWidgetInt(index.value) }
    );
}

function setDeckWidgetValue(widget, value) {
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value);
}

function restartDeck(node) {
    const { index } = getDeckWidgets(node);
    setDeckWidgetValue(index, 0);
    node.graph?.setDirtyCanvas(true, true);
    postDeckState(node);
}

function newDeck(node) {
    const { seed, index } = getDeckWidgets(node);
    const fresh = crypto.getRandomValues(new Uint32Array(1))[0] & DECK_SEED_RANDOM_MASK;
    setDeckWidgetValue(seed, fresh);
    setDeckWidgetValue(index, 0);
    node.graph?.setDirtyCanvas(true, true);
    postDeckState(node);
}

/** Re-post the deck state whenever the frontend changes a deck widget (control_after_generate calls callback). */
function hookDeckWidgetCallbacks(node) {
    const { seed, index } = getDeckWidgets(node);
    for (const widget of [seed, index]) {
        if (!widget || widget[DECK_HOOKED_FLAG]) continue;
        widget[DECK_HOOKED_FLAG] = true;
        const original = widget.callback;
        widget.callback = function (...args) {
            const result = original ? original.apply(this, args) : undefined;
            postDeckState(node);
            return result;
        };
    }
}

const DECK_SERIALIZER_FLAG = "__sgDeckSerializer";

/** Workflows saved before the deck widgets existed keep the Browse Styles button's null in positional
 * slot 3, which now lands on deck_seed. Whatever the widget holds, the backend must receive a clean integer. */
function guardDeckWidgetSerialization(node) {
    const { seed, index } = getDeckWidgets(node);
    for (const widget of [seed, index]) {
        if (!widget || widget[DECK_SERIALIZER_FLAG]) continue;
        widget[DECK_SERIALIZER_FLAG] = true;
        widget.serializeValue = async () => toWidgetInt(widget.value);
    }
}

function styleKeysOf(style) {
    return {
        pos: new Set(parseTags(style.prompt || "").map(tagKey)),
        neg: new Set(parseTags(style.negative_prompt || "").map(tagKey)),
    };
}

/** Seed an empty-or-legacyShown ledger before the first mutating action on a legacy node. */
function ensureLedger(node) {
    if (appliedByNode.has(node)) return appliedByNode.get(node);
    const shown = legacyShown.get(node) || [];
    const byKey = new Map();
    for (const e of shown) {
        byKey.set(styleKey(e.name, e.source_file), {
            name: e.name,
            source_file: e.source_file || "",
            prompt: e.prompt || "",
            negative_prompt: e.negative_prompt || "",
        });
    }
    appliedByNode.set(node, byKey);
    return byKey;
}

function getActiveStyles(text, negativeText, excludeStyle, node) {
    if (node && appliedByNode.has(node)) {
        const out = [];
        for (const entry of appliedByNode.get(node).values()) {
            if (excludeStyle) {
                const sameKey = styleKey(entry.name, entry.source_file)
                    === styleKey(excludeStyle.name, excludeStyle.source_file);
                const twinContent = entry.name === excludeStyle.name
                    && sameStyleContent(entry, excludeStyle);
                if (sameKey || twinContent) continue;
            }
            if (styleIsPresent(text, negativeText, entry)) out.push(entry);
        }
        return out;
    }
    return allStylesCache.filter((s) => {
        if (excludeStyle) {
            const sameKey = styleKey(s.name, s.source_file)
                === styleKey(excludeStyle.name, excludeStyle.source_file);
            const twinContent = s.name === excludeStyle.name
                && sameStyleContent(s, excludeStyle);
            if (sameKey || twinContent) return false;
        }
        return styleIsPresent(text, negativeText, s);
    });
}

function isWrapStyle(style) {
    return (style.prompt || "").includes("{prompt}") ||
        (style.negative_prompt || "").includes("{prompt}");
}

function applyStyleToNode(node, style, options = { record: true }) {
    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";

    // Nesting a second {prompt}-wrap puts the new prefix/suffix on the
    // boundaries, so removeStyleText can no longer find the inner wrap.
    if (isWrapStyle(style)) {
        const activeWrap = getActiveStyles(currentText, currentNeg, style, node)
            .find(isWrapStyle);
        if (activeWrap) {
            const message = "Only one {prompt}-wrap style can be active at a time";
            console.warn(`[Style Grid] ${message} (blocked: ${style.name}; active: ${activeWrap.name})`);
            postInfoToast(message);
            return;
        }
    }

    if (text) text.value = applyStyleText(currentText, style.prompt || "");
    if (neg) neg.value = applyStyleText(currentNeg, style.negative_prompt || "");
    node.graph?.setDirtyCanvas(true, true);

    if (options.record === false) {
        refreshNodeChips(node);
        return;
    }

    const byKey = ensureLedger(node);
    byKey.set(styleKey(style.name, style.source_file), {
        name: style.name,
        source_file: style.source_file || "",
        prompt: style.prompt || "",
        negative_prompt: style.negative_prompt || "",
    });
    node.graph?.setDirtyCanvas(true, true);
    refreshNodeChips(node);
}

function unapplyStyleFromNode(node, style) {
    ensureLedger(node);
    const key = styleKey(style.name, style.source_file);
    const recorded = appliedByNode.get(node)?.get(key);
    const prompt = recorded ? recorded.prompt : (style.prompt || "");
    const negTpl = recorded ? recorded.negative_prompt : (style.negative_prompt || "");

    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";
    const others = getActiveStyles(currentText, currentNeg, style, node);
    const protectPos = others.flatMap((s) => parseTags(s.prompt || ""));
    const protectNeg = others.flatMap((s) => parseTags(s.negative_prompt || ""));
    if (text) text.value = removeStyleText(currentText, prompt, protectPos);
    if (neg) neg.value = removeStyleText(currentNeg, negTpl, protectNeg);
    node.graph?.setDirtyCanvas(true, true);

    appliedByNode.get(node)?.delete(key);
    node.graph?.setDirtyCanvas(true, true);
    refreshNodeChips(node);
}

// Reorders the tag-blocks belonging to currently-applied plain-tag styles to
// match `styleIds` (new drag order from the SelectedBar chips), leaving any
// free-typed text in place before them. Wrap-template styles (prompt/negative
// containing "{prompt}") transform the whole string rather than adding
// discrete tags, so they have no clean per-tag position to reorder — they're
// left untouched and their wrapped text is treated as opaque "free" text.
function reorderStylesInNode(node, styleIds) {
    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";

    const isReorderable = (s) =>
        !(s.prompt || "").includes("{prompt}") && !(s.negative_prompt || "").includes("{prompt}");
    const activeStyles = getActiveStyles(currentText, currentNeg, null, node).filter(isReorderable);
    const activeByKey = new Map(
        activeStyles.map((s) => [styleKey(s.name, s.source_file), s])
    );

    const rebuild = (baseText, field) => {
        const ownedKeys = new Set();
        for (const s of activeStyles) {
            for (const t of parseTags(s[field] || "")) ownedKeys.add(tagKey(t));
        }
        const freeTags = parseTags(baseText).filter((t) => !ownedKeys.has(tagKey(t)));

        const orderedStyleTags = [];
        const seen = new Set();
        const appendStyleTags = (style) => {
            for (const t of parseTags(style[field] || "")) {
                const key = tagKey(t);
                if (!seen.has(key)) {
                    seen.add(key);
                    orderedStyleTags.push(t);
                }
            }
        };
        for (const id of styleIds) {
            let style = null;
            const parsed = parseStyleKey(id);
            if (parsed) {
                style = activeByKey.get(styleKey(parsed.name, parsed.source_file));
            } else {
                const matches = activeStyles.filter((s) => s.name === id);
                if (matches.length === 1) style = matches[0];
            }
            if (style) appendStyleTags(style);
        }
        // Safety net: an active reorderable style missing from styleIds
        // (message out of sync with reality) still keeps its tags, appended
        // after the ones that were explicitly ordered.
        for (const s of activeStyles) appendStyleTags(s);

        return [...freeTags, ...orderedStyleTags].join(", ");
    };

    if (text) text.value = rebuild(currentText, "prompt");
    if (neg) neg.value = rebuild(currentNeg, "negative_prompt");
    node.graph?.setDirtyCanvas(true, true);
}

function buildSgToken(category, spec, kind) {
    const cat = String(category || "").toLowerCase();
    const sp = spec == null ? "" : String(spec);
    return "{" + normalizeWildcardKind(kind) + ":" + cat + (sp ? ":" + sp : "") + "}";
}

function insertWildcardCategory(node, category, spec, kind) {
    const { text } = getTextWidgets(node);
    if (!text) return;
    const token = buildSgToken(category, spec || "", kind);
    const already = parseTags(text.value || "").some(
        (t) => t.toLowerCase() === token.toLowerCase()
    );
    if (already) return;
    text.value = mergeTagsIntoText(text.value || "", token);
    node.graph?.setDirtyCanvas(true, true);
    syncWildcards(node);
    refreshNodeChips(node);
}

function syncWildcards(node) {
    if (!shouldSyncPanel(node, currentNode)) return;
    const { text, neg } = getTextWidgets(node);
    const categories = activeWildcardCategories(
        text ? text.value || "" : "",
        neg ? neg.value || "" : ""
    ).map((entry) => ({ category: entry.category, spec: entry.spec, kind: normalizeWildcardKind(entry.kind) }));
    postToIframe({ type: "SG_WILDCARDS_ACTIVE", categories });
}

function removeWildcardCategory(node, category, spec, kind) {
    const { text, neg } = getTextWidgets(node);
    const token = buildSgToken(category, spec || "", kind).toLowerCase();
    const strip = (s) =>
        splitTopLevelCommas(s || "")
            .map((t) => t.trim())
            .filter((t) => t && t.toLowerCase() !== token)
            .join(", ");
    if (text) text.value = strip(text.value || "");
    if (neg) neg.value = strip(neg.value || "");
    node.graph?.setDirtyCanvas(true, true);
    syncWildcards(node);
    refreshNodeChips(node);
}

function reorderWildcardCategories(node, newOrder) {
    const { text, neg } = getTextWidgets(node);
    const order = Array.isArray(newOrder) ? newOrder : [];
    const wcRe = /^\{(sgd?):([^}]+)\}$/i;

    function orderKey(category, spec, kind) {
        return (
            String(category || "").toLowerCase() +
            "\0" +
            String(spec || "").toLowerCase() +
            "\0" +
            normalizeWildcardKind(kind)
        );
    }

    function reorderOne(raw) {
        const tokens = splitTopLevelCommas(raw || "");
        const present = {};
        let firstWcIdx = -1;
        const nonWildcards = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const m = wcRe.exec(t);
            if (m) {
                if (firstWcIdx === -1) firstWcIdx = i;
                const parsed = parseSgInner(m[2]);
                present[orderKey(parsed.category, parsed.spec, m[1])] = true;
            } else {
                nonWildcards.push(t);
            }
        }
        if (firstWcIdx === -1) return null;

        const reorderedWc = [];
        for (const item of order) {
            if (!item || typeof item !== "object") continue;
            const cat = String(item.category || "").trim();
            const sp = item.spec == null ? "" : String(item.spec);
            const kind = normalizeWildcardKind(item.kind);
            if (cat && present[orderKey(cat, sp, kind)]) {
                reorderedWc.push(buildSgToken(cat, sp, kind));
            }
        }

        const beforeCount = firstWcIdx;
        return nonWildcards
            .slice(0, beforeCount)
            .concat(reorderedWc)
            .concat(nonWildcards.slice(beforeCount))
            .join(", ");
    }

    if (text) {
        const nextP = reorderOne(text.value || "");
        if (nextP !== null) text.value = nextP;
    }
    if (neg) {
        const nextN = reorderOne(neg.value || "");
        if (nextN !== null) neg.value = nextN;
    }
    node.graph?.setDirtyCanvas(true, true);
    syncWildcards(node);
    refreshNodeChips(node);
}

function setActiveSource(node, source) {
    const w = node?.widgets?.find((w) => w.name === "active_source");
    if (!w) return;
    w.value = source || "";
    node.graph?.setDirtyCanvas(true, true);
}

/** Separates name / prompt / negative_prompt in collapsePresentStyles content keys. */
const PRESENT_STYLE_CONTENT_KEY_SEP = "\0";

/** @param {string} [p] @returns {string} */
function normalizeSourcePath(p) {
    return String(p || "").replace(/\\/g, "/");
}

/** @param {string} [p] @returns {string} */
function sourceBasename(p) {
    const s = normalizeSourcePath(p);
    const i = s.lastIndexOf("/");
    return i < 0 ? s : s.slice(i + 1);
}

/**
 * One row per content-identical present style (name+prompt+negative_prompt).
 * Prefer activeSource full path if any row matches; else basename; else first-seen.
 * @param {Array<{ name?: string, prompt?: string, negative_prompt?: string, source_file?: string }>} present
 * @param {string} [activeSource] @returns {typeof present}
 */
function collapsePresentStyles(present, activeSource) {
    const want = activeSource ? normalizeSourcePath(activeSource) : "";
    const useFull = !!(want && present.some((s) => normalizeSourcePath(s.source_file) === want));
    const prefer = (s) => !want ? false
        : useFull ? normalizeSourcePath(s.source_file) === want
        : sourceBasename(s.source_file) === sourceBasename(activeSource);
    /** @type {Map<string, (typeof present)[number]>} */
    const byContent = new Map();
    for (const style of present) {
        const key = [style.name || "", style.prompt || "", style.negative_prompt || ""].join(PRESENT_STYLE_CONTENT_KEY_SEP);
        if (!byContent.has(key)) byContent.set(key, style);
        else if (prefer(style)) byContent.set(key, style);
    }
    return [...byContent.values()];
}

/** Catalog rows present in a node without a ledger (legacy workflow): one per content, subsumed. Read-only. */
function legacyPresentStyles(node) {
    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";
    const present = allStylesCache.filter((s) => styleIsPresent(currentText, currentNeg, s));
    const activeW = node.widgets?.find((w) => w.name === "active_source");
    const collapsed = collapsePresentStyles(
        present,
        activeW ? String(activeW.value || "") : "",
    );
    return subsumePresent(collapsed, styleKeysOf);
}

function ledgerEntryOf(s) {
    return {
        name: s.name,
        source_file: s.source_file || "",
        prompt: s.prompt || "",
        negative_prompt: s.negative_prompt || "",
    };
}

/** SG_STYLE_APPLIED for each style applied to the node: ledger entries still in its text, or (legacy) catalog matches. */
function postAppliedStyles(node) {
    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";
    if (appliedByNode.has(node)) {
        for (const entry of appliedByNode.get(node).values()) {
            if (!styleIsPresent(currentText, currentNeg, entry)) continue;
            const r = resolveStyleRow(entry.name, entry.source_file || "");
            const toPost = r.row || syntheticStyle(entry);
            postToIframe({ type: "SG_STYLE_APPLIED", style: toPost });
        }
        return;
    }
    const collapsed = legacyPresentStyles(node);
    legacyShown.set(node, collapsed.map(ledgerEntryOf));
    for (const style of collapsed) {
        postToIframe({ type: "SG_STYLE_APPLIED", style });
    }
}

function rehydrate() {
    return fetch("/style_grid/styles")
        .then((r) => r.json())
        .then((data) => {
            setStylesCache(Object.values(data.categories || {}).flat());
            postToIframe({
                type: "SG_INIT",
                styles: allStylesCache,
            });
            postToIframe({ type: "SG_CLEAR_SELECTION" });

            if (!currentNode) return;
            const { text, neg } = getTextWidgets(currentNode);
            const currentText = text ? text.value || "" : "";
            const currentNeg = neg ? neg.value || "" : "";

            if (appliedByNode.has(currentNode)) {
                const byKey = appliedByNode.get(currentNode);
                const { dropped } = selectFromLedger(
                    [...byKey.values()],
                    (entry) => styleIsPresent(currentText, currentNeg, entry),
                );
                let ledgerChanged = false;
                for (const entry of dropped) {
                    byKey.delete(styleKey(entry.name, entry.source_file));
                    ledgerChanged = true;
                }
                if (ledgerChanged) currentNode.graph?.setDirtyCanvas(true, true);
            }
            postAppliedStyles(currentNode);
            syncWildcards(currentNode);
            refreshNodeChips(currentNode);
        });
}

function isPanelOpen() {
    return !!(ready && overlay && overlay.style.display === "block");
}

/** The panel's tray for this node, rebuilt as rehydrate does; only when the panel is open for it. */
function syncPanelForNode(node) {
    if (!shouldSyncPanel(node, currentNode) || !isPanelOpen()) return;
    postToIframe({ type: "SG_CLEAR_SELECTION" });
    postAppliedStyles(node);
    syncWildcards(node);
}

/** Every Style Grid node in the graph (rename must reach nodes that are not open). */
function styleGridNodes() {
    const nodes = app.graph?._nodes || app.graph?.nodes || [];
    return nodes.filter((n) => n?.comfyClass === "StyleGridNode");
}

function fetchCatalog() {
    return fetch("/style_grid/check_update")
        .catch(() => null)
        .then(() => fetch("/style_grid/styles"))
        .then((r) => r.json())
        .then((data) => Object.values(data.categories || {}).flat());
}

/** SG_REFRESH / after SG_STYLE_RENAMED: new catalog to the panel, vanished styles out of the node. */
function refreshFromServer(quietVanished) {
    return refreshCatalog(
        { quiet_vanished: quietVanished },
        {
            fetchStyles: fetchCatalog,
            setCatalog: setStylesCache,
            post: postToIframe,
            currentNode: () => currentNode,
            getLedger: (node) => appliedByNode.get(node),
            unapply: unapplyStyleFromNode,
            syncWildcards,
            toast: postInfoToast,
        },
    ).then(() => {
        if (currentNode) refreshNodeChips(currentNode);
    }).catch((err) => {
        console.warn("[Style Grid] refresh failed", err);
        postToIframe({ type: "SG_TOAST", message: "Refresh failed", variant: "error" });
    });
}

// ---------------------------------------------------------------------------
// Applied-style chips on the node (web/js/node_chips.js renders them).

const CHIP_WIDGET = "sg_chips";
/** DOM widget margin above and below the row (the frontend default is 10). */
const CHIP_WIDGET_MARGIN = 4;
const CHIP_INPUT_DEBOUNCE_MS = 150;

/**
 * node → { row, widget, signature, height, pending, pendingFit, timer, frame, cleanup }.
 * height: the widget's current height (0 when hidden); pending: the last render
 * could not be measured (element not laid out yet), re-measured on the next draw.
 */
const chipsByNode = new WeakMap();
/** Lazy catalog load for legacy nodes: started at most once per page. */
let catalogLoad = null;
let catalogKeysOf = null;
let catalogKeys = null;

/** Replace the catalog the panel and the chips share, then rebuild every node's chips. */
function setStylesCache(styles) {
    allStylesCache = styles;
    for (const node of styleGridNodes()) refreshNodeChips(node, { fit: true });
}

function catalogKeySet() {
    if (!allStylesCache.length) return null;
    if (catalogKeysOf !== allStylesCache) {
        catalogKeysOf = allStylesCache;
        catalogKeys = new Set(allStylesCache.map((s) => styleKey(s.name, s.source_file)));
    }
    return catalogKeys;
}

/** The host's own toast (ComfyUI), for messages that are not about the open panel. */
function hostToast(severity, detail) {
    const toast = app.extensionManager?.toast;
    if (toast?.add) toast.add({ severity, summary: "Style Grid", detail, life: 8000 });
    else console.warn("[Style Grid]", detail);
}

/** Legacy nodes need the catalog to show chips; load it once, into the panel's cache. */
function ensureCatalogLoaded() {
    if (catalogLoad || allStylesCache.length) return;
    catalogLoad = fetch("/style_grid/styles")
        .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then((data) => {
            if (!allStylesCache.length) setStylesCache(Object.values(data.categories || {}).flat());
        })
        .catch((err) => {
            console.warn("[Style Grid] style library load failed", err);
            hostToast("warn", "Could not load the style library; chips are not shown for nodes from older workflows.");
        });
}

/** Ledger entries for the chips; legacy nodes derive them from the catalog without writing anything. */
function chipLedgerEntries(node) {
    if (appliedByNode.has(node)) return [...appliedByNode.get(node).values()];
    if (!allStylesCache.length) {
        ensureCatalogLoaded();
        return [];
    }
    return legacyPresentStyles(node).map(ledgerEntryOf);
}

function isLaidOut(el) {
    return el.isConnected && el.getClientRects().length > 0 && el.clientWidth > 0;
}

function resizeForChips(node, state, height, fit) {
    const prev = state.height;
    state.height = height;
    const next = nextNodeHeight({
        currentHeight: node.size[1],
        minHeight: node.computeSize()[1],
        prevRowsHeight: prev,
        newRowsHeight: height,
        fit,
    });
    if (next !== null) node.setSize([node.size[0], next]);
    node.graph?.setDirtyCanvas(true, true);
}

/**
 * Rebuild the node's chip row from its ledger and text. Skips the DOM when
 * nothing shown changed. fit: rebuilt from a load or a new catalog (only grow
 * to the minimum); otherwise an edit (move the node height by the row's change).
 */
function refreshNodeChips(node, { force = false, fit = false } = {}) {
    const state = chipsByNode.get(node);
    if (!state) return;
    const { text, neg } = getTextWidgets(node);
    const model = nodeChipModel({
        ledgerEntries: chipLedgerEntries(node),
        text: text ? text.value || "" : "",
        negativeText: neg ? neg.value || "" : "",
        catalogKeys: catalogKeySet(),
    });
    if (!force && !state.pending && model.signature === state.signature) return;
    const useFit = state.pending ? state.pendingFit : fit;
    const empty = !model.styles.length && !model.wildcards.length;
    state.widget.hidden = empty;
    const { rows } = state.row.render(model);
    state.signature = model.signature;
    let height;
    if (empty) {
        height = 0;
        state.pending = false;
    } else if (isLaidOut(state.row.el)) {
        height = chipRowsHeight(rows, CHIP_WIDGET_MARGIN);
        state.pending = false;
    } else {
        // Not laid out yet (just unhidden, zoomed out, off screen): keep a one-row
        // height so the frontend lays it out, and measure again on the next draw.
        height = state.height || chipRowsHeight(1, CHIP_WIDGET_MARGIN);
        state.pending = true;
        state.pendingFit = useFit;
    }
    resizeForChips(node, state, height, useFit);
}

function scheduleChipRemeasure(node) {
    const state = chipsByNode.get(node);
    if (!state || state.frame) return;
    state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        refreshNodeChips(node, { force: true });
    });
}

/** Register an undo step for a chip action (1.58.5: captureCanvasState; checkState is its deprecated alias). */
function captureUndoStep() {
    const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
    if (typeof tracker?.captureCanvasState === "function") tracker.captureCanvasState();
    else if (typeof tracker?.checkState === "function") tracker.checkState();
}

/** ✕ on a style chip: the SG_UNAPPLY path for (source_file, name). */
function removeStyleChip(node, { source_file, name }) {
    if (!appliedByNode.has(node)) {
        // Legacy node: seed the ledger from what the chips show, as opening the panel would.
        legacyShown.set(node, chipLedgerEntries(node));
    }
    const toPanel = shouldSyncPanel(node, currentNode) && isPanelOpen();
    unapplyFromMessage(
        node,
        { type: "SG_UNAPPLY", styleId: name, source_file },
        toPanel ? postInfoToast : (message) => hostToast("info", message),
    );
    syncPanelForNode(node);
    captureUndoStep();
}

/** ✕ on a wildcard chip: the SG_REMOVE_WILDCARD path for (category, spec, kind). */
function removeWildcardChip(node, { category, spec, kind }) {
    removeWildcardCategory(node, category, spec || "", kind);
    syncPanelForNode(node);
    captureUndoStep();
}

function hookChipInputs(node, state) {
    const { text, neg } = getTextWidgets(node);
    for (const widget of [text, neg]) {
        const el = widget?.element || widget?.inputEl;
        if (!el?.addEventListener) continue;
        const onInput = () => {
            clearTimeout(state.timer);
            state.timer = setTimeout(() => {
                state.timer = 0;
                refreshNodeChips(node);
            }, CHIP_INPUT_DEBOUNCE_MS);
        };
        el.addEventListener("input", onInput);
        state.cleanup.push(() => el.removeEventListener("input", onInput));
    }
}

function destroyNodeChips(node) {
    const state = chipsByNode.get(node);
    if (!state) return;
    clearTimeout(state.timer);
    if (state.frame) cancelAnimationFrame(state.frame);
    for (const undo of state.cleanup) undo();
    state.row.destroy();
    chipsByNode.delete(node);
}

/** The chip row widget, added before the Browse Styles button. Frontends without DOM widgets get no chips. */
function addNodeChips(node) {
    if (typeof node.addDOMWidget !== "function") return;
    const state = {
        row: null,
        widget: null,
        signature: null,
        height: 0,
        pending: false,
        pendingFit: false,
        timer: 0,
        frame: 0,
        cleanup: [],
    };
    state.row = createChipRow({
        doc: document,
        onOpen: () => showStyleBrowserFor(node),
        onRemoveStyle: (style) => removeStyleChip(node, style),
        onRemoveWildcard: (wildcard) => removeWildcardChip(node, wildcard),
    });
    const widget = node.addDOMWidget(CHIP_WIDGET, "sg-chips", state.row.el, {
        serialize: false,
        hideOnZoom: true,
        margin: CHIP_WIDGET_MARGIN,
        getMinHeight: () => state.height,
        getMaxHeight: () => state.height,
        afterResize: () => scheduleChipRemeasure(node),
    });
    // serialiseWidgetValues (1.58.5) skips widget.serialize === false; graphToPrompt checks options.serialize.
    widget.serialize = false;
    widget.hidden = true;
    state.widget = widget;
    chipsByNode.set(node, state);
    hookChipInputs(node, state);

    const prevDraw = node.onDrawForeground;
    node.onDrawForeground = function (...args) {
        const result = prevDraw?.apply(this, args);
        const s = chipsByNode.get(this);
        if (s?.pending && isLaidOut(s.row.el)) scheduleChipRemeasure(this);
        return result;
    };
    const prevRemoved = node.onRemoved;
    node.onRemoved = function (...args) {
        const result = prevRemoved?.apply(this, args);
        destroyNodeChips(this);
        return result;
    };
}

/** Native image picker in the host page; resolves null when cancelled. */
function pickImageDataUrl() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("cancel", () => resolve(null));
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            if (!file) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
        input.click();
    });
}

function postJson(url, body) {
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).then((r) => r.json());
}

function ensureOverlay() {
    if (overlay) return;

    backdrop = document.createElement("div");
    backdrop.id = "sg-backdrop";
    backdrop.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147482999",
        "background:rgba(0,0,0,0.4)",
        "display:none",
        "cursor:default",
    ].join(";");
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeStyleBrowser();
    });

    overlay = document.createElement("div");
    overlay.id = "sg-overlay";
    overlay.style.cssText = [
        "position:fixed",
        "top:80px",
        "right:16px",
        "width:1000px",
        "height:650px",
        "min-width:600px",
        "min-height:400px",
        "max-width:95vw",
        "max-height:90vh",
        "border-radius:12px",
        "box-shadow:0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
        "z-index:2147483000",
        "display:none",
        "overflow:hidden",
        "resize:both",
    ].join(";");
    currentTheme = detectTheme();
    applyOverlayTheme();

    iframe = document.createElement("iframe");
    iframe.title = "Style Grid";
    iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
    iframe.src = `${IFRAME_SRC}?t=${Date.now()}&theme=${currentTheme}`;

    const themeObserver = new MutationObserver(scheduleThemeCheck);
    for (const el of THEME_CANDIDATES()) {
        if (el) themeObserver.observe(el, { attributes: true });
    }

    overlay.appendChild(iframe);
    document.body.appendChild(backdrop);
    document.body.appendChild(overlay);

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || overlay.style.display === "none") return;
        // Focus inside iframe: app closes via SG_CLOSE_REQUEST; do not double-close.
        if (document.activeElement === iframe || e.target === iframe) return;
        closeStyleBrowser();
    }, true);

    window.addEventListener("message", (e) => {
        if (e.source !== iframe.contentWindow) return;
        if (e.origin !== IFRAME_ORIGIN) return;
        // Allowlist + shape check (frame_messages.js); unknown or malformed → ignored.
        const msg = parseFrameMessage(e.data);
        if (!msg) return;

        if (msg.type === "SG_READY") {
            ready = true;
            postTheme();
            postDeckState(currentNode);
            rehydrate();
        }
        if (msg.type === "SG_APPLY" && currentNode) {
            const content = { prompt: msg.prompt, negative_prompt: msg.neg };
            const r = resolveStyleRow(msg.styleId, msg.source_file || "", content);
            if (r.status === "exact" || r.status === "unique" || r.status === "content") {
                applyStyleToNode(currentNode, {
                    name: msg.styleId,
                    prompt: msg.prompt,
                    negative_prompt: msg.neg,
                    source_file: r.row.source_file || "",
                });
            } else if (r.status === "missing") {
                applyStyleToNode(currentNode, {
                    name: msg.styleId,
                    prompt: msg.prompt,
                    negative_prompt: msg.neg,
                    source_file: msg.source_file || "",
                });
            } else {
                applyStyleToNode(
                    currentNode,
                    {
                        name: msg.styleId,
                        prompt: msg.prompt,
                        negative_prompt: msg.neg,
                        source_file: "",
                    },
                    { record: false }
                );
                postInfoToast(
                    `Applied "${msg.styleId}" but its pack is ambiguous; select a source in the panel before removing it.`
                );
            }
        }
        if (msg.type === "SG_UNAPPLY" && currentNode) {
            unapplyFromMessage(currentNode, msg, postInfoToast);
        }
        if (msg.type === "SG_WILDCARD_CATEGORY" && currentNode) {
            insertWildcardCategory(currentNode, msg.category, "", msg.kind);
        }
        if (msg.type === "SG_WILDCARD_SLICE" && currentNode) {
            insertWildcardCategory(currentNode, msg.category, msg.spec || "", msg.kind);
        }
        if (msg.type === "SG_CLEAR_ALL") {
            // Empties both prompt widgets of the current node entirely (like WebUI's Clear).
            clearNodePrompts(currentNode, {
                setLedger: (node, ledger) => appliedByNode.set(node, ledger),
                syncWildcards,
                post: postToIframe,
            });
            if (currentNode) refreshNodeChips(currentNode);
        }
        if (msg.type === "SG_REFRESH") {
            refreshFromServer(msg.quiet_vanished);
        }
        if (msg.type === "SG_STYLE_RENAMED") {
            // Ledger first, then the catalog: refreshing first would see the old name gone.
            const renamed = renameLedgerEntries(styleGridNodes(), msg, {
                getLedger: (node) => appliedByNode.get(node),
                setLedger: (node, ledger) => appliedByNode.set(node, ledger),
            });
            refreshFromServer(false);
            // The fetch above is async: the renamed chips update now, the catalog after it.
            for (const n of renamed) refreshNodeChips(n);
        }
        if (msg.type === "SG_UPLOAD_PREVIEW") {
            uploadPreview(msg, {
                pickImageDataUrl,
                postJson,
                post: postToIframe,
                now: () => Date.now(),
            }).catch((err) => console.warn("[Style Grid] preview upload failed", err));
        }
        if (msg.type === "SG_REMOVE_WILDCARD" && currentNode) {
            removeWildcardCategory(currentNode, msg.category, msg.spec || "", msg.kind);
        }
        if (msg.type === "SG_REORDER_WILDCARDS" && currentNode) {
            if (Array.isArray(msg.categories) && msg.categories.length) {
                reorderWildcardCategories(currentNode, msg.categories);
            }
        }
        if (msg.type === "SG_REORDER_STYLES" && currentNode) {
            // styleIds are styleRowKey strings, as the WebUI tray (SortableChips) sends them.
            reorderStylesInNode(currentNode, msg.styleIds);
        }
        if (msg.type === "SG_SOURCE_CHANGE" && currentNode) {
            setActiveSource(currentNode, msg.source);
        }
        if (msg.type === "SG_DECK_RESTART" && currentNode) {
            restartDeck(currentNode);
        }
        if (msg.type === "SG_DECK_NEW" && currentNode) {
            newDeck(currentNode);
        }
        if (msg.type === "SG_CLOSE_REQUEST") {
            closeStyleBrowser();
        }
    });
}

function openStyleBrowser(node) {
    if (overlay && overlay.style.display === "block" && currentNode === node) {
        closeStyleBrowser();
        return;
    }
    currentNode = node;
    openerEl = document.activeElement;
    ensureOverlay();
    const reveal = () => {
        backdrop.style.display = "block";
        overlay.style.display = "block";
        iframe.focus();
        postDeckState(node);
    };
    if (ready) {
        rehydrate().then(reveal);
    } else {
        reveal();
    }
}

/** Chip body / +N: show the panel for this node; never closes it (the Browse Styles button still toggles). */
function showStyleBrowserFor(node) {
    if (overlay && overlay.style.display === "block" && currentNode === node) {
        iframe?.focus();
        return;
    }
    openStyleBrowser(node);
}

/**
 * SG_UNAPPLY: take one style out of the node by (source_file, name). With no
 * source_file the name must resolve to one ledger entry or one catalog row.
 * toast: where failures are reported (the panel, or the host for a chip on a node the panel is not showing).
 */
function unapplyFromMessage(node, msg, toast) {
    const name = msg.styleId || "style";
    let recorded = null;
    let cached = null;
    if (msg.source_file) {
        recorded = appliedByNode.get(node)?.get(styleKey(name, msg.source_file));
        cached = resolveStyleRow(name, msg.source_file).row;
    } else {
        const ledgerHits = [];
        const byKey = appliedByNode.get(node);
        if (byKey) {
            for (const entry of byKey.values()) {
                if (entry.name === name) ledgerHits.push(entry);
            }
        }
        if (ledgerHits.length === 1) {
            recorded = ledgerHits[0];
        } else {
            const r = resolveStyleRow(name, "");
            if (r.status === "unique") {
                cached = r.row;
            } else if (r.status === "ambiguous") {
                toast(
                    `Could not remove "${name}": the same name exists in several packs; select a source in the panel and remove it there.`
                );
                return;
            }
        }
    }
    if (recorded || cached) {
        unapplyStyleFromNode(node, {
            name,
            source_file: recorded
                ? (recorded.source_file || "")
                : (cached.source_file || ""),
            prompt: recorded ? recorded.prompt : (cached.prompt || ""),
            negative_prompt: recorded
                ? recorded.negative_prompt
                : (cached.negative_prompt || ""),
        });
    } else {
        const message =
            `Could not remove ${name}: style data not found; check the prompt text manually`;
        console.warn(`[Style Grid] ${message}`);
        toast(message);
    }
}

let sgWarningsListenerRegistered = false;

app.registerExtension({
    name: "StyleGrid.Browser",
    setup() {
        if (sgWarningsListenerRegistered) return;
        sgWarningsListenerRegistered = true;
        api.addEventListener("executed", (ev) => {
            const detail = ev.detail;
            const warnings = detail?.output?.sg_warnings;
            if (!Array.isArray(warnings) || !warnings.length) return;
            const node = app.graph?.getNodeById(Number(detail.node));
            if (node?.comfyClass !== "StyleGridNode") return;
            const toast = app.extensionManager?.toast;
            if (toast?.add) {
                toast.add({
                    severity: "warn",
                    summary: "Style Grid",
                    detail: warnings.join("\n"),
                    life: 8000,
                });
            } else {
                console.warn("[Style Grid]", ...warnings);
            }
        });
    },
    async nodeCreated(node) {
        if (node.comfyClass !== "StyleGridNode") return;
        const { seed, index } = getDeckWidgets(node);
        hideWidget(node.widgets?.find((w) => w.name === "active_source"));
        hideWidget(seed);
        hideWidget(index);
        hookDeckWidgetCallbacks(node);
        guardDeckWidgetSerialization(node);
        addNodeChips(node);
        node.addWidget("button", "Browse Styles", null, () => openStyleBrowser(node));

        // User-created nodes only get nodeCreated (not loadedGraphNode). Give them an
        // empty ledger so applies persist. Loaded nodes: onConfigure may replace it;
        // loadedGraphNode demotes to legacy when the workflow has no LEDGER_FIELD.
        appliedByNode.set(node, new Map());
        node.__sgLedgerFromWorkflow = false;

        const prevSerialize = node.onSerialize;
        node.onSerialize = function (o) {
            prevSerialize?.apply(this, arguments);
            if (appliedByNode.has(this)) {
                o[LEDGER_FIELD] = serializeLedger(appliedByNode.get(this).values());
            }
        };
        const prevConfigure = node.onConfigure;
        node.onConfigure = function (o) {
            prevConfigure?.apply(this, arguments);
            const entries = parseLedger(o?.[LEDGER_FIELD]);
            if (entries !== null) {
                appliedByNode.set(
                    this,
                    new Map(entries.map((e) => [styleKey(e.name, e.source_file), e])),
                );
                this.__sgLedgerFromWorkflow = true;
            } else {
                this.__sgLedgerFromWorkflow = false;
            }
            // Load, undo/redo (a graph reload), paste and clone all configure the node.
            refreshNodeChips(this, { fit: true });
        };
    },
    loadedGraphNode(node) {
        if (node.comfyClass !== "StyleGridNode") return;
        repairRestoredWidgets(node.widgets || []);
        guardDeckWidgetSerialization(node);
        // Loaded workflow node without sg_applied: treat as legacy (no ledger).
        if (!node.__sgLedgerFromWorkflow) {
            appliedByNode.delete(node);
        }
        // onConfigure ran before the legacy demotion above; legacy nodes derive their chips from the catalog.
        refreshNodeChips(node, { fit: true });
    },
});
