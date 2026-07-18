import { app } from "/scripts/app.js";

const IFRAME_SRC = "/extensions/sd-comfyui-style-organizer/ui/index.html";

let overlay = null;
let iframe = null;

function closeStyleBrowser() {
    if (overlay) overlay.style.display = "none";
}

function openStyleBrowser() {
    if (!overlay) {
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

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "\u00d7";
        closeBtn.title = "Close";
        closeBtn.style.cssText = [
            "position:absolute",
            "top:6px",
            "right:8px",
            "z-index:1",
            "background:transparent",
            "border:none",
            "color:#ccc",
            "font-size:20px",
            "cursor:pointer",
            "line-height:1",
        ].join(";");
        closeBtn.addEventListener("click", closeStyleBrowser);

        iframe = document.createElement("iframe");
        iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
        // index.html itself is not content-hashed by Vite (only assets/ are), so bust its
        // own cache on every open.
        iframe.src = `${IFRAME_SRC}?t=${Date.now()}`;

        overlay.appendChild(closeBtn);
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
    }
    overlay.style.display = "block";
}

app.registerExtension({
    name: "StyleGrid.Browser",
    async nodeCreated(node) {
        if (node.comfyClass !== "StyleGridNode") return;
        node.addWidget("button", "Browse Styles", null, openStyleBrowser);
    },
});
