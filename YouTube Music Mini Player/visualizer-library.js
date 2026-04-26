const TAU = Math.PI * 2;
const DEFAULT_VISUALIZER_ID = 'waveforms';

function clamp(value, min = 0, max = 1) {
    const numericValue = Number.isFinite(value) ? value : 0;
    return Math.min(max, Math.max(min, numericValue));
}

function createBufferCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.pixelWidth || size.width || 1));
    canvas.height = Math.max(1, Math.round(size.pixelHeight || size.height || 1));
    return {
        canvas,
        ctx: canvas.getContext('2d'),
    };
}

function createEmptyFrame() {
    return {
        timestamp: 0,
        frequencyData: Array(96).fill(0),
        waveform: Array(160).fill(0),
        energy: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        peak: 0,
        beat: 0,
    };
}

function normalizeFrame(frame = {}) {
    const emptyFrame = createEmptyFrame();

    return {
        timestamp: Number.isFinite(frame.timestamp) ? frame.timestamp : emptyFrame.timestamp,
        frequencyData: Array.isArray(frame.frequencyData) && frame.frequencyData.length
            ? frame.frequencyData.map((value) => clamp(value))
            : emptyFrame.frequencyData,
        waveform: Array.isArray(frame.waveform) && frame.waveform.length
            ? frame.waveform.map((value) => clamp(value, -1, 1))
            : emptyFrame.waveform,
        energy: clamp(frame.energy),
        bass: clamp(frame.bass),
        mid: clamp(frame.mid),
        treble: clamp(frame.treble),
        peak: clamp(frame.peak),
        beat: clamp(frame.beat),
    };
}

class VisualizerRegistry {
    constructor() {
        this.definitions = new Map();
    }

    register(definition) {
        this.definitions.set(definition.id, definition);
        return this;
    }

    create(id, context) {
        const nextDefinition = this.definitions.get(id) || this.definitions.values().next().value;
        return nextDefinition
            ? nextDefinition.create(context)
            : null;
    }

    list() {
        return [...this.definitions.values()];
    }
}

class CanvasVisualizerEngine {
    constructor({ canvas, registry, initialVisualizerId = DEFAULT_VISUALIZER_ID }) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.registry = registry;
        this.size = {
            width: 1,
            height: 1,
            pixelWidth: 1,
            pixelHeight: 1,
            dpr: 1,
        };
        this.frame = createEmptyFrame();
        this.activeVisualizer = null;
        this.activeVisualizerId = null;
        this.isRunning = false;
        this.rafId = 0;
        this.lastTick = 0;

        this.tick = this.tick.bind(this);
        this.resize();
        this.setVisualizer(initialVisualizerId);
    }

    getVisualizers() {
        return this.registry.list();
    }

    setVisualizer(id) {
        if (this.activeVisualizerId === id) {
            return;
        }

        this.activeVisualizer?.destroy?.();
        this.activeVisualizer = this.registry.create(id, {
            canvas: this.canvas,
            ctx: this.ctx,
        });
        this.activeVisualizerId = id;
        this.activeVisualizer?.resize?.(this.size);
    }

    setFrame(frame) {
        this.frame = normalizeFrame(frame);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const pixelWidth = Math.max(1, Math.round(width * dpr));
        const pixelHeight = Math.max(1, Math.round(height * dpr));

        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
            this.canvas.width = pixelWidth;
            this.canvas.height = pixelHeight;
        }

        this.size = {
            width,
            height,
            pixelWidth,
            pixelHeight,
            dpr,
        };

        this.activeVisualizer?.resize?.(this.size);
    }

    start() {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.lastTick = performance.now();
        this.rafId = window.requestAnimationFrame(this.tick);
    }

    stop() {
        this.isRunning = false;
        if (this.rafId) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
    }

    tick(timestamp) {
        const delta = Math.min(0.05, Math.max(0.001, (timestamp - this.lastTick) / 1000));
        this.lastTick = timestamp;

        if (this.activeVisualizer) {
            this.ctx.setTransform(this.size.dpr, 0, 0, this.size.dpr, 0, 0);
            this.ctx.clearRect(0, 0, this.size.width, this.size.height);
            this.activeVisualizer.render({
                ctx: this.ctx,
                size: this.size,
                frame: this.frame,
                time: timestamp / 1000,
                delta,
            });
        }

        if (this.isRunning) {
            this.rafId = window.requestAnimationFrame(this.tick);
        }
    }

    destroy() {
        this.stop();
        this.activeVisualizer?.destroy?.();
    }
}

class WaveformsVisualizer {
    resize(size) {
        this.size = size;
    }

    render({ ctx, size, frame, time }) {
        const { width, height } = size;
        const centerY = height / 2;
        const backgroundGradient = ctx.createLinearGradient(0, 0, width, height);
        backgroundGradient.addColorStop(0, '#050816');
        backgroundGradient.addColorStop(1, '#0f172a');

        ctx.fillStyle = backgroundGradient;
        ctx.fillRect(0, 0, width, height);

        const glow = ctx.createRadialGradient(width / 2, centerY, 0, width / 2, centerY, width * 0.6);
        glow.addColorStop(0, `rgba(56, 189, 248, ${0.12 + (frame.energy * 0.25)})`);
        glow.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);

        const barWidth = width / frame.frequencyData.length;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.84)';

        frame.frequencyData.forEach((value, index) => {
            const barHeight = Math.pow(value, 1.3) * height * 0.38;
            const x = index * barWidth;
            const opacity = 0.18 + (value * 0.72);

            ctx.fillStyle = `rgba(244, 63, 94, ${opacity})`;
            ctx.fillRect(x, centerY - barHeight, Math.max(1, barWidth - 2), barHeight);
            ctx.fillStyle = `rgba(56, 189, 248, ${opacity})`;
            ctx.fillRect(x, centerY, Math.max(1, barWidth - 2), barHeight);
        });

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.72 + (frame.beat * 0.2)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        frame.waveform.forEach((sample, index) => {
            const x = (index / (frame.waveform.length - 1)) * width;
            const y = centerY + (sample * height * 0.2);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        ctx.strokeStyle = `rgba(125, 211, 252, ${0.35 + (frame.treble * 0.4)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        frame.waveform.forEach((sample, index) => {
            const x = (index / (frame.waveform.length - 1)) * width;
            const y = centerY - (sample * height * 0.16);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 255, 255, ${0.08 + (frame.peak * 0.1)})`;
        ctx.fillRect(0, centerY - 1, width, 2);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.font = '600 12px "Segoe UI"';
        ctx.fillText(`Waveforms ${Math.round((0.4 + (frame.energy * 0.6)) * 100)}%`, 16, height - 16);
    }
}

class KaleidoscopeVisualizer {
    resize(size) {
        this.size = size;
    }

    render({ ctx, size, frame, time }) {
        const { width, height } = size;
        const radius = Math.min(width, height) * 0.42;
        const slices = 12;
        const baseHue = 220 + (frame.treble * 100);

        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, width, height);

        const vignette = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius * 1.8);
        vignette.addColorStop(0, `rgba(56, 189, 248, ${0.08 + (frame.energy * 0.18)})`);
        vignette.addColorStop(1, 'rgba(2, 6, 23, 0.92)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate(time * (0.16 + (frame.energy * 0.28)));
        ctx.globalCompositeOperation = 'lighter';

        for (let slice = 0; slice < slices; slice += 1) {
            const hue = (baseHue + (slice * 18) + (time * 24)) % 360;
            ctx.save();
            ctx.rotate((slice / slices) * TAU);
            ctx.scale(1, slice % 2 === 0 ? 1 : -1);

            ctx.beginPath();
            ctx.moveTo(0, 0);
            for (let band = 0; band < frame.frequencyData.length; band += 4) {
                const bandValue = frame.frequencyData[band];
                const bandRatio = band / (frame.frequencyData.length - 1);
                const bandAngle = (bandRatio * TAU) / slices;
                const bandRadius = (radius * 0.16) + (radius * 0.78 * Math.pow(bandValue, 1.15));
                ctx.lineTo(Math.cos(bandAngle) * bandRadius, Math.sin(bandAngle) * bandRadius * 0.68);
            }
            ctx.closePath();

            ctx.fillStyle = `hsla(${hue}, 92%, 62%, ${0.08 + (frame.mid * 0.22)})`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${(hue + 36) % 360}, 100%, 78%, ${0.18 + (frame.peak * 0.32)})`;
            ctx.lineWidth = 1.3;
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();

        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + (frame.beat * 0.25)})`;
        for (let ring = 1; ring <= 4; ring += 1) {
            ctx.beginPath();
            ctx.arc(0, 0, (radius * ring) / 4, 0, TAU);
            ctx.stroke();
        }
        ctx.restore();
    }
}

class MagnetosphereVisualizer {
    constructor() {
        this.particles = Array.from({ length: 120 }, (_value, index) => ({
            angle: (index / 120) * TAU,
            orbit: 0.2 + ((index % 17) / 20),
            depth: 0.2 + ((index % 9) / 10),
            size: 1.6 + ((index % 5) * 0.7),
            drift: 0.6 + ((index % 11) * 0.12),
        }));
    }

    resize(size) {
        this.size = size;
    }

    render({ ctx, size, frame, time }) {
        const { width, height } = size;
        const centerX = width / 2;
        const centerY = height / 2;
        const orbitRadius = Math.min(width, height) * 0.34;

        ctx.fillStyle = '#030712';
        ctx.fillRect(0, 0, width, height);

        const nebulaGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, orbitRadius * 1.8);
        nebulaGradient.addColorStop(0, `rgba(14, 165, 233, ${0.08 + (frame.energy * 0.15)})`);
        nebulaGradient.addColorStop(0.65, `rgba(168, 85, 247, ${0.08 + (frame.bass * 0.2)})`);
        nebulaGradient.addColorStop(1, 'rgba(2, 6, 23, 0.95)');
        ctx.fillStyle = nebulaGradient;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.globalCompositeOperation = 'lighter';

        for (let cloudIndex = 0; cloudIndex < 4; cloudIndex += 1) {
            const cloudAngle = (time * (0.18 + (frame.energy * 0.25))) + (cloudIndex * (TAU / 4));
            const cloudRadius = orbitRadius * (0.62 + (frame.bass * 0.45));
            const cloudX = Math.cos(cloudAngle) * cloudRadius * 0.55;
            const cloudY = Math.sin(cloudAngle * 1.3) * cloudRadius * 0.3;
            const glow = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, orbitRadius * 0.72);
            glow.addColorStop(0, `rgba(244, 114, 182, ${0.12 + (frame.energy * 0.12)})`);
            glow.addColorStop(1, 'rgba(15, 23, 42, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(-width / 2, -height / 2, width, height);
        }

        this.particles.forEach((particle, index) => {
            const spin = time * (0.38 + (frame.energy * 1.8)) + particle.angle;
            const pulse = 0.82 + (frame.beat * 0.6) + (Math.sin(time * particle.drift) * 0.12);
            const depth = 0.45 + (Math.sin(time * particle.drift + particle.depth) * 0.35);
            const perspective = 0.5 + depth;
            const x = Math.cos(spin) * orbitRadius * particle.orbit * perspective;
            const y = Math.sin((spin * 1.2) + particle.depth) * orbitRadius * 0.38 * perspective;
            const sizeValue = particle.size * pulse * (0.55 + depth);
            const alpha = 0.12 + (depth * 0.26) + (frame.treble * 0.1);

            ctx.beginPath();
            ctx.fillStyle = `rgba(${index % 2 === 0 ? '125, 211, 252' : '244, 114, 182'}, ${alpha})`;
            ctx.shadowColor = `rgba(56, 189, 248, ${0.28 + (frame.energy * 0.2)})`;
            ctx.shadowBlur = 12 + (frame.beat * 24);
            ctx.arc(x, y, sizeValue, 0, TAU);
            ctx.fill();
        });

        ctx.restore();

        const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, orbitRadius * 0.48);
        core.addColorStop(0, `rgba(255, 255, 255, ${0.06 + (frame.peak * 0.22)})`);
        core.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = core;
        ctx.fillRect(0, 0, width, height);
    }
}

class MilkDropVisualizer {
    constructor({ canvas }) {
        this.canvas = canvas;
        this.feedback = createBufferCanvas({
            width: 1,
            height: 1,
            pixelWidth: 1,
            pixelHeight: 1,
        });
        this.sparks = [];
        this.lastBeatBurst = 0;
    }

    resize(size) {
        this.size = size;
        this.feedback = createBufferCanvas(size);
    }

    render({ ctx, size, frame, time, delta }) {
        const { width, height, dpr, pixelWidth, pixelHeight } = size;
        const centerX = width / 2;
        const centerY = height / 2;
        const feedbackCtx = this.feedback.ctx;

        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(0.003 + (frame.beat * 0.028));
        const feedbackScale = 1.012 + (frame.energy * 0.02);
        ctx.scale(feedbackScale, feedbackScale);
        ctx.globalAlpha = 0.86;
        ctx.drawImage(this.feedback.canvas, -width / 2, -height / 2, width, height);
        ctx.restore();

        ctx.globalCompositeOperation = 'lighter';
        for (let layer = 0; layer < 3; layer += 1) {
            const hue = (210 + (layer * 58) + (time * 42)) % 360;
            ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${0.12 + (frame.energy * 0.18)})`;
            ctx.lineWidth = 1.2 + (layer * 0.9);
            ctx.beginPath();
            frame.waveform.forEach((sample, index) => {
                const ratio = index / (frame.waveform.length - 1);
                const x = ratio * width;
                const y = centerY
                    + (sample * height * (0.18 + (layer * 0.07)))
                    + (Math.sin((ratio * TAU * 4) + time + layer) * 8 * frame.bass);

                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        frame.frequencyData.forEach((value, index) => {
            const ratio = index / frame.frequencyData.length;
            const angle = (ratio * TAU) + (time * 0.42);
            const radius = (Math.min(width, height) * 0.18) + (value * Math.min(width, height) * 0.28);
            const x = centerX + (Math.cos(angle) * radius);
            const y = centerY + (Math.sin(angle * 1.2) * radius * 0.56);
            const sizeValue = 1 + (value * 3.2);

            ctx.fillStyle = `rgba(244, 63, 94, ${0.08 + (value * 0.3)})`;
            ctx.beginPath();
            ctx.arc(x, y, sizeValue, 0, TAU);
            ctx.fill();
        });

        if (frame.beat > 0.24 && (time - this.lastBeatBurst) > 0.18) {
            this.lastBeatBurst = time;
            for (let index = 0; index < 18; index += 1) {
                this.sparks.push({
                    angle: (index / 18) * TAU,
                    speed: 80 + (Math.random() * 120),
                    life: 0.8 + (Math.random() * 0.5),
                    age: 0,
                });
            }
        }

        this.sparks = this.sparks.filter((spark) => spark.age < spark.life);
        this.sparks.forEach((spark) => {
            spark.age += delta;
            const lifeRatio = 1 - (spark.age / spark.life);
            const distance = spark.speed * spark.age * (0.75 + (frame.energy * 0.9));
            const x = centerX + (Math.cos(spark.angle + (time * 0.3)) * distance);
            const y = centerY + (Math.sin(spark.angle + (time * 0.34)) * distance * 0.72);

            ctx.fillStyle = `rgba(255, 255, 255, ${lifeRatio * 0.55})`;
            ctx.beginPath();
            ctx.arc(x, y, 1.2 + (lifeRatio * 2.4), 0, TAU);
            ctx.fill();
        });

        ctx.globalCompositeOperation = 'source-over';
        feedbackCtx.setTransform(1, 0, 0, 1, 0, 0);
        feedbackCtx.clearRect(0, 0, pixelWidth, pixelHeight);
        feedbackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        feedbackCtx.drawImage(this.canvas, 0, 0, width, height);
    }
}

function createVisualizerRegistry() {
    return new VisualizerRegistry()
        .register({
            id: 'waveforms',
            label: 'Waveforms',
            description: 'Traditional mirrored spectrums and oscilloscope lines.',
            create: (context) => new WaveformsVisualizer(context),
        })
        .register({
            id: 'kaleidoscope',
            label: 'Kaleidoscope',
            description: 'Geometric pipe-dream symmetry built from the current spectrum.',
            create: (context) => new KaleidoscopeVisualizer(context),
        })
        .register({
            id: 'magnetosphere',
            label: 'Magnetosphere',
            description: 'Particle clouds and nebula glows that pulse with the low end.',
            create: (context) => new MagnetosphereVisualizer(context),
        })
        .register({
            id: 'milkdrop-2',
            label: 'MilkDrop 2',
            description: 'A MilkDrop-inspired feedback preset with layered trails and bursts.',
            create: (context) => new MilkDropVisualizer(context),
        });
}

export {
    CanvasVisualizerEngine,
    DEFAULT_VISUALIZER_ID,
    createVisualizerRegistry,
};
