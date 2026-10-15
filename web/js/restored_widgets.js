// No frontend imports: ui/ tests load this module directly.

export const DECK_SEED_WIDGET = "deck_seed";
export const DECK_INDEX_WIDGET = "deck_index";
const SEED_WIDGET = "seed";

const CONTROL_DEFAULTS = new Map([
    [DECK_SEED_WIDGET, "fixed"],
    [DECK_INDEX_WIDGET, "increment"],
    [SEED_WIDGET, "randomize"],
]);

export function toWidgetInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Repair widget values restored from an older or misaligned workflow, in place. The frontend restores values by
 * position and every input was added after the previous last one, so a workflow saved before an input existed hands
 * the Browse Styles button's null to the first newer widget and leaves the ones after it at their defaults. */
export function repairRestoredWidgets(widgets) {
    for (const widget of widgets) {
        const fallbackMode = CONTROL_DEFAULTS.get(widget.name);
        if (!fallbackMode) continue;
        const clean = toWidgetInt(widget.value);
        if (widget.value !== clean) widget.value = clean;
        for (const linked of widget.linkedWidgets || []) {
            const allowed = linked.options?.values;
            if (Array.isArray(allowed) && !allowed.includes(linked.value)) {
                linked.value = fallbackMode;
            }
        }
    }
}
