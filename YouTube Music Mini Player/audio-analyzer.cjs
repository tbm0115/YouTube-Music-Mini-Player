const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_SMOOTHING = 0.82;
const DEFAULT_FREQUENCY_BINS = 96;
const DEFAULT_WAVEFORM_SAMPLES = 160;
const EMPTY_LEVELS = {
    energy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    peak: 0,
    beat: 0,
};

function createEmptyFrame({
    frequencyBins = DEFAULT_FREQUENCY_BINS,
    waveformSamples = DEFAULT_WAVEFORM_SAMPLES,
} = {}) {
    return {
        timestamp: 0,
        frequencyData: Array(frequencyBins).fill(0),
        waveform: Array(waveformSamples).fill(0),
        ...EMPTY_LEVELS,
    };
}

function sampleFrequencyBins(buffer, targetLength) {
    if (!buffer?.length || targetLength <= 0) {
        return [];
    }

    const bucketSize = buffer.length / targetLength;
    const result = new Array(targetLength);

    for (let index = 0; index < targetLength; index += 1) {
        const start = Math.floor(index * bucketSize);
        const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
        let strongestValue = 0;

        for (let cursor = start; cursor < end && cursor < buffer.length; cursor += 1) {
            strongestValue = Math.max(strongestValue, buffer[cursor]);
        }

        result[index] = strongestValue / 255;
    }

    return result;
}

function sampleWaveform(buffer, targetLength) {
    if (!buffer?.length || targetLength <= 0) {
        return [];
    }

    if (targetLength === 1) {
        return [(buffer[0] - 128) / 128];
    }

    const step = (buffer.length - 1) / (targetLength - 1);
    const result = new Array(targetLength);

    for (let index = 0; index < targetLength; index += 1) {
        const sourceIndex = Math.floor(index * step);
        result[index] = (buffer[sourceIndex] - 128) / 128;
    }

    return result;
}

function averageRange(buffer, startRatio, endRatio) {
    if (!buffer?.length) {
        return 0;
    }

    const startIndex = Math.floor(buffer.length * startRatio);
    const endIndex = Math.max(startIndex + 1, Math.floor(buffer.length * endRatio));
    let total = 0;
    let count = 0;

    for (let index = startIndex; index < endIndex && index < buffer.length; index += 1) {
        total += buffer[index];
        count += 1;
    }

    return count ? (total / count) / 255 : 0;
}

function getPeak(buffer) {
    if (!buffer?.length) {
        return 0;
    }

    let peak = 0;
    for (let index = 0; index < buffer.length; index += 1) {
        peak = Math.max(peak, buffer[index]);
    }

    return peak / 255;
}

function boostLevel(value, { gain = 1, power = 1 } = {}) {
    const normalizedValue = Math.max(0, value);
    return Math.min(1, Math.pow(normalizedValue, power) * gain);
}

function createAudioAnalyzer(options = {}) {
    const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
    const smoothingTimeConstant = options.smoothingTimeConstant ?? DEFAULT_SMOOTHING;
    const frequencyBins = options.frequencyBins ?? DEFAULT_FREQUENCY_BINS;
    const waveformSamples = options.waveformSamples ?? DEFAULT_WAVEFORM_SAMPLES;

    let audioContext = null;
    let analyserNode = null;
    let sourceNode = null;
    let mediaElement = null;
    let monitorFrameId = 0;
    let mutationObserver = null;
    let frequencyBuffer = null;
    let waveformBuffer = null;
    let latestFrame = createEmptyFrame({ frequencyBins, waveformSamples });
    let energyBaseline = 0;
    let mediaCleanup = () => {};
    let sourceKind = 'none';
    let zeroSignalFrameCount = 0;
    let lastRawPeak = 0;

    function resume() {
        if (audioContext?.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
    }

    function ensureAudioContext() {
        if (!audioContext) {
            const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContextConstructor();
        }

        return audioContext;
    }

    function disconnectGraph() {
        mediaCleanup();
        mediaCleanup = () => {};

        if (sourceNode) {
            try {
                sourceNode.disconnect();
            } catch (_error) {
                // Ignore disconnect errors for stale graphs.
            }
            sourceNode = null;
        }

        if (analyserNode) {
            try {
                analyserNode.disconnect();
            } catch (_error) {
                // Ignore disconnect errors for stale graphs.
            }
            analyserNode = null;
        }

        frequencyBuffer = null;
        waveformBuffer = null;
        sourceKind = 'none';
        zeroSignalFrameCount = 0;
        lastRawPeak = 0;
    }

    function createAnalyserNode(context) {
        const analyser = context.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothingTimeConstant;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -10;
        return analyser;
    }

    function tryCreateCaptureStreamSource(context, element, analyser) {
        const captureStream = typeof element.captureStream === 'function'
            ? element.captureStream.bind(element)
            : typeof element.mozCaptureStream === 'function'
                ? element.mozCaptureStream.bind(element)
                : null;

        if (!captureStream) {
            return null;
        }

        try {
            const stream = captureStream();
            if (!stream || stream.getAudioTracks().length === 0) {
                return null;
            }

            const streamSource = context.createMediaStreamSource(stream);
            streamSource.connect(analyser);
            return {
                sourceNode: streamSource,
                sourceKind: 'capture-stream',
            };
        } catch (_error) {
            return null;
        }
    }

    function tryCreateMediaElementSource(context, element, analyser) {
        try {
            const mediaElementSource = context.createMediaElementSource(element);
            mediaElementSource.connect(analyser);
            analyser.connect(context.destination);
            return {
                sourceNode: mediaElementSource,
                sourceKind: 'media-element-source',
            };
        } catch (_error) {
            return null;
        }
    }

    function attachMediaLifecycle(element) {
        const resumeContext = () => {
            resume();
        };

        const events = ['play', 'playing', 'canplay', 'loadeddata', 'seeked', 'volumechange'];
        events.forEach((eventName) => {
            element.addEventListener(eventName, resumeContext);
        });

        mediaCleanup = () => {
            events.forEach((eventName) => {
                element.removeEventListener(eventName, resumeContext);
            });
        };
    }

    function connectMediaElement(nextMediaElement, { forceReconnect = false } = {}) {
        if (!nextMediaElement) {
            return false;
        }

        if (!forceReconnect && mediaElement === nextMediaElement && sourceNode && analyserNode) {
            return true;
        }

        disconnectGraph();

        mediaElement = nextMediaElement;
        try {
            const context = ensureAudioContext();
            const analyser = createAnalyserNode(context);
            const connection = tryCreateMediaElementSource(context, nextMediaElement, analyser)
                || tryCreateCaptureStreamSource(context, nextMediaElement, analyser);

            if (!connection?.sourceNode) {
                throw new Error('No supported audio source connection could be established.');
            }

            analyserNode = analyser;
            sourceNode = connection.sourceNode;
            sourceKind = connection.sourceKind;
            frequencyBuffer = new Uint8Array(analyserNode.frequencyBinCount);
            waveformBuffer = new Uint8Array(analyserNode.fftSize);
            attachMediaLifecycle(nextMediaElement);
            resume();

            return true;
        } catch (error) {
            console.error('Unable to connect audio analyzer to media element:', error);
            mediaElement = null;
            disconnectGraph();
            return false;
        }
    }

    function findMediaElement() {
        return document.querySelector('video, audio');
    }

    function ensureConnectedMediaElement() {
        const currentMediaElement = findMediaElement();
        if (currentMediaElement) {
            connectMediaElement(currentMediaElement);
        }
    }

    function buildLevelsFromFrequencyData(buffer) {
        const bassRaw = averageRange(buffer, 0, 0.12);
        const midRaw = averageRange(buffer, 0.12, 0.45);
        const trebleRaw = averageRange(buffer, 0.45, 1);
        const bass = boostLevel(bassRaw, { gain: 1.5, power: 0.78 });
        const mid = boostLevel(midRaw, { gain: 1.42, power: 0.8 });
        const treble = boostLevel(trebleRaw, { gain: 1.6, power: 0.84 });
        const peak = boostLevel(getPeak(buffer), { gain: 1.18, power: 0.9 });
        const energy = boostLevel(
            (bassRaw * 0.5) + (midRaw * 0.35) + (trebleRaw * 0.15),
            { gain: 1.85, power: 0.76 },
        );
        energyBaseline = energyBaseline === 0
            ? energy
            : (energyBaseline * 0.92) + (energy * 0.08);
        const beat = Math.max(0, Math.min(1, (energy - energyBaseline) * 5.4));

        return {
            energy,
            bass,
            mid,
            treble,
            peak,
            beat,
        };
    }

    function monitor() {
        ensureConnectedMediaElement();

        if (analyserNode && frequencyBuffer && waveformBuffer) {
            analyserNode.getByteFrequencyData(frequencyBuffer);
            analyserNode.getByteTimeDomainData(waveformBuffer);
            lastRawPeak = getPeak(frequencyBuffer);

            if (mediaElement && !mediaElement.paused && sourceKind === 'capture-stream' && lastRawPeak <= 0.0001) {
                zeroSignalFrameCount += 1;
                if (zeroSignalFrameCount >= 90) {
                    connectMediaElement(mediaElement, { forceReconnect: true });
                }
            } else {
                zeroSignalFrameCount = 0;
            }

            latestFrame = {
                timestamp: performance.now(),
                frequencyData: sampleFrequencyBins(frequencyBuffer, frequencyBins),
                waveform: sampleWaveform(waveformBuffer, waveformSamples),
                ...buildLevelsFromFrequencyData(frequencyBuffer),
            };
        }

        monitorFrameId = window.requestAnimationFrame(monitor);
    }

    function start() {
        if (!mutationObserver) {
            mutationObserver = new MutationObserver(() => {
                ensureConnectedMediaElement();
            });

            if (document.documentElement) {
                mutationObserver.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                });
            }
        }

        window.addEventListener('pointerdown', resume, { passive: true });
        window.addEventListener('keydown', resume);
        ensureConnectedMediaElement();

        if (!monitorFrameId) {
            monitorFrameId = window.requestAnimationFrame(monitor);
        }
    }

    function stop() {
        if (monitorFrameId) {
            window.cancelAnimationFrame(monitorFrameId);
            monitorFrameId = 0;
        }

        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        disconnectGraph();
    }

    function getSnapshot() {
        return latestFrame;
    }

    function getDebugState() {
        return {
            sourceKind,
            audioContextState: audioContext?.state || 'uninitialized',
            analyserReady: Boolean(analyserNode && frequencyBuffer && waveformBuffer),
            zeroSignalFrameCount,
            lastRawPeak,
            mediaElement: mediaElement
                ? {
                    tagName: mediaElement.tagName,
                    paused: mediaElement.paused,
                    ended: mediaElement.ended,
                    currentTime: mediaElement.currentTime,
                    duration: Number.isFinite(mediaElement.duration) ? mediaElement.duration : null,
                    readyState: mediaElement.readyState,
                    src: mediaElement.currentSrc || mediaElement.src || '',
                }
                : null,
            latestFrame,
        };
    }

    return {
        start,
        stop,
        resume,
        getSnapshot,
        getDebugState,
    };
}

module.exports = {
    createAudioAnalyzer,
    createEmptyFrame,
};
