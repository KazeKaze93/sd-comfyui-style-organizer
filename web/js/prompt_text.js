/**
 * Style Grid (ComfyUI) — pure prompt-text helpers: tag parsing, style presence
 * in the node text, wildcard tokens. No ComfyUI imports and no side effects at
 * import time (ComfyUI loads every .js under web/js), so ui/ tests load it directly.
 */

export function parseTags(str) {
    return splitTopLevelCommas(str).map((t) => t.trim()).filter(Boolean);
}

export function tagKey(tag) {
    const m = tag.match(/^\((.+?):\d+\.?\d*\)$/);
    return (m ? m[1] : tag).trim().toLowerCase();
}

export function styleTagsPresent(baseText, requirement) {
    if (!requirement) return true;
    const keys = new Set(parseTags(baseText).map(tagKey));
    return parseTags(requirement).every((t) => keys.has(tagKey(t)));
}

export function styleTextPresent(baseText, template) {
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
export function styleIsPresent(text, negativeText, style) {
    const prompt = style.prompt || "";
    const neg = style.negative_prompt || "";
    // Empty-template rows (no pos and no neg) must never auto-select via rehydrate.
    if (!prompt && !neg) return false;
    return styleTextPresent(text, prompt) && styleTextPresent(negativeText, neg);
}

// Slice tokens contain commas inside their spec, so any naive .split(",") over prompt text shreds them.
export function splitTopLevelCommas(s) {
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

export const WILDCARD_KIND_DICE = "sg";
export const WILDCARD_KIND_DECK = "sgd";

export function normalizeWildcardKind(kind) {
    return String(kind || "").trim().toLowerCase() === WILDCARD_KIND_DECK
        ? WILDCARD_KIND_DECK
        : WILDCARD_KIND_DICE;
}

export function parseSgInner(inner) {
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

export function extractWildcardCategories(str) {
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

export function activeWildcardCategories(text, negativeText) {
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
