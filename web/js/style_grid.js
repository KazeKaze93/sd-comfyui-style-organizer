import { app } from "/scripts/app.js";

const IFRAME_SRC = "/extensions/sd-comfyui-style-organizer/ui/index.html";

let overlay = null;
let iframe = null;
let ready = false;
let currentNode = null;

function closeStyleBrowser() {
    if (overlay) overlay.style.display = "none";
}

function getAppliedStyles(node) {
    const w = node.widgets?.find((w) => w.name === "applied_styles");
    if (!w) return [];
    try {
        const parsed = JSON.parse(w.value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function setAppliedStyles(node, list) {
    const w = node.widgets?.find((w) => w.name === "applied_styles");
    if (!w) return;
    w.value = JSON.stringify(list);
    node.graph?.setDirtyCanvas(true, true);
}

function addAppliedStyle(node, styleId) {
    if (!node) return;
    const list = getAppliedStyles(node);
    if (!list.includes(styleId)) {
        list.push(styleId);
        setAppliedStyles(node, list);
    }
}

function removeAppliedStyle(node, styleId) {
    if (!node) return;
    setAppliedStyles(node, getAppliedStyles(node).filter((n) => n !== styleId));
}

function sendInit() {
    fetch("/style_grid/styles")
        .then((r) => r.json())
        .then((data) => {
            const allStyles = Object.values(data.categories || {}).flat();
            iframe.contentWindow.postMessage({
                type: "SG_INIT",
                tab: String(currentNode?.id ?? ""),
                styles: allStyles,
            }, "*");
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

    document.addEventListener("mousedown", (e) => {
        if (overlay.style.display !== "block") return;
        if (!overlay.contains(e.target)) closeStyleBrowser();
    }, true);

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
            sendInit();
        }
        if (msg.type === "SG_APPLY") {
            addAppliedStyle(currentNode, msg.styleId);
        }
        if (msg.type === "SG_UNAPPLY") {
            removeAppliedStyle(currentNode, msg.styleId);
        }
        if (msg.type === "SG_CLOSE_REQUEST") {
            closeStyleBrowser();
        }
    });
}

function openStyleBrowser(node) {
    currentNode = node;
    ensureOverlay();
    overlay.style.display = "block";
    if (ready) {
        iframe.contentWindow.postMessage({ type: "SG_CLEAR_SELECTION" }, "*");
        sendInit();
    }
}

app.registerExtension({
    name: "StyleGrid.Browser",
    async nodeCreated(node) {
        if (node.comfyClass !== "StyleGridNode") return;
        const appliedWidget = node.widgets?.find((w) => w.name === "applied_styles");
        if (appliedWidget) {
            appliedWidget.computeSize = () => [0, -4];
        }
        node.addWidget("button", "Browse Styles", null, () => openStyleBrowser(node));
    },
});
