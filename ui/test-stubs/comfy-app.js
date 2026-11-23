// Test stand-in for ComfyUI's /scripts/app.js (aliased in vite.config.ts, tests only).
// Each fresh import (vi.resetModules) gives a new app; tests reach it through
// globalThis.__sgComfyStub because "/scripts/app.js" is not resolvable from TypeScript.
const registered = [];

export const app = {
    registerExtension(extension) {
        registered.push(extension);
    },
    graph: {
        _nodes: [],
        getNodeById(id) {
            return this._nodes.find((n) => n.id === id) || null;
        },
    },
    extensionManager: {
        toast: { add() {} },
        workflow: { activeWorkflow: { changeTracker: { captureCanvasState() {} } } },
    },
};

globalThis.__sgComfyStub = { app, registered };
