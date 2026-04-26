const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const { createAudioAnalyzer } = require(path.join(__dirname, 'audio-analyzer.cjs'));

const BRIDGE_NAME = 'ytMusicMiniPlayerControls';
const audioAnalyzer = createAudioAnalyzer();
const DEBUG_DIAGNOSTICS = process.env.YTMMP_DEBUG_DIAGNOSTICS === '1' || process.env.YTMMP_SELF_TEST === '1';
const PLAY_PAUSE_BUTTON_SELECTORS = [
    '.play-pause-button',
    'tp-yt-paper-icon-button.play-pause-button',
    'button[title="Play"]',
    'button[title="Pause"]',
    'button[aria-label="Play"]',
    'button[aria-label="Pause"]',
];
const PREVIOUS_BUTTON_SELECTORS = [
    '.previous-button',
    'tp-yt-paper-icon-button.previous-button',
    'button[title="Previous song"]',
    'button[aria-label="Previous song"]',
];
const NEXT_BUTTON_SELECTORS = [
    '.next-button',
    'tp-yt-paper-icon-button.next-button',
    'button[title="Next song"]',
    'button[aria-label="Next song"]',
];
const TITLE_SELECTORS = [
    '.title.ytmusic-player-bar',
    'ytmusic-player-bar .title',
];
const BYLINE_SELECTORS = [
    '.byline.ytmusic-player-bar',
    'ytmusic-player-bar .byline',
];
const ARTWORK_SELECTORS = [
    '#song-image img.yt-img-shadow',
    'ytmusic-player-bar #song-image img',
];

function debugLog(...args) {
    if (DEBUG_DIAGNOSTICS) {
        console.log('[ytmmp preload]', ...args);
    }
}

function findFirstElement(selectors) {
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            return element;
        }
    }

    return null;
}

function dispatchElementClick(element) {
    if (!element) {
        return false;
    }

    element.focus?.();
    if (typeof element.click === 'function') {
        element.click();
    } else {
        element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
        }));
    }

    audioAnalyzer.resume();
    return true;
}

function findAndClickButton(selectors, label) {
    const button = findFirstElement(selectors);
    if (dispatchElementClick(button)) {
        return true;
    }

    console.error(`${label} button not found.`);
    return false;
}

function getMediaElement() {
    return document.querySelector('video, audio');
}

function readElementLabel(element) {
    return element?.getAttribute('title')
        || element?.getAttribute('aria-label')
        || element?.textContent?.trim()
        || '';
}

function pressPlayButton() {
    return findAndClickButton(PLAY_PAUSE_BUTTON_SELECTORS, 'play/pause');
}

function pressPreviousButton() {
    return findAndClickButton(PREVIOUS_BUTTON_SELECTORS, 'previous');
}

function pressNextButton() {
    return findAndClickButton(NEXT_BUTTON_SELECTORS, 'next');
}

async function togglePlayPause() {
    const mediaElement = getMediaElement();
    if (!mediaElement) {
        return pressPlayButton();
    }

    audioAnalyzer.resume();

    if (mediaElement.paused || mediaElement.ended) {
        try {
            await mediaElement.play();
            return true;
        } catch (error) {
            console.error('Unable to play media element directly:', error);
            return pressPlayButton();
        }
    }

    mediaElement.pause();
    return true;
}

function isPlaying() {
    const mediaElement = getMediaElement();
    if (mediaElement) {
        return !mediaElement.paused && !mediaElement.ended;
    }

    const playPauseButton = findFirstElement(PLAY_PAUSE_BUTTON_SELECTORS);
    return /pause/i.test(readElementLabel(playPauseButton));
}

function splitArtistAndAlbum(artistAlbum = '') {
    const [artist = '', album = ''] = artistAlbum.split(/\s[\u2022\u00B7]\s/u);
    return {
        artist,
        album,
    };
}

function getMediaSessionTrackDetails() {
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata) {
        return null;
    }

    const artwork = Array.from(metadata.artwork || []);
    return {
        title: metadata.title || '',
        artist: metadata.artist || '',
        album: metadata.album || '',
        artwork,
    };
}

function getCurrentTrackDetails() {
    const mediaSessionDetails = getMediaSessionTrackDetails();
    const titleElement = findFirstElement(TITLE_SELECTORS);
    const bylineElement = findFirstElement(BYLINE_SELECTORS);
    const artworkElement = findFirstElement(ARTWORK_SELECTORS);
    const domTitle = readElementLabel(titleElement);
    const domByline = readElementLabel(bylineElement);
    const domArtworkUrl = artworkElement?.currentSrc || artworkElement?.src || '';
    const splitByline = splitArtistAndAlbum(domByline);
    const artworkUrl = domArtworkUrl || mediaSessionDetails?.artwork?.[0]?.src || '';
    const title = domTitle || mediaSessionDetails?.title || 'Unknown Title';
    const artist = splitByline.artist || mediaSessionDetails?.artist || 'Unknown Artist';
    const album = splitByline.album || mediaSessionDetails?.album || 'Unknown Album';

    return {
        title,
        artist,
        album,
        artwork: artworkUrl
            ? [
                {
                    src: artworkUrl,
                    sizes: artworkElement?.sizes || mediaSessionDetails?.artwork?.[0]?.sizes || '544x544',
                    type: mediaSessionDetails?.artwork?.[0]?.type || 'image/png',
                },
            ]
            : [],
    };
}

function getPlaybackState() {
    return {
        isPlaying: isPlaying(),
        trackDetails: getCurrentTrackDetails(),
    };
}

function getVisualizerFrame() {
    return audioAnalyzer.getSnapshot();
}

function inspectAnalyzer() {
    return audioAnalyzer.getDebugState();
}

function inspectControls() {
    const mediaElement = getMediaElement();
    const playPauseButton = findFirstElement(PLAY_PAUSE_BUTTON_SELECTORS);
    const previousButton = findFirstElement(PREVIOUS_BUTTON_SELECTORS);
    const nextButton = findFirstElement(NEXT_BUTTON_SELECTORS);
    const titleElement = findFirstElement(TITLE_SELECTORS);
    const bylineElement = findFirstElement(BYLINE_SELECTORS);
    const artworkElement = findFirstElement(ARTWORK_SELECTORS);

    return {
        location: window.location.href,
        readyState: document.readyState,
        mediaElement: mediaElement
            ? {
                tagName: mediaElement.tagName,
                paused: mediaElement.paused,
                ended: mediaElement.ended,
                currentTime: mediaElement.currentTime,
                duration: Number.isFinite(mediaElement.duration) ? mediaElement.duration : null,
                src: mediaElement.currentSrc || mediaElement.src || '',
            }
            : null,
        buttons: {
            playPause: {
                found: Boolean(playPauseButton),
                label: readElementLabel(playPauseButton),
                disabled: Boolean(playPauseButton?.disabled),
            },
            previous: {
                found: Boolean(previousButton),
                label: readElementLabel(previousButton),
                disabled: Boolean(previousButton?.disabled),
            },
            next: {
                found: Boolean(nextButton),
                label: readElementLabel(nextButton),
                disabled: Boolean(nextButton?.disabled),
            },
        },
        metadata: {
            title: readElementLabel(titleElement),
            byline: readElementLabel(bylineElement),
            artworkUrl: artworkElement?.currentSrc || artworkElement?.src || '',
        },
    };
}

function handleRendererRequest(payload = {}) {
    const { requestId, kind } = payload;
    if (!requestId || !kind) {
        return;
    }

    try {
        let data;
        switch (kind) {
        case 'getPlaybackState':
            data = getPlaybackState();
            break;
        case 'getVisualizerFrame':
            data = getVisualizerFrame();
            break;
        case 'inspectAnalyzer':
            data = inspectAnalyzer();
            break;
        case 'inspectControls':
            data = inspectControls();
            break;
        default:
            throw new Error(`Unsupported renderer request kind: ${kind}`);
        }

        debugLog('request', kind, data);
        ipcRenderer.send('ytmmp:response', {
            requestId,
            ok: true,
            data,
        });
    } catch (error) {
        ipcRenderer.send('ytmmp:response', {
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function handleRendererAction(payload = {}) {
    const { action, requestId } = payload;

    try {
        debugLog('action:start', action, inspectControls());
        let handled = false;
        switch (action) {
        case 'pressPlay':
        case 'togglePlayPause':
            handled = await togglePlayPause();
            break;
        case 'pressPrevious':
            handled = pressPreviousButton();
            break;
        case 'pressNext':
            handled = pressNextButton();
            break;
        default:
            throw new Error(`Unsupported playback action requested: ${action}`);
        }

        if (requestId) {
            ipcRenderer.send('ytmmp:response', {
                requestId,
                ok: handled,
                error: handled ? null : `Unable to execute playback action: ${action}`,
                data: {
                    action,
                    handled,
                    playbackState: getPlaybackState(),
                    visualizerFrame: getVisualizerFrame(),
                },
            });
        }

        debugLog('action:finish', action, {
            handled,
            playbackState: getPlaybackState(),
            controls: inspectControls(),
        });
        return handled;
    } catch (error) {
        if (requestId) {
            ipcRenderer.send('ytmmp:response', {
                requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                data: {
                    action,
                    handled: false,
                    playbackState: getPlaybackState(),
                    visualizerFrame: getVisualizerFrame(),
                },
            });
        } else {
            console.error(error);
        }

        return false;
    }
}

navigator.mediaSession.setActionHandler('play', () => {
    void togglePlayPause();
});

navigator.mediaSession.setActionHandler('pause', () => {
    void togglePlayPause();
});

navigator.mediaSession.setActionHandler('previoustrack', () => {
    pressPreviousButton();
});

navigator.mediaSession.setActionHandler('nexttrack', () => {
    pressNextButton();
});

contextBridge.exposeInMainWorld(BRIDGE_NAME, {
    pressPlay: () => pressPlayButton(),
    pressPrevious: () => pressPreviousButton(),
    pressNext: () => pressNextButton(),
    togglePlayPause: () => togglePlayPause(),
    isPlaying: () => isPlaying(),
    getCurrentTrackDetails: () => getCurrentTrackDetails(),
    getPlaybackState: () => getPlaybackState(),
    getVisualizerFrame: () => getVisualizerFrame(),
});

ipcRenderer.on('ytmmp:request', (_event, payload) => {
    handleRendererRequest(payload);
});

ipcRenderer.on('ytmmp:action', (_event, payload) => {
    void handleRendererAction(payload);
});

function updateMediaSessionMetadata() {
    const trackDetails = getCurrentTrackDetails();

    navigator.mediaSession.metadata = new MediaMetadata({
        title: trackDetails.title,
        artist: trackDetails.artist,
        album: trackDetails.album,
        artwork: trackDetails.artwork,
    });
}

audioAnalyzer.start();
debugLog('renderer-ready', inspectControls());
ipcRenderer.send('ytmmp:renderer-ready');
setInterval(updateMediaSessionMetadata, 1000);
