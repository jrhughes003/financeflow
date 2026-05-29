// Preload script: the only bridge between renderer and main. Exposes a minimal,
// explicit API on window.api with contextIsolation on — no Node globals leak
// into the renderer.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  db: {
    loadAll: () => ipcRenderer.invoke('db:loadAll'),
    saveAll: (state) => ipcRenderer.invoke('db:saveAll', state),
    isInitialized: () => ipcRenderer.invoke('db:isInitialized'),
    markInitialized: () => ipcRenderer.invoke('db:markInitialized'),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    clearKey: () => ipcRenderer.invoke('ai:clearKey'),
    run: (feature, input) => ipcRenderer.invoke('ai:run', feature, input),
  },
});
