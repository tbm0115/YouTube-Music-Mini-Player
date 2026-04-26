import { CanvasVisualizerEngine, DEFAULT_VISUALIZER_ID, createVisualizerRegistry } from './visualizer-library.js';

const DISPLAY_MODE_ALBUM_ART = 'album-art';
const DISPLAY_MODE_VISUALIZER = 'visualizer';
const STORAGE_KEYS = {
    displayMode: 'miniWindowDisplayMode',
    visualizerId: 'miniWindowVisualizerId',
};

const shell = document.querySelector('.window-shell');
const canvas = document.getElementById('artwork-canvas');
const closeButton = document.getElementById('close-button');
const playbackButton = document.getElementById('playback-button');
const albumArtModeButton = document.getElementById('album-art-mode-button');
const visualizerModeButton = document.getElementById('visualizer-mode-button');
const visualizerPickerWrapper = document.getElementById('visualizer-picker-wrapper');
const visualizerPickerButton = document.getElementById('visualizer-picker-button');
const visualizerPickerLabel = document.getElementById('visualizer-picker-label');
const visualizerMenu = document.getElementById('visualizer-menu');
const context = canvas.getContext('2d');

const registry = createVisualizerRegistry();
const visualizerDefinitions = registry.list();

let playbackState = normalizePlaybackState();
let visualizerFrame = normalizeVisualizerFrame();
let currentDisplayMode = getStoredValue(STORAGE_KEYS.displayMode, DISPLAY_MODE_ALBUM_ART);
let currentVisualizerId = getStoredVisualizerId();
let artworkImage = null;
let artworkSource = '';
let artworkRequestToken = 0;
let isVisualizerMenuOpen = false;
let removePlaybackListener = null;
let removeVisualizerFrameListener = null;

const engine = new CanvasVisualizerEngine({
    canvas,
    registry,
    initialVisualizerId: currentVisualizerId,
});

function getStoredValue(key, fallbackValue) {
    try {
        return window.localStorage.getItem(key) || fallbackValue;
    } catch (_error) {
        return fallbackValue;
    }
}

function setStoredValue(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (_error) {
        // Ignore storage errors.
    }
}

function getStoredVisualizerId() {
    const storedValue = getStoredValue(STORAGE_KEYS.visualizerId, DEFAULT_VISUALIZER_ID);
    return visualizerDefinitions.some((definition) => definition.id === storedValue)
        ? storedValue
        : DEFAULT_VISUALIZER_ID;
}

function normalizePlaybackState(state = {}) {
    const trackDetails = state.trackDetails || {};
    return {
        isPlaying: Boolean(state.isPlaying),
        trackDetails: {
            title: trackDetails.title || 'YouTube Music',
            artist: trackDetails.artist || 'Waiting for playback',
            album: trackDetails.album || '',
            artwork: Array.isArray(trackDetails.artwork) ? trackDetails.artwork : [],
        },
    };
}

function normalizeVisualizerFrame(frame = {}) {
    return {
        timestamp: Number.isFinite(frame.timestamp) ? frame.timestamp : 0,
        frequencyData: Array.isArray(frame.frequencyData) && frame.frequencyData.length
            ? frame.frequencyData
            : Array(96).fill(0),
        waveform: Array.isArray(frame.waveform) && frame.waveform.length
            ? frame.waveform
            : Array(160).fill(0),
        energy: Number.isFinite(frame.energy) ? frame.energy : 0,
        bass: Number.isFinite(frame.bass) ? frame.bass : 0,
        mid: Number.isFinite(frame.mid) ? frame.mid : 0,
        treble: Number.isFinite(frame.treble) ? frame.treble : 0,
        peak: Number.isFinite(frame.peak) ? frame.peak : 0,
        beat: Number.isFinite(frame.beat) ? frame.beat : 0,
    };
}

function resizeCanvas() {
    engine.resize();
    if (currentDisplayMode === DISPLAY_MODE_ALBUM_ART) {
        drawAlbumArt();
    }
}

function drawAlbumArtFallback(width, height) {
    const backgroundGradient = context.createLinearGradient(0, 0, width, height);
    backgroundGradient.addColorStop(0, '#111827');
    backgroundGradient.addColorStop(1, '#020617');

    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    context.font = '600 18px "Segoe UI"';
    context.fillText(playbackState.trackDetails.title, 18, height - 40);

    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.font = '400 13px "Segoe UI"';
    context.fillText(playbackState.trackDetails.artist, 18, height - 18);
}

function drawAlbumArt() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const dpr = window.devicePixelRatio || 1;

    if (!width || !height) {
        return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (artworkImage && artworkImage.naturalWidth > 0 && artworkImage.naturalHeight > 0) {
        const scale = Math.max(width / artworkImage.naturalWidth, height / artworkImage.naturalHeight);
        const drawWidth = artworkImage.naturalWidth * scale;
        const drawHeight = artworkImage.naturalHeight * scale;
        const x = (width - drawWidth) / 2;
        const y = (height - drawHeight) / 2;

        context.drawImage(artworkImage, x, y, drawWidth, drawHeight);
    } else {
        drawAlbumArtFallback(width, height);
    }

    const shadeGradient = context.createLinearGradient(0, 0, 0, height);
    shadeGradient.addColorStop(0, 'rgba(2, 6, 23, 0.08)');
    shadeGradient.addColorStop(1, 'rgba(2, 6, 23, 0.34)');
    context.fillStyle = shadeGradient;
    context.fillRect(0, 0, width, height);
}

function loadArtwork(nextSource) {
    if (!nextSource) {
        artworkSource = '';
        artworkImage = null;
        if (currentDisplayMode === DISPLAY_MODE_ALBUM_ART) {
            drawAlbumArt();
        }
        return;
    }

    if (nextSource === artworkSource) {
        if (currentDisplayMode === DISPLAY_MODE_ALBUM_ART) {
            drawAlbumArt();
        }
        return;
    }

    artworkSource = nextSource;
    artworkRequestToken += 1;
    const requestToken = artworkRequestToken;
    const image = new Image();

    image.addEventListener('load', () => {
        if (requestToken !== artworkRequestToken) {
            return;
        }

        artworkImage = image;
        if (currentDisplayMode === DISPLAY_MODE_ALBUM_ART) {
            drawAlbumArt();
        }
    });

    image.addEventListener('error', () => {
        if (requestToken !== artworkRequestToken) {
            return;
        }

        artworkImage = null;
        if (currentDisplayMode === DISPLAY_MODE_ALBUM_ART) {
            drawAlbumArt();
        }
    });

    image.src = nextSource;
}

function updatePlaybackButton() {
    const nextState = playbackState.isPlaying ? 'playing' : 'paused';
    const nextLabel = playbackState.isPlaying ? 'Pause' : 'Play';

    playbackButton.dataset.state = nextState;
    playbackButton.setAttribute('aria-label', nextLabel);
    playbackButton.title = nextLabel;
}

function closeVisualizerMenu() {
    isVisualizerMenuOpen = false;
    shell.classList.remove('menu-open');
    visualizerMenu.hidden = true;
    visualizerPickerButton.setAttribute('aria-expanded', 'false');
}

function openVisualizerMenu() {
    if (currentDisplayMode !== DISPLAY_MODE_VISUALIZER) {
        return;
    }

    isVisualizerMenuOpen = true;
    shell.classList.add('menu-open');
    visualizerMenu.hidden = false;
    visualizerPickerButton.setAttribute('aria-expanded', 'true');
}

function toggleVisualizerMenu() {
    if (isVisualizerMenuOpen) {
        closeVisualizerMenu();
    } else {
        openVisualizerMenu();
    }
}

function renderVisualizerMenu() {
    visualizerMenu.innerHTML = '';

    visualizerDefinitions.forEach((definition) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'visualizer-option';
        if (definition.id === currentVisualizerId) {
            button.classList.add('is-selected');
        }

        button.innerHTML = `
            <span class="visualizer-option-label">${definition.label}</span>
            <span class="visualizer-option-description">${definition.description}</span>
        `;

        button.addEventListener('click', () => {
            setVisualizer(definition.id);
            closeVisualizerMenu();
        });

        visualizerMenu.appendChild(button);
    });
}

function setVisualizer(visualizerId) {
    currentVisualizerId = visualizerId;
    setStoredValue(STORAGE_KEYS.visualizerId, visualizerId);
    engine.setVisualizer(visualizerId);
    engine.setFrame(visualizerFrame);

    const selectedDefinition = visualizerDefinitions.find((definition) => definition.id === visualizerId);
    visualizerPickerLabel.textContent = selectedDefinition?.label || 'Visualizer';
    renderVisualizerMenu();

    if (currentDisplayMode === DISPLAY_MODE_VISUALIZER) {
        engine.start();
    }
}

function applyDisplayMode(mode) {
    currentDisplayMode = mode === DISPLAY_MODE_VISUALIZER
        ? DISPLAY_MODE_VISUALIZER
        : DISPLAY_MODE_ALBUM_ART;
    setStoredValue(STORAGE_KEYS.displayMode, currentDisplayMode);

    const isVisualizerMode = currentDisplayMode === DISPLAY_MODE_VISUALIZER;
    albumArtModeButton.classList.toggle('is-active', !isVisualizerMode);
    visualizerModeButton.classList.toggle('is-active', isVisualizerMode);
    visualizerPickerWrapper.hidden = !isVisualizerMode;

    if (isVisualizerMode) {
        engine.setFrame(visualizerFrame);
        engine.start();
    } else {
        closeVisualizerMenu();
        engine.stop();
        drawAlbumArt();
    }
}

function applyPlaybackState(nextState) {
    playbackState = normalizePlaybackState(nextState);
    updatePlaybackButton();
    loadArtwork(playbackState.trackDetails.artwork[0]?.src || '');
}

function applyVisualizerFrame(frame) {
    visualizerFrame = normalizeVisualizerFrame(frame);
    engine.setFrame(visualizerFrame);
}

async function togglePlayback() {
    playbackButton.disabled = true;

    try {
        await window.miniWindow.togglePlayPause();
    } finally {
        window.setTimeout(() => {
            playbackButton.disabled = false;
        }, 150);
    }
}

function handleDocumentPointerDown(event) {
    if (!isVisualizerMenuOpen) {
        return;
    }

    if (!visualizerPickerWrapper.contains(event.target)) {
        closeVisualizerMenu();
    }
}

function handleDocumentKeydown(event) {
    if (event.key === 'Escape') {
        closeVisualizerMenu();
    }
}

async function initialize() {
    resizeCanvas();
    renderVisualizerMenu();
    setVisualizer(currentVisualizerId);
    applyDisplayMode(currentDisplayMode);
    updatePlaybackButton();

    playbackButton.addEventListener('click', togglePlayback);
    closeButton.addEventListener('click', () => {
        window.miniWindow.close();
    });

    albumArtModeButton.addEventListener('click', () => {
        applyDisplayMode(DISPLAY_MODE_ALBUM_ART);
    });

    visualizerModeButton.addEventListener('click', () => {
        applyDisplayMode(DISPLAY_MODE_VISUALIZER);
    });

    visualizerPickerButton.addEventListener('click', toggleVisualizerMenu);
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeydown);

    removePlaybackListener = window.miniWindow.onPlaybackState((state) => {
        applyPlaybackState(state);
    });

    removeVisualizerFrameListener = window.miniWindow.onVisualizerFrame((frame) => {
        applyVisualizerFrame(frame);
    });

    const [initialPlaybackState, initialVisualizerFrame] = await Promise.all([
        window.miniWindow.getPlaybackState(),
        window.miniWindow.getVisualizerFrame(),
    ]);

    applyPlaybackState(initialPlaybackState);
    applyVisualizerFrame(initialVisualizerFrame);

    if (currentDisplayMode === DISPLAY_MODE_ALBUM_ART) {
        drawAlbumArt();
    }
}

window.addEventListener('beforeunload', () => {
    removePlaybackListener?.();
    removeVisualizerFrameListener?.();
    engine.destroy();
    document.removeEventListener('pointerdown', handleDocumentPointerDown);
    document.removeEventListener('keydown', handleDocumentKeydown);
});

void initialize();
