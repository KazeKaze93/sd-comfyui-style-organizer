import { app } from "/scripts/app.js";

const IFRAME_SRC = "/extensions/sd-comfyui-style-organizer/ui/index.html";

let overlay = null;
let iframe = null;
let ready = false;
let currentNode = null;
let allStylesCache = [];

function closeStyleBrowser() {
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
        return template.replace("{prompt}", baseText);
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

function getTextWidgets(node) {
    return {
        text: node?.widgets?.find((w) => w.name === "text"),
        neg: node?.widgets?.find((w) => w.name === "negative_text"),
    };
}

function getActiveStyles(text, negativeText, excludeName) {
    return allStylesCache.filter((s) => {
        if (s.name === excludeName) return false;
        return styleTextPresent(text, s.prompt || "") &&
               styleTextPresent(negativeText, s.negative_prompt || "");
    });
}

function applyStyleToNode(node, style) {
    const { text, neg } = getTextWidgets(node);
    if (text) text.value = applyStyleText(text.value || "", style.prompt || "");
    if (neg) neg.value = applyStyleText(neg.value || "", style.negative_prompt || "");
    node.graph?.setDirtyCanvas(true, true);
}

function unapplyStyleFromNode(node, style) {
    const { text, neg } = getTextWidgets(node);
    const currentText = text ? text.value || "" : "";
    const currentNeg = neg ? neg.value || "" : "";
    const others = getActiveStyles(currentText, currentNeg, style.name);
    const protectPos = others.flatMap((s) => parseTags(s.prompt || ""));
    const protectNeg = others.flatMap((s) => parseTags(s.negative_prompt || ""));
    if (text) text.value = removeStyleText(currentText, style.prompt || "", protectPos);
    if (neg) neg.value = removeStyleText(currentNeg, style.negative_prompt || "", protectNeg);
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
                tab: String(currentNode?.id ?? ""),
                styles: allStylesCache,
            }, "*");
            iframe.contentWindow.postMessage({ type: "SG_CLEAR_SELECTION" }, "*");

            if (!currentNode) return;
            const { text, neg } = getTextWidgets(currentNode);
            const currentText = text ? text.value || "" : "";
            const currentNeg = neg ? neg.value || "" : "";
            for (const style of allStylesCache) {
                const present = styleTextPresent(currentText, style.prompt || "") &&
                                 styleTextPresent(currentNeg, style.negative_prompt || "");
                if (present) {
                    iframe.contentWindow.postMessage({ type: "SG_STYLE_APPLIED", style }, "*");
                }
            }
            syncWildcards(currentNode);
        });
}

function ensureOverlay() {
    if (overlay) return;

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
        "z-index:10000",
        "display:none",
        "overflow:hidden",
        "resize:both",
        "background:#111",
    ].join(";");

    iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
    iframe.src = `${IFRAME_SRC}?t=${Date.now()}`;

    overlay.appendChild(iframe);
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
            const style = allStylesCache.find((s) => s.name === msg.styleId);
            if (style) unapplyStyleFromNode(currentNode, style);
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
    currentNode = node;
    ensureOverlay();
    if (ready) {
        rehydrate().then(() => {
            overlay.style.display = "block";
        });
    } else {
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
