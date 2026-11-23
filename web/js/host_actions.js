/**
 * Style Grid (ComfyUI) — host actions behind iframe messages that change node
 * state: Clear, catalog refresh, style rename, preview upload.
 *
 * Kept free of ComfyUI imports (all I/O and the per-node ledger are injected)
 * so they can be unit-tested; style_grid.js wires the real dependencies.
 *
 * A ledger is a Map<styleKey, {name, source_file, prompt, negative_prompt}>
 * per node (styleKey = "<source_file>\0<name>", as the iframe's styleRowKey).
 */

const STYLE_KEY_SEP = "\0";

export function ledgerKey(name, sourceFile) {
    return `${sourceFile || ""}${STYLE_KEY_SEP}${name}`;
}

/**
 * Node-scoped panel state (wildcards, applied styles, selection) goes to the
 * iframe only for the node the panel is bound to; another node's change must
 * not overwrite the panel's view of the current node.
 *
 * @param {*} node the node whose state changed
 * @param {*} currentNode the node the panel is open for (or null)
 * @returns {boolean}
 */
export function shouldSyncPanel(node, currentNode) {
    return node != null && node === currentNode;
}

function textWidgets(node) {
    return {
        text: node?.widgets?.find((w) => w.name === "text"),
        neg: node?.widgets?.find((w) => w.name === "negative_text"),
    };
}

/**
 * SG_CLEAR_ALL: empty both prompt widgets of the node entirely (the user's own
 * text too), empty its applied-style ledger (kept as an empty Map so the node
 * is not treated as legacy), refresh the active wildcards and the iframe
 * selection. No node → nothing happens.
 *
 * @param {object|null} node
 * @param {{
 *   setLedger: function(*, Map): void,
 *   syncWildcards: function(*): void,
 *   post: function(*): void,
 * }} deps
 * @returns {boolean} true when a node was cleared
 */
export function clearNodePrompts(node, deps) {
    if (!node) return false;
    const { text, neg } = textWidgets(node);
    if (text) text.value = "";
    if (neg) neg.value = "";
    node.graph?.setDirtyCanvas(true, true);
    deps.setLedger(node, new Map());
    deps.syncWildcards(node);
    deps.post({ type: "SG_CLEAR_SELECTION" });
    return true;
}

/**
 * SG_STYLE_RENAMED: the rename route already moved the CSV row, thumbnail,
 * favorites and presets. Move every node's ledger entry of
 * (source_file, old_name) to new_name. A same-named style of another source is
 * never touched. Widget text holds the style's tags, not its name, so it stays
 * as it is. Insertion order of each ledger is kept.
 *
 * @param {Iterable<object>} nodes
 * @param {{old_name: string, new_name: string, source_file: string}} msg
 * @param {{getLedger: function(*): (Map|undefined), setLedger: function(*, Map): void}} deps
 * @returns {object[]} the nodes whose ledger changed
 */
export function renameLedgerEntries(nodes, msg, deps) {
    const oldKey = ledgerKey(msg.old_name, msg.source_file);
    const changed = [];
    for (const node of nodes) {
        const ledger = deps.getLedger(node);
        if (!ledger || !ledger.has(oldKey)) continue;
        const next = new Map();
        for (const [key, entry] of ledger) {
            if (key === oldKey) {
                const renamed = { ...entry, name: msg.new_name };
                next.set(ledgerKey(renamed.name, renamed.source_file), renamed);
            } else if (!next.has(key)) {
                next.set(key, entry);
            }
        }
        deps.setLedger(node, next);
        node.graph?.setDirtyCanvas(true, true);
        changed.push(node);
    }
    return changed;
}

/** WebUI's toast for styles that left the library while applied. */
export function vanishedToastMessage(names) {
    return names.length === 1
        ? `Style "${names[0]}" is no longer in the library; its text was removed from the prompt.`
        : `${names.length} styles are no longer in the library; their text was removed from the prompt.`;
}

/**
 * SG_REFRESH (and the refresh after SG_STYLE_RENAMED): reload the catalog,
 * post SG_STYLES_UPDATE (WebUI shape: {type, styles}), then drop from the
 * current node's ledger every entry whose (source_file, name) left the catalog
 * and strip its text from the widgets. The toast is skipped when
 * quiet_vanished (the iframe deleted the style on purpose) or when no text
 * changed. Entries without a source_file are left alone: they cannot be
 * matched to one row.
 *
 * @param {{quiet_vanished?: boolean}} opts
 * @param {{
 *   fetchStyles: function(): Promise<object[]>,
 *   setCatalog: function(object[]): void,
 *   post: function(*): void,
 *   currentNode: function(): (object|null),
 *   getLedger: function(*): (Map|undefined),
 *   unapply: function(*, *): void,
 *   syncWildcards: function(*): void,
 *   toast: function(string): void,
 * }} deps
 * @returns {Promise<{styles: object[], vanished: string[]}>}
 */
export async function refreshCatalog(opts, deps) {
    const styles = await deps.fetchStyles();
    deps.setCatalog(styles);
    deps.post({ type: "SG_STYLES_UPDATE", styles });

    const node = deps.currentNode();
    const ledger = node ? deps.getLedger(node) : undefined;
    if (!node || !ledger) return { styles, vanished: [] };

    const present = new Set(styles.map((s) => ledgerKey(s.name, s.source_file)));
    const gone = [...ledger.values()].filter(
        (entry) => entry.source_file && !present.has(ledgerKey(entry.name, entry.source_file)),
    );
    if (!gone.length) return { styles, vanished: [] };

    const { text, neg } = textWidgets(node);
    const before = [text?.value || "", neg?.value || ""];
    for (const entry of gone) deps.unapply(node, entry);
    const after = [text?.value || "", neg?.value || ""];
    deps.syncWildcards(node);
    const textChanged = before[0] !== after[0] || before[1] !== after[1];
    const names = gone.map((e) => e.name);
    if (textChanged && !opts?.quiet_vanished) deps.toast(vanishedToastMessage(names));
    return { styles, vanished: names };
}

/**
 * SG_UPLOAD_PREVIEW: ask for an image, POST it to /style_grid/thumbnail/upload
 * under (name, source), then post SG_THUMB_DONE so the panel shows it. A
 * cancelled picker does nothing; failures post an error SG_TOAST.
 *
 * @param {{styleId: string, source: string}} msg
 * @param {{
 *   pickImageDataUrl: function(): Promise<(string|null)>,
 *   postJson: function(string, object): Promise<object>,
 *   post: function(*): void,
 *   now: function(): number,
 * }} deps
 * @returns {Promise<boolean>} true when a preview was stored
 */
export async function uploadPreview(msg, deps) {
    const image = await deps.pickImageDataUrl();
    if (!image) return false;
    let result;
    try {
        result = await deps.postJson("/style_grid/thumbnail/upload", {
            name: msg.styleId,
            image,
            source: msg.source,
        });
    } catch {
        deps.post({ type: "SG_TOAST", message: "Upload failed", variant: "error" });
        return false;
    }
    if (!result || !result.ok) {
        deps.post({
            type: "SG_TOAST",
            message: `Upload failed: ${(result && result.error) || "?"}`,
            variant: "error",
        });
        return false;
    }
    deps.post({
        type: "SG_THUMB_DONE",
        styleId: msg.styleId,
        version: deps.now(),
        source_file: msg.source,
    });
    return true;
}
