/**
 * Style Grid (ComfyUI) — runtime guard for iframe → host messages.
 *
 * Mirrors the WebUI host's parseFrameMessage (javascript/style_grid/post-message.js):
 * a type allowlist plus a shape check per type. Unknown types and malformed
 * payloads return null and are ignored by the dispatcher. Extra fields are
 * dropped. Kept free of ComfyUI imports so it can be unit-tested.
 *
 * Not accepted here (the ComfyUI host has no use for them): LoRA and tab
 * messages, preview generation (SG_GENERATE_PREVIEW, SG_GENERATE_CATEGORY_PREVIEWS,
 * SG_BATCH_CANCEL, SG_BATCH_SKIP) and SG_SET_FULLSCREEN (the panel resizes
 * its own frame).
 */

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}

function isOptionalString(value) {
    return value === undefined || typeof value === "string";
}

function isWildcardKind(kind) {
    return kind === undefined || kind === "sg" || kind === "sgd";
}

/** Every type the dispatcher handles, in one place. */
export const FRAME_MESSAGE_TYPES = Object.freeze([
    "SG_READY",
    "SG_CLOSE_REQUEST",
    "SG_CLEAR_ALL",
    "SG_DECK_RESTART",
    "SG_DECK_NEW",
    "SG_REFRESH",
    "SG_APPLY",
    "SG_UNAPPLY",
    "SG_UPLOAD_PREVIEW",
    "SG_WILDCARD_CATEGORY",
    "SG_WILDCARD_SLICE",
    "SG_REMOVE_WILDCARD",
    "SG_REORDER_STYLES",
    "SG_REORDER_WILDCARDS",
    "SG_SOURCE_CHANGE",
    "SG_STYLE_RENAMED",
]);

/**
 * @param {unknown} data
 * @returns {Record<string, unknown> | null}
 */
export function parseFrameMessage(data) {
    if (!isRecord(data)) return null;
    const type = data.type;
    if (typeof type !== "string" || !type.startsWith("SG_")) return null;

    switch (type) {
        case "SG_READY":
        case "SG_CLOSE_REQUEST":
        case "SG_CLEAR_ALL":
        case "SG_DECK_RESTART":
        case "SG_DECK_NEW":
            return { type };

        case "SG_REFRESH":
            // quiet_vanished: the iframe removed a style on purpose (delete), so the
            // "no longer in the library" toast must not appear.
            if (data.quiet_vanished !== undefined && typeof data.quiet_vanished !== "boolean") {
                return null;
            }
            return { type, quiet_vanished: data.quiet_vanished === true };

        case "SG_APPLY":
            if (!isNonEmptyString(data.styleId)) return null;
            if (typeof data.prompt !== "string") return null;
            if (typeof data.neg !== "string") return null;
            if (typeof data.source_file !== "string") return null;
            return {
                type,
                styleId: data.styleId,
                prompt: data.prompt,
                neg: data.neg,
                source_file: data.source_file,
            };

        case "SG_UNAPPLY":
            if (!isNonEmptyString(data.styleId)) return null;
            if (!isOptionalString(data.source_file)) return null;
            return { type, styleId: data.styleId, source_file: data.source_file };

        case "SG_UPLOAD_PREVIEW":
            if (!isNonEmptyString(data.styleId)) return null;
            if (typeof data.source !== "string") return null;
            return { type, styleId: data.styleId, source: data.source };

        case "SG_WILDCARD_CATEGORY":
            if (!isNonEmptyString(data.category)) return null;
            if (!isWildcardKind(data.kind)) return null;
            return { type, category: data.category, kind: data.kind };

        case "SG_WILDCARD_SLICE":
        case "SG_REMOVE_WILDCARD":
            if (!isNonEmptyString(data.category)) return null;
            if (typeof data.spec !== "string") return null;
            if (!isWildcardKind(data.kind)) return null;
            return { type, category: data.category, spec: data.spec, kind: data.kind };

        case "SG_REORDER_STYLES":
            if (!Array.isArray(data.styleIds)) return null;
            if (!data.styleIds.every((id) => typeof id === "string")) return null;
            return { type, styleIds: data.styleIds };

        case "SG_REORDER_WILDCARDS":
            if (!Array.isArray(data.categories)) return null;
            return { type, categories: data.categories };

        case "SG_SOURCE_CHANGE":
            if (!(data.source === null || typeof data.source === "string")) return null;
            return { type, source: data.source };

        case "SG_STYLE_RENAMED":
            if (!isNonEmptyString(data.old_name)) return null;
            if (!isNonEmptyString(data.new_name)) return null;
            if (typeof data.source_file !== "string") return null;
            return {
                type,
                old_name: data.old_name,
                new_name: data.new_name,
                source_file: data.source_file,
            };

        default:
            return null;
    }
}
