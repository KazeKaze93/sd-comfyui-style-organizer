import { app } from "/scripts/app.js";

const IFRAME_SRC = "/extensions/sd-comfyui-style-organizer/ui/index.html";

let overlay = null;
let backdrop = null;
let iframe = null;
let ready = false;
let currentNode = null;
let allStylesCache = [];
/** node → Map<styleName, { prompt, negative_prompt }> written at apply time. */
const appliedByNode = new Map();

function closeStyleBrowser() {
    if (backdrop) backdrop.style.display = "none";
    if (overlay) overlay.style.display = "none";
}

function parseTags(str) {
    return (str || "").split(",").map((t) => t.trim()).filter(Boolean);
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
        parseTags(s).filter((t) => !/^\{sg:[^}]+\}$/i.test(t)).join(", ");
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

function buildSgToken(category, spec) {
    const cat = String(category || "").toLowerCase();
    const sp = spec == null ? "" : String(spec);
    return "{sg:" + cat + (sp ? ":" + sp : "") + "}";
}

function insertWildcardCategory(node, category) {
    const { text } = getTextWidgets(node);
    if (!text) return;
    const token = `{sg:${category}}`;
    const already = parseTags(text.value || "").some(
        (t) => t.toLowerCase() === token.toLowerCase()
    );
    if (already) return;
    text.value = mergeTagsIntoText(text.value || "", token);
    node.graph?.setDirtyCanvas(true, true);
    syncWildcards(node);
}

function extractWildcardCategories(str) {
    return [...(str || "").matchAll(/\{sg:([^}]+)\}/gi)].map((m) => m[1].trim());
}

function activeWildcardCategories(text, negativeText) {
    const all = [...extractWildcardCategories(text), ...extractWildcardCategories(negativeText)];
    const seen = new Set();
    const result = [];
    for (const c of all) {
        const key = c.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(c);
        }
    }
    return result;
}

function syncWildcards(node) {
    const { text, neg } = getTextWidgets(node);
    const categories = activeWildcardCategories(text ? text.value || "" : "", neg ? neg.value || "" : "");
    iframe.contentWindow.postMessage({ type: "SG_WILDCARDS_ACTIVE", categories }, "*");
}

function removeWildcardCategory(node, category) {
    const { text, neg } = getTextWidgets(node);
    const token = `{sg:${category}}`.toLowerCase();
    const strip = (s) => parseTags(s).filter((t) => t.toLowerCase() !== token).join(", ");
    if (text) text.value = strip(text.value || "");
    if (neg) neg.value = strip(neg.value || "");
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
        "background:#111",
    ].join(";");

    iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
    iframe.src = `${IFRAME_SRC}?t=${Date.now()}`;

    overlay.appendChild(iframe);
    document.body.appendChild(backdrop);
    document.body.appendChild(overlay);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay.style.display !== "none") {
            closeStyleBrowser();
        }
    }, true);

    window.addEventListener("message", (e) => {
        if (e.source !== iframe.contentWindow) return;
        const msg = e.data;
        if (!msg || typeof msg.type !== "string") return;

        if (msg.type === "SG_READY") {
            ready = true;
            rehydrate();
        }
        if (msg.type === "SG_APPLY" && currentNode) {
            applyStyleToNode(currentNode, { name: msg.styleId, prompt: msg.prompt, negative_prompt: msg.neg });
        }
        if (msg.type === "SG_UNAPPLY" && currentNode) {
            const recorded = appliedByNode.get(currentNode)?.get(msg.styleId);
            const cached = allStylesCache.find((s) => s.name === msg.styleId);
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
            insertWildcardCategory(currentNode, msg.category);
        }
        if (msg.type === "SG_CLEAR_ALL" && currentNode) {
            clearAllStyles(currentNode);
        }
        if (msg.type === "SG_REMOVE_WILDCARD" && currentNode) {
            removeWildcardCategory(currentNode, msg.category);
        }
        if (msg.type === "SG_REORDER_STYLES" && currentNode) {
            reorderStylesInNode(currentNode, msg.styleIds);
        }
        if (msg.type === "SG_SOURCE_CHANGE" && currentNode) {
            setActiveSource(currentNode, msg.source);
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
    ensureOverlay();
    if (ready) {
        rehydrate().then(() => {
            backdrop.style.display = "block";
            overlay.style.display = "block";
        });
    } else {
        backdrop.style.display = "block";
        overlay.style.display = "block";
    }
}

app.registerExtension({
    name: "StyleGrid.Browser",
    async nodeCreated(node) {
        if (node.comfyClass !== "StyleGridNode") return;
        const sourceWidget = node.widgets?.find((w) => w.name === "active_source");
        if (sourceWidget) {
            sourceWidget.computeSize = () => [0, -4];
        }
        node.addWidget("button", "Browse Styles", null, () => openStyleBrowser(node));
    },
});
