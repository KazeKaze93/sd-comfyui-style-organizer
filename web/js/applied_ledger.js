/** Pure helpers for the per-node applied-style ledger (no ComfyUI imports). */

export const LEDGER_FIELD = "sg_applied";
export const LEDGER_VERSION = 1;

/**
 * @param {unknown} raw
 * @returns {Array<{name: string, source_file: string, prompt: string, negative_prompt: string}> | null}
 */
export function parseLedger(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = /** @type {Record<string, unknown>} */ (raw);
    if (obj.v !== LEDGER_VERSION) return null;
    if (!Array.isArray(obj.entries)) return null;
    /** @type {Array<{name: string, source_file: string, prompt: string, negative_prompt: string}>} */
    const out = [];
    for (const item of obj.entries) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const e = /** @type {Record<string, unknown>} */ (item);
        if (typeof e.name !== "string") continue;
        if (typeof e.source_file !== "string") continue;
        if (typeof e.prompt !== "string") continue;
        if (typeof e.negative_prompt !== "string") continue;
        out.push({
            name: e.name,
            source_file: e.source_file,
            prompt: e.prompt,
            negative_prompt: e.negative_prompt,
        });
    }
    return out;
}

/**
 * @param {Iterable<{name?: string, source_file?: string, prompt?: string, negative_prompt?: string}>} entriesIterable
 */
export function serializeLedger(entriesIterable) {
    const entries = [];
    for (const e of entriesIterable) {
        entries.push({
            name: e.name || "",
            source_file: e.source_file || "",
            prompt: e.prompt || "",
            negative_prompt: e.negative_prompt || "",
        });
    }
    return { v: LEDGER_VERSION, entries };
}

/**
 * Drop A when some B has A's key sets as subsets and is strictly larger on at least one side.
 * Identical key sets are both kept.
 * @template T
 * @param {T[]} present
 * @param {(style: T) => { pos: Set<string>, neg: Set<string> }} keysOf
 * @returns {T[]}
 */
export function subsumePresent(present, keysOf) {
    const keyed = present.map((style) => ({ style, keys: keysOf(style) }));
    return keyed
        .filter(({ keys: a }, i) => {
            for (let j = 0; j < keyed.length; j++) {
                if (i === j) continue;
                const b = keyed[j].keys;
                const posSub = isSubset(a.pos, b.pos);
                const negSub = isSubset(a.neg, b.neg);
                if (!posSub || !negSub) continue;
                const strict =
                    a.pos.size < b.pos.size || a.neg.size < b.neg.size;
                if (strict) return false;
            }
            return true;
        })
        .map(({ style }) => style);
}

/**
 * @template T
 * @param {T[]} entries
 * @param {(entry: T) => boolean} isPresent
 * @returns {{ kept: T[], dropped: T[] }}
 */
export function selectFromLedger(entries, isPresent) {
    /** @type {T[]} */
    const kept = [];
    /** @type {T[]} */
    const dropped = [];
    for (const entry of entries) {
        if (isPresent(entry)) kept.push(entry);
        else dropped.push(entry);
    }
    return { kept, dropped };
}

/**
 * @param {{ name: string, source_file: string, prompt: string, negative_prompt: string }} entry
 */
export function syntheticStyle(entry) {
    return {
        name: entry.name,
        prompt: entry.prompt,
        negative_prompt: entry.negative_prompt,
        source_file: entry.source_file,
        description: "",
        category: "",
        has_thumbnail: false,
        read_only: true,
    };
}

/** @param {Set<string>} a @param {Set<string>} b */
function isSubset(a, b) {
    for (const x of a) {
        if (!b.has(x)) return false;
    }
    return true;
}
