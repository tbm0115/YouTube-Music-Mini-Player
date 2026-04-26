const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniWindow', {
    close: () => {
        ipcRenderer.send('mini-window:hide');
    },
    togglePlayPause: () => {
        return ipcRenderer.invoke('mini-window:toggle-playback');
    },
    getPlaybackState: () => {
        return ipcRenderer.invoke('mini-window:get-playback-state');
    },
    getVisualizerFrame: () => {
        return ipcRenderer.invoke('mini-window:get-visualizer-frame');
    },
    onPlaybackState: (listener) => {
        const handler = (_event, state) => {
            listener(state);
        };

        ipcRenderer.on('mini-window:playback-state', handler);
        return () => {
            ipcRenderer.removeListener('mini-window:playback-state', handler);
        };
    },
    onVisualizerFrame: (listener) => {
        const handler = (_event, frame) => {
            listener(frame);
        };

        ipcRenderer.on('mini-window:visualizer-frame', handler);
        return () => {
            ipcRenderer.removeListener('mini-window:visualizer-frame', handler);
        };
    },
});
