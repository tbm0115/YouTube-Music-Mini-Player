import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeTheme, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { createTray } from './tray.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_WINDOW_BOUNDS = { width: 800, height: 600 };
const DEFAULT_MINI_WINDOW_BOUNDS = { width: 350, height: 250 };
const MINI_WINDOW_MARGIN = 24;
const PLAYBACK_SYNC_INTERVAL_MS = 1000;
const VISUALIZER_SYNC_INTERVAL_MS = 1000 / 30;
const VISUALIZER_FREQUENCY_BINS = 96;
const VISUALIZER_WAVEFORM_SAMPLES = 160;
const RENDERER_REQUEST_TIMEOUT_MS = 1500;
const THUMBAR_REFRESH_DELAYS_MS = [0, 150, 600];
const DEBUG_DIAGNOSTICS = process.env.YTMMP_DEBUG_DIAGNOSTICS === '1' || process.env.YTMMP_SELF_TEST === '1';
const RUN_SELF_TEST = process.env.YTMMP_SELF_TEST === '1';
const DEFAULT_TRACK_DETAILS = Object.freeze({
    title: 'YouTube Music',
    artist: 'Waiting for playback',
    album: '',
    artwork: [],
});

const store = new Store();

let mainWindow;
let miniWindow;
let tray;
let playbackSyncInterval = null;
let visualizerSyncInterval = null;
let hasShownTrayBalloon = false;
let isMainWindowRendererReady = false;
let rendererRequestCounter = 0;
let hasRunSelfTest = false;
let thumbarRefreshTimeouts = [];
let playbackState = {
    isPlaying: false,
    trackDetails: DEFAULT_TRACK_DETAILS,
};
let latestVisualizerFrame = createEmptyVisualizerFrame();
const pendingRendererRequests = new Map();

let iconColor = 'light';
let playIconPath = path.join(__dirname, 'assets/Play_light.png');
let pauseIconPath = path.join(__dirname, 'assets/Pause_light.png');
let previousIconPath = path.join(__dirname, 'assets/Previous_light.png');
let nextIconPath = path.join(__dirname, 'assets/Next_light.png');

function debugLog(...args) {
    if (DEBUG_DIAGNOSTICS) {
        console.error('[ytmmp main]', ...args);
    }
}

async function logMainWindowDomProbe(reason) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    try {
        const probe = await mainWindow.webContents.executeJavaScript(`
            (() => {
                const playButton = document.querySelector('#play-pause-button, .play-pause-button');
                const previousButton = document.querySelector('#previous-button, .previous-button');
                const nextButton = document.querySelector('#next-button, .next-button');
                const mediaElement = document.querySelector('audio, video');
                const titleElement = document.querySelector('.title.ytmusic-player-bar, ytmusic-player-bar .title');
                const bylineElement = document.querySelector('.byline.ytmusic-player-bar, ytmusic-player-bar .byline');

                return {
                    href: window.location.href,
                    readyState: document.readyState,
                    hasMediaSession: Boolean(navigator.mediaSession),
                    playButton: playButton ? {
                        title: playButton.getAttribute('title'),
                        ariaLabel: playButton.getAttribute('aria-label'),
                        disabled: Boolean(playButton.disabled),
                    } : null,
                    previousButton: previousButton ? {
                        title: previousButton.getAttribute('title'),
                        ariaLabel: previousButton.getAttribute('aria-label'),
                        disabled: Boolean(previousButton.disabled),
                    } : null,
                    nextButton: nextButton ? {
                        title: nextButton.getAttribute('title'),
                        ariaLabel: nextButton.getAttribute('aria-label'),
                        disabled: Boolean(nextButton.disabled),
                    } : null,
                    mediaElement: mediaElement ? {
                        tagName: mediaElement.tagName,
                        paused: mediaElement.paused,
                        ended: mediaElement.ended,
                        currentTime: mediaElement.currentTime,
                        duration: Number.isFinite(mediaElement.duration) ? mediaElement.duration : null,
                    } : null,
                    title: titleElement?.getAttribute('title') || titleElement?.textContent?.trim() || null,
                    byline: bylineElement?.getAttribute('title') || bylineElement?.textContent?.trim() || null,
                };
            })();
        `, true);
        debugLog(`dom-probe:${reason}`, probe);
    } catch (error) {
        console.error(`[ytmmp main] dom-probe:${reason}:error`, serializeRendererError(error));
    }
}

function createEmptyVisualizerFrame() {
    return {
        timestamp: 0,
        frequencyData: Array(VISUALIZER_FREQUENCY_BINS).fill(0),
        waveform: Array(VISUALIZER_WAVEFORM_SAMPLES).fill(0),
        energy: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        peak: 0,
        beat: 0,
    };
}

function normalizeVisualizerFrame(frame = {}) {
    const normalizedFrame = createEmptyVisualizerFrame();

    normalizedFrame.timestamp = Number.isFinite(frame.timestamp)
        ? frame.timestamp
        : normalizedFrame.timestamp;
    normalizedFrame.frequencyData = Array.isArray(frame.frequencyData) && frame.frequencyData.length
        ? frame.frequencyData.map((value) => clampNumber(value))
        : normalizedFrame.frequencyData;
    normalizedFrame.waveform = Array.isArray(frame.waveform) && frame.waveform.length
        ? frame.waveform.map((value) => clampNumber(value, -1, 1))
        : normalizedFrame.waveform;
    normalizedFrame.energy = clampNumber(frame.energy);
    normalizedFrame.bass = clampNumber(frame.bass);
    normalizedFrame.mid = clampNumber(frame.mid);
    normalizedFrame.treble = clampNumber(frame.treble);
    normalizedFrame.peak = clampNumber(frame.peak);
    normalizedFrame.beat = clampNumber(frame.beat);

    return normalizedFrame;
}

function clampNumber(value, min = 0, max = 1) {
    const numericValue = Number.isFinite(value) ? value : 0;
    return Math.min(max, Math.max(min, numericValue));
}

function setThemedIcons() {
    iconColor = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    playIconPath = path.join(__dirname, `assets/Play_${iconColor}.png`);
    pauseIconPath = path.join(__dirname, `assets/Pause_${iconColor}.png`);
    previousIconPath = path.join(__dirname, `assets/Previous_${iconColor}.png`);
    nextIconPath = path.join(__dirname, `assets/Next_${iconColor}.png`);
}

function getStoredBounds(key, fallbackBounds) {
    return {
        ...fallbackBounds,
        ...store.get(key, {}),
    };
}

function getNormalWindowBounds() {
    return getStoredBounds('windowBounds', DEFAULT_WINDOW_BOUNDS);
}

function getMiniWindowBounds() {
    const storedBounds = getStoredBounds('miniWindowBounds', DEFAULT_MINI_WINDOW_BOUNDS);
    const normalizedStoredBounds = storedBounds.width === 320 && storedBounds.height === 320
        ? {
            ...storedBounds,
            width: DEFAULT_MINI_WINDOW_BOUNDS.width,
            height: DEFAULT_MINI_WINDOW_BOUNDS.height,
        }
        : storedBounds;
    const hasStoredPosition = Number.isFinite(normalizedStoredBounds.x) && Number.isFinite(normalizedStoredBounds.y);

    if (hasStoredPosition) {
        return normalizedStoredBounds;
    }

    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);

    return {
        ...DEFAULT_MINI_WINDOW_BOUNDS,
        x: display.workArea.x + display.workArea.width - DEFAULT_MINI_WINDOW_BOUNDS.width - MINI_WINDOW_MARGIN,
        y: display.workArea.y + display.workArea.height - DEFAULT_MINI_WINDOW_BOUNDS.height - MINI_WINDOW_MARGIN,
    };
}

function normalizeTrackDetails(trackDetails = {}) {
    const artworkSource = Array.isArray(trackDetails.artwork)
        ? trackDetails.artwork[0]?.src
        : '';

    return {
        title: trackDetails.title || DEFAULT_TRACK_DETAILS.title,
        artist: trackDetails.artist || DEFAULT_TRACK_DETAILS.artist,
        album: trackDetails.album || DEFAULT_TRACK_DETAILS.album,
        artwork: artworkSource
            ? [
                {
                    src: artworkSource,
                    sizes: trackDetails.artwork?.[0]?.sizes || '544x544',
                    type: trackDetails.artwork?.[0]?.type || 'image/png',
                },
            ]
            : [],
    };
}

function serializeRendererError(error) {
    if (!error) {
        return 'Unknown renderer error';
    }

    if (typeof error === 'string') {
        return error;
    }

    return error.stack || error.message || String(error);
}

function getPlaybackStateFallback() {
    return {
        isPlaying: playbackState.isPlaying,
        trackDetails: playbackState.trackDetails,
    };
}

function getVisualizerFrameFallback() {
    return latestVisualizerFrame;
}

function clearPendingRendererRequests(errorMessage) {
    for (const [requestId, pendingRequest] of pendingRendererRequests.entries()) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({
            ok: false,
            error: errorMessage,
            data: pendingRequest.fallbackData,
        });
        pendingRendererRequests.delete(requestId);
    }
}

function requestMainWindowRenderer(kind, fallbackData) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.resolve({
            ok: false,
            error: 'Main window is unavailable.',
            data: fallbackData,
        });
    }

    if (!isMainWindowRendererReady) {
        return Promise.resolve({
            ok: false,
            error: `Main window renderer is not ready for ${kind}.`,
            data: fallbackData,
        });
    }

    return new Promise((resolve) => {
        const requestId = rendererRequestCounter += 1;
        const timeoutId = setTimeout(() => {
            pendingRendererRequests.delete(requestId);
            resolve({
                ok: false,
                error: `Renderer request timed out for ${kind}.`,
                data: fallbackData,
            });
        }, RENDERER_REQUEST_TIMEOUT_MS);

        pendingRendererRequests.set(requestId, {
            resolve,
            timeoutId,
            fallbackData,
        });

        mainWindow.webContents.send('ytmmp:request', {
            requestId,
            kind,
        });
    });
}

function requestMainWindowAction(action, fallbackData) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.resolve({
            ok: false,
            error: 'Main window is unavailable.',
            data: fallbackData,
        });
    }

    if (!isMainWindowRendererReady) {
        return Promise.resolve({
            ok: false,
            error: `Main window renderer is not ready for action ${action}.`,
            data: fallbackData,
        });
    }

    return new Promise((resolve) => {
        const requestId = rendererRequestCounter += 1;
        const timeoutId = setTimeout(() => {
            pendingRendererRequests.delete(requestId);
            resolve({
                ok: false,
                error: `Renderer action timed out for ${action}.`,
                data: fallbackData,
            });
        }, RENDERER_REQUEST_TIMEOUT_MS);

        pendingRendererRequests.set(requestId, {
            resolve,
            timeoutId,
            fallbackData,
        });

        mainWindow.webContents.send('ytmmp:action', {
            requestId,
            action,
        });
    });
}

function ensureMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
    }

    return mainWindow;
}

function ensureMiniWindow() {
    if (!miniWindow || miniWindow.isDestroyed()) {
        createMiniWindow();
    }

    return miniWindow;
}

function persistMainWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
        return;
    }

    const bounds = mainWindow.getBounds();
    if (bounds.width <= 100 || bounds.height <= 100) {
        return;
    }

    store.set('windowBounds', bounds);
}

function persistMiniWindowBounds() {
    if (!miniWindow || miniWindow.isDestroyed() || !miniWindow.isVisible()) {
        return;
    }

    const bounds = miniWindow.getBounds();
    if (bounds.width <= 100 || bounds.height <= 100) {
        return;
    }

    store.set('miniWindowBounds', bounds);
}

function sendPlaybackStateToMiniWindow() {
    if (!miniWindow || miniWindow.isDestroyed()) {
        return;
    }

    miniWindow.webContents.send('mini-window:playback-state', playbackState);
}

function sendVisualizerFrameToMiniWindow() {
    if (!miniWindow || miniWindow.isDestroyed()) {
        return;
    }

    miniWindow.webContents.send('mini-window:visualizer-frame', latestVisualizerFrame);
}

function clearThumbarRefreshTimeouts() {
    thumbarRefreshTimeouts.forEach((timeoutId) => {
        clearTimeout(timeoutId);
    });
    thumbarRefreshTimeouts = [];
}

function scheduleThumbarRefresh() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    clearThumbarRefreshTimeouts();
    thumbarRefreshTimeouts = THUMBAR_REFRESH_DELAYS_MS.map((delayMs) => setTimeout(() => {
        updateThumbarButtons();
    }, delayMs));
}

function stopVisualizerFrameSync() {
    if (visualizerSyncInterval) {
        clearInterval(visualizerSyncInterval);
        visualizerSyncInterval = null;
    }
}

function hideMainWindowToTray({ showBalloon = false } = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    clearThumbarRefreshTimeouts();
    mainWindow.setAlwaysOnTop(false);
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);

    if (showBalloon && tray && process.platform === 'win32' && !hasShownTrayBalloon) {
        tray.displayBalloon({
            title: 'YouTube Music Mini Player',
            content: 'The app is running in the system tray.',
        });
        hasShownTrayBalloon = true;
    }
}

function hideMiniWindowToTray() {
    if (!miniWindow || miniWindow.isDestroyed()) {
        return;
    }

    stopVisualizerFrameSync();
    miniWindow.hide();
}

function hideAllToTray({ showBalloon = false } = {}) {
    hideMiniWindowToTray();
    hideMainWindowToTray({ showBalloon });
}

function showMainWindow() {
    const window = ensureMainWindow();

    hideMiniWindowToTray();
    window.setAlwaysOnTop(false);
    window.setSkipTaskbar(false);
    window.setBounds(getNormalWindowBounds());
    window.show();
    window.focus();
    scheduleThumbarRefresh();
}

function startVisualizerFrameSync() {
    if (visualizerSyncInterval) {
        return;
    }

    void syncVisualizerFrame();
    visualizerSyncInterval = setInterval(() => {
        void syncVisualizerFrame();
    }, VISUALIZER_SYNC_INTERVAL_MS);
}

function showMiniWindow() {
    ensureMainWindow();
    const window = ensureMiniWindow();

    hideMainWindowToTray();
    window.setAlwaysOnTop(true);
    window.setBounds(getMiniWindowBounds());
    window.show();
    window.focus();
    sendPlaybackStateToMiniWindow();
    sendVisualizerFrameToMiniWindow();
    startVisualizerFrameSync();
}

function toggleMiniWindowMode() {
    if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
        showMainWindow();
        return;
    }

    showMiniWindow();
}

function isAnyWindowVisible() {
    const mainVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    const miniVisible = Boolean(miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible());
    return mainVisible || miniVisible;
}

function updatePlaybackState(nextState = {}) {
    playbackState = {
        isPlaying: Boolean(nextState.isPlaying),
        trackDetails: normalizeTrackDetails(nextState.trackDetails),
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
        const title = `${playbackState.trackDetails.title} - ${playbackState.trackDetails.artist}`;
        mainWindow.setTitle(title);
    }

    updateThumbarButtons();
    sendPlaybackStateToMiniWindow();
}

async function syncPlaybackState() {
    if (!mainWindow || mainWindow.isDestroyed() || !isMainWindowRendererReady) {
        return;
    }

    try {
        const result = await requestMainWindowRenderer('getPlaybackState', getPlaybackStateFallback());
        if (!result.ok) {
            console.error('Error syncing playback state:', result.error);
        }
        updatePlaybackState(result.data);
    } catch (error) {
        console.error('Error syncing playback state:', serializeRendererError(error));
    }
}

async function syncVisualizerFrame() {
    if (!mainWindow || mainWindow.isDestroyed() || !isMainWindowRendererReady) {
        return;
    }

    try {
        const result = await requestMainWindowRenderer('getVisualizerFrame', getVisualizerFrameFallback());
        if (!result.ok) {
            console.error('Error syncing visualizer frame:', result.error);
        }
        latestVisualizerFrame = normalizeVisualizerFrame(result.data);
        sendVisualizerFrameToMiniWindow();
    } catch (error) {
        console.error('Error syncing visualizer frame:', serializeRendererError(error));
    }
}

function startPlaybackStateSync() {
    if (playbackSyncInterval) {
        clearInterval(playbackSyncInterval);
    }

    void syncPlaybackState();
    playbackSyncInterval = setInterval(() => {
        void syncPlaybackState();
    }, PLAYBACK_SYNC_INTERVAL_MS);
}

async function executePlaybackAction(action) {
    ensureMainWindow();

    try {
        debugLog('executePlaybackAction:start', action);
        const fallbackData = {
            playbackState: getPlaybackStateFallback(),
            visualizerFrame: getVisualizerFrameFallback(),
        };
        const result = await requestMainWindowAction(action, fallbackData);

        if (!result.ok) {
            console.error(`Error executing playback action "${action}":`, result.error);
        }

        updatePlaybackState(result.data?.playbackState || getPlaybackStateFallback());
        latestVisualizerFrame = normalizeVisualizerFrame(
            result.data?.visualizerFrame || getVisualizerFrameFallback(),
        );
        sendVisualizerFrameToMiniWindow();
        debugLog('executePlaybackAction:finish', action, {
            ok: result.ok,
            error: result.error,
            playbackState: result.data?.playbackState || getPlaybackStateFallback(),
        });
        return Boolean(result.ok);
    } catch (error) {
        console.error(`Error executing playback action "${action}":`, serializeRendererError(error));
        return false;
    }
}

async function runSelfTest() {
    if (!RUN_SELF_TEST || hasRunSelfTest) {
        return;
    }

    hasRunSelfTest = true;
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

    debugLog('self-test:start');
    let inspectResult = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        inspectResult = await requestMainWindowRenderer('inspectControls', null);
        debugLog('self-test:inspect-poll', attempt + 1, inspectResult);

        if (inspectResult.ok
            && inspectResult.data?.readyState === 'complete'
            && inspectResult.data?.buttons?.playPause?.found
            && inspectResult.data?.metadata?.title) {
            break;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 500);
        });
    }

    debugLog('self-test:inspect-before', inspectResult);

    const actionResult = await executePlaybackAction('togglePlayPause');
    debugLog('self-test:toggle-result', actionResult);

    await sleep(1200);

    let visualizerResult = null;
    let analyzerResult = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!isMainWindowRendererReady) {
            debugLog('self-test:post-toggle-waiting-for-renderer', attempt + 1);
            await sleep(500);
            continue;
        }

        visualizerResult = await requestMainWindowRenderer('getVisualizerFrame', null);
        analyzerResult = await requestMainWindowRenderer('inspectAnalyzer', null);
        debugLog('self-test:visualizer-poll', attempt + 1, {
            visualizerResult,
            analyzerResult,
        });

        const framePeak = visualizerResult?.data?.peak ?? 0;
        const frameEnergy = visualizerResult?.data?.energy ?? 0;
        const rawPeak = analyzerResult?.data?.lastRawPeak ?? 0;

        if ((visualizerResult?.ok || analyzerResult?.ok) && (framePeak > 0.01 || frameEnergy > 0.01 || rawPeak > 0.01)) {
            break;
        }

        await sleep(500);
    }

    await syncPlaybackState();
    await syncVisualizerFrame();
    const inspectAfterResult = await requestMainWindowRenderer('inspectControls', null);
    debugLog('self-test:inspect-after', inspectAfterResult);
    debugLog('self-test:playback-state-after', playbackState);
    debugLog('self-test:visualizer-frame-after', {
        timestamp: latestVisualizerFrame.timestamp,
        energy: latestVisualizerFrame.energy,
        bass: latestVisualizerFrame.bass,
        peak: latestVisualizerFrame.peak,
    });
    debugLog('self-test:analyzer-after', analyzerResult);

    hideAllToTray();
    await sleep(400);
    const trayActionResult = await executePlaybackAction('togglePlayPause');
    debugLog('self-test:tray-toggle-result', trayActionResult);
    await sleep(800);
    await syncPlaybackState();
    debugLog('self-test:tray-playback-state-after', playbackState);
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow;
    }

    isMainWindowRendererReady = false;
    mainWindow = new BrowserWindow({
        ...getNormalWindowBounds(),
        icon: path.join(__dirname, 'assets', 'favicon_144.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });

    mainWindow.loadURL('https://music.youtube.com');

    mainWindow.on('closed', () => {
        mainWindow = null;
        isMainWindowRendererReady = false;
        clearPendingRendererRequests('Main window renderer was destroyed.');
        if (playbackSyncInterval) {
            clearInterval(playbackSyncInterval);
            playbackSyncInterval = null;
        }
        stopVisualizerFrameSync();
    });

    mainWindow.on('show', () => {
        scheduleThumbarRefresh();
    });
    mainWindow.on('focus', () => {
        scheduleThumbarRefresh();
    });
    mainWindow.on('restore', () => {
        scheduleThumbarRefresh();
    });

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        hideAllToTray({ showBalloon: true });
    });

    mainWindow.on('move', persistMainWindowBounds);
    mainWindow.on('resize', persistMainWindowBounds);
    mainWindow.webContents.on('did-start-loading', () => {
        debugLog('did-start-loading');
    });
    mainWindow.webContents.on('did-finish-load', () => {
        debugLog('did-finish-load');
        scheduleThumbarRefresh();
        void logMainWindowDomProbe('did-finish-load');
    });
    mainWindow.webContents.on('dom-ready', () => {
        debugLog('dom-ready');
        void logMainWindowDomProbe('dom-ready');
    });
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        debugLog('console-message', { level, message, line, sourceId });
    });

    startPlaybackStateSync();
    return mainWindow;
}

function createMiniWindow() {
    if (miniWindow && !miniWindow.isDestroyed()) {
        return miniWindow;
    }

    miniWindow = new BrowserWindow({
        ...getMiniWindowBounds(),
        minWidth: 260,
        minHeight: 180,
        frame: false,
        resizable: true,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#05070a',
        icon: path.join(__dirname, 'assets', 'favicon_144.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'mini-window-preload.cjs'),
        },
    });

    miniWindow.loadFile(path.join(__dirname, 'mini-window.html'));

    miniWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            hideMiniWindowToTray();
        }
    });

    miniWindow.on('closed', () => {
        miniWindow = null;
        stopVisualizerFrameSync();
    });

    miniWindow.on('move', persistMiniWindowBounds);
    miniWindow.on('resize', persistMiniWindowBounds);
    miniWindow.webContents.on('did-finish-load', () => {
        sendPlaybackStateToMiniWindow();
        sendVisualizerFrameToMiniWindow();
    });

    return miniWindow;
}

function updateThumbarButtons() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const playPauseIcon = playbackState.isPlaying ? pauseIconPath : playIconPath;

    const wasApplied = mainWindow.setThumbarButtons([
        {
            tooltip: 'Previous Track',
            icon: previousIconPath,
            click: () => {
                void executePlaybackAction('pressPrevious');
            },
        },
        {
            tooltip: playbackState.isPlaying ? 'Pause' : 'Play',
            icon: playPauseIcon,
            click: () => {
                void executePlaybackAction('togglePlayPause');
            },
        },
        {
            tooltip: 'Next Track',
            icon: nextIconPath,
            click: () => {
                void executePlaybackAction('pressNext');
            },
        },
    ]);
    debugLog('setThumbarButtons', { wasApplied, isVisible: mainWindow.isVisible() });
}

Menu.setApplicationMenu(null);
setThemedIcons();

app.whenReady().then(() => {
    createMainWindow();

    tray = createTray({
        app,
        showMainWindow,
        showMiniWindow,
        hideAllToTray,
        executePlaybackAction,
        isAnyWindowVisible,
    });

    globalShortcut.register('CmdOrCtrl+M', () => {
        toggleMiniWindowMode();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    showMainWindow();
});

ipcMain.on('mini-window:hide', () => {
    hideMiniWindowToTray();
});

ipcMain.on('ytmmp:renderer-ready', () => {
    isMainWindowRendererReady = true;
    debugLog('renderer-ready');
    void syncPlaybackState();
    if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
        void syncVisualizerFrame();
    }
    void runSelfTest();
});

ipcMain.on('ytmmp:response', (_event, payload = {}) => {
    debugLog('renderer-response', payload);
    const pendingRequest = pendingRendererRequests.get(payload.requestId);
    if (!pendingRequest) {
        return;
    }

    clearTimeout(pendingRequest.timeoutId);
    pendingRendererRequests.delete(payload.requestId);
    pendingRequest.resolve({
        ok: Boolean(payload.ok),
        error: payload.error || null,
        data: payload.data ?? pendingRequest.fallbackData,
    });
});

ipcMain.handle('mini-window:get-playback-state', () => {
    return playbackState;
});

ipcMain.handle('mini-window:get-visualizer-frame', () => {
    return latestVisualizerFrame;
});

ipcMain.handle('mini-window:toggle-playback', async () => {
    await executePlaybackAction('togglePlayPause');
    return playbackState;
});

app.on('before-quit', () => {
    app.isQuitting = true;
    isMainWindowRendererReady = false;
    clearPendingRendererRequests('Application is quitting.');
    if (playbackSyncInterval) {
        clearInterval(playbackSyncInterval);
        playbackSyncInterval = null;
    }
    stopVisualizerFrameSync();

    globalShortcut.unregisterAll();
    tray?.destroy();
});

nativeTheme.on('updated', () => {
    setThemedIcons();
    scheduleThumbarRefresh();
});
