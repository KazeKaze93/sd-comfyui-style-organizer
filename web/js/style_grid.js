import { app } from "/scripts/app.js";

const IFRAME_SRC = "/extensions/sd-comfyui-style-organizer/ui/index.html";

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
/** node → Map<styleName, { prompt, negative_prompt }> written at apply time. */
const appliedByNode = new Map();

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
        iframe.contentWindow.postMessage({ type: "SG_THEME", mode: currentTheme }, "*");
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

function parseTags(str) {
    return splitTopLevelCommas(str).map((t) => t.trim()).filter(Boolean);
}

function tagKey(tag) {
    const m = tag.match(/^\((.+?):\d+\.?\d*\)$/);
    return (m ? m[1] : tag).trim().toLowerCase();
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

function styleTagsPresent(baseText, requirement) {
    if (!requirement) return true;
    const keys = new Set(parseTags(baseText).map(tagKey));
    return parseTags(requirement).every((t) => keys.has(tagKey(t)));
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

function styleTextPresent(baseText, template) {
    if (!template) return true;
    if (template.includes("{prompt}")) {
        const [rawPrefix, rawSuffix] = template.split("{prompt}");
        const prefix = (rawPrefix || "").replace(/,\s*$/, "").trim();
        const suffix = (rawSuffix || "").replace(/^,\s*/, "").trim();
        const t = baseText.trim();
        if (!t) return false;
        const prefixOk = !prefix || t.indexOf(prefix) === 0;
        const suffixOk = !suffix || t.lastIndexOf(suffix) === t.length - suffix.length;
        return prefixOk && suffixOk;
    }
    return styleTagsPresent(baseText, template);
}

/** True when the style has real prompt/neg content and both sides match the widgets. */
function styleIsPresent(text, negativeText, style) {
    const prompt = style.prompt || "";
    const neg = style.negative_prompt || "";
    // Empty-template rows (no pos and no neg) must never auto-select via rehydrate.
    if (!prompt && !neg) return false;
    return styleTextPresent(text, prompt) && styleTextPresent(negativeText, neg);
}

function getTextWidgets(node) {
    return {
        text: node?.widgets?.find((w) => w.name === "text"),
        neg: node?.widgets?.find((w) => w.name === "negative_text"),
    };
}

const DECK_SEED_WIDGET = "deck_seed";
const DECK_INDEX_WIDGET = "deck_index";
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

function toDeckNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function postDeckState(node) {
    if (!ready || !iframe?.contentWindow || node !== currentNode) return;
    const { seed, index } = getDeckWidgets(node);
    if (!seed || !index) return;
    iframe.contentWindow.postMessage(
        { type: "SG_DECK_STATE", seed: toDeckNumber(seed.value), index: toDeckNumber(index.value) },
        "*"
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

function getActiveStyles(text, negativeText, excludeName) {
    return allStylesCache.filter((s) => {
        if (s.name === excludeName) return false;
        return styleIsPresent(text, negativeText, s);
    });
}

function isWrapStyle(style) {
    return (style.prompt || "").includes("{prompt}") ||
        (style.negative_prompt || "").includes("{prompt}");
}

function applyStyleToNode(node, style) {
    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";

    // Nesting a second {prompt}-wrap puts the new prefix/suffix on the
    // boundaries, so removeStyleText can no longer find the inner wrap.
    if (isWrapStyle(style)) {
        const activeWrap = getActiveStyles(currentText, currentNeg, style.name)
            .find(isWrapStyle);
        if (activeWrap) {
            const message = "Only one {prompt}-wrap style can be active at a time";
            console.warn(`[Style Grid] ${message} (blocked: ${style.name}; active: ${activeWrap.name})`);
            if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage(
                    { type: "SG_TOAST", message, variant: "info" },
                    "*"
                );
            }
            return;
        }
    }

    if (text) text.value = applyStyleText(currentText, style.prompt || "");
    if (neg) neg.value = applyStyleText(currentNeg, style.negative_prompt || "");
    node.graph?.setDirtyCanvas(true, true);

    let byName = appliedByNode.get(node);
    if (!byName) {
        byName = new Map();
        appliedByNode.set(node, byName);
    }
    byName.set(style.name, {
        prompt: style.prompt || "",
        negative_prompt: style.negative_prompt || "",
    });
}

function unapplyStyleFromNode(node, style) {
    const recorded = appliedByNode.get(node)?.get(style.name);
    const prompt = recorded ? recorded.prompt : (style.prompt || "");
    const negTpl = recorded ? recorded.negative_prompt : (style.negative_prompt || "");

    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";
    const others = getActiveStyles(currentText, currentNeg, style.name);
    const protectPos = others.flatMap((s) => parseTags(s.prompt || ""));
    const protectNeg = others.flatMap((s) => parseTags(s.negative_prompt || ""));
    if (text) text.value = removeStyleText(currentText, prompt, protectPos);
    if (neg) neg.value = removeStyleText(currentNeg, negTpl, protectNeg);
    node.graph?.setDirtyCanvas(true, true);

    appliedByNode.get(node)?.delete(style.name);
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
    const activeStyles = getActiveStyles(currentText, currentNeg, null).filter(isReorderable);
    const activeByName = new Map(activeStyles.map((s) => [s.name, s]));

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
            const style = activeByName.get(id);
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

function clearAllStyles(node) {
    const { text, neg } = getTextWidgets(node);
    let currentText = text ? text.value || "" : "";
    let currentNeg = neg ? neg.value || "" : "";

    const stripWildcards = (s) =>
        parseTags(s).filter((t) => !/^\{sgd?:[^}]+\}$/i.test(t)).join(", ");
    currentText = stripWildcards(currentText);
    currentNeg = stripWildcards(currentNeg);

    for (const style of getActiveStyles(currentText, currentNeg, null)) {
        currentText = removeStyleText(currentText, style.prompt || "", []);
        currentNeg = removeStyleText(currentNeg, style.negative_prompt || "", []);
    }

    if (text) text.value = currentText;
    if (neg) neg.value = currentNeg;
    node.graph?.setDirtyCanvas(true, true);
    syncWildcards(node);
    appliedByNode.delete(node);
    if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: "SG_CLEAR_SELECTION" }, "*");
    }
}

// Slice tokens contain commas inside their spec, so any naive .split(",") over prompt text shreds them.
function splitTopLevelCommas(s) {
    if (!s || !String(s).trim()) return [];
    const str = String(s);
    const parts = [];
    let parenDepth = 0;
    let braceDepth = 0;
    let cur = "";
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "(") parenDepth++;
        else if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
        else if (c === "{") braceDepth++;
        else if (c === "}") braceDepth = Math.max(0, braceDepth - 1);
        if (c === "," && parenDepth === 0 && braceDepth === 0) {
            if (cur.trim()) parts.push(cur.trim());
            cur = "";
        } else {
            cur += c;
        }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

const WILDCARD_KIND_DICE = "sg";
const WILDCARD_KIND_DECK = "sgd";

function normalizeWildcardKind(kind) {
    return String(kind || "").trim().toLowerCase() === WILDCARD_KIND_DECK
        ? WILDCARD_KIND_DECK
        : WILDCARD_KIND_DICE;
}

function parseSgInner(inner) {
    const s = String(inner || "");
    const idx = s.indexOf(":");
    if (idx === -1) {
        return { category: s.trim().toLowerCase(), spec: "" };
    }
    return {
        category: s.slice(0, idx).trim().toLowerCase(),
        spec: s.slice(idx + 1).trim(),
    };
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
}

function extractWildcardCategories(str) {
    return [...(str || "").matchAll(/\{(sgd?):([^}]+)\}/gi)].map((m) => {
        const parsed = parseSgInner(m[2]);
        return {
            category: parsed.category,
            spec: parsed.spec,
            kind: normalizeWildcardKind(m[1]),
            token: m[0],
        };
    });
}

function activeWildcardCategories(text, negativeText) {
    const all = [...extractWildcardCategories(text), ...extractWildcardCategories(negativeText)];
    const seen = new Set();
    const result = [];
    for (const entry of all) {
        const key =
            String(entry.category || "").toLowerCase() +
            "\0" +
            String(entry.spec || "").toLowerCase() +
            "\0" +
            normalizeWildcardKind(entry.kind);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(entry);
        }
    }
    return result;
}

function syncWildcards(node) {
    const { text, neg } = getTextWidgets(node);
    const categories = activeWildcardCategories(
        text ? text.value || "" : "",
        neg ? neg.value || "" : ""
    ).map((entry) => ({ category: entry.category, spec: entry.spec, kind: normalizeWildcardKind(entry.kind) }));
    iframe.contentWindow.postMessage({ type: "SG_WILDCARDS_ACTIVE", categories }, "*");
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
}

function setActiveSource(node, source) {
    const w = node?.widgets?.find((w) => w.name === "active_source");
    if (!w) return;
    w.value = source || "";
    node.graph?.setDirtyCanvas(true, true);
}

function rehydrate() {
    return fetch("/style_grid/styles")
        .then((r) => r.json())
        .then((data) => {
            allStylesCache = Object.values(data.categories || {}).flat();
            iframe.contentWindow.postMessage({
                type: "SG_INIT",
                styles: allStylesCache,
            }, "*");
            iframe.contentWindow.postMessage({ type: "SG_CLEAR_SELECTION" }, "*");

            if (!currentNode) return;
            const { text, neg } = getTextWidgets(currentNode);
            const currentText = text ? text.value || "" : "";
            const currentNeg = neg ? neg.value || "" : "";
            for (const style of allStylesCache) {
                if (styleIsPresent(currentText, currentNeg, style)) {
                    iframe.contentWindow.postMessage({ type: "SG_STYLE_APPLIED", style }, "*");
                }
            }
            syncWildcards(currentNode);
        });
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
        const msg = e.data;
        if (!msg || typeof msg.type !== "string") return;

        if (msg.type === "SG_READY") {
            ready = true;
            postTheme();
            postDeckState(currentNode);
            rehydrate();
        }
        if (msg.type === "SG_APPLY" && currentNode) {
            applyStyleToNode(currentNode, {
                name: msg.styleId,
                prompt: msg.prompt,
                negative_prompt: msg.neg,
                source_file: msg.source_file || "",
            });
        }
        if (msg.type === "SG_UNAPPLY" && currentNode) {
            const recorded = appliedByNode.get(currentNode)?.get(msg.styleId);
            const cached = allStylesCache.find((s) => {
                if (s.name !== msg.styleId) return false;
                if (!msg.source_file) return true;
                return String(s.source_file || "") === String(msg.source_file);
            });
            if (recorded || cached) {
                unapplyStyleFromNode(currentNode, {
                    name: msg.styleId,
                    prompt: recorded ? recorded.prompt : (cached.prompt || ""),
                    negative_prompt: recorded
                        ? recorded.negative_prompt
                        : (cached.negative_prompt || ""),
                });
            } else {
                const name = msg.styleId || "style";
                const message =
                    `Could not remove ${name} — style data not found; check the prompt text manually`;
                console.warn(`[Style Grid] ${message}`);
                if (iframe?.contentWindow) {
                    iframe.contentWindow.postMessage(
                        { type: "SG_TOAST", message, variant: "info" },
                        "*"
                    );
                }
            }
        }
        if (msg.type === "SG_WILDCARD_CATEGORY" && currentNode) {
            insertWildcardCategory(currentNode, msg.category, "", msg.kind);
        }
        if (msg.type === "SG_WILDCARD_SLICE" && currentNode) {
            insertWildcardCategory(currentNode, msg.category, msg.spec || "", msg.kind);
        }
        if (msg.type === "SG_CLEAR_ALL" && currentNode) {
            clearAllStyles(currentNode);
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
    if (currentNode !== node) {
        appliedByNode.clear();
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

app.registerExtension({
    name: "StyleGrid.Browser",
    async nodeCreated(node) {
        if (node.comfyClass !== "StyleGridNode") return;
        const { seed, index } = getDeckWidgets(node);
        hideWidget(node.widgets?.find((w) => w.name === "active_source"));
        hideWidget(seed);
        hideWidget(index);
        hookDeckWidgetCallbacks(node);
        node.addWidget("button", "Browse Styles", null, () => openStyleBrowser(node));
    },
});
