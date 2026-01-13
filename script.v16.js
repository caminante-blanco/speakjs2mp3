// DOM Elements
const textInput = document.getElementById('text-input');
const speedInput = document.getElementById('speed');
const speedVal = document.getElementById('speed-val');
const pitchInput = document.getElementById('pitch');
const pitchVal = document.getElementById('pitch-val');
const btnPreview = document.getElementById('btn-preview');
const btnDownload = document.getElementById('btn-download');
const btnVideo = document.getElementById('btn-video');
const imageInput = document.getElementById('image-input');
const logOutput = document.getElementById('log-output');
const diagnostics = document.getElementById('diagnostics');

const VOICE_URL = "voices/en/en-rp.json";

function log(msg) {
    logOutput.textContent = `> ${msg}`;
    console.log(msg);
}

async function runDiagnostics() {
    const audioCodecs = [
        { name: 'AAC-LC', config: { codec: 'mp4a.40.2', numberOfChannels: 1, sampleRate: 44100, bitrate: 128000 } },
        { name: 'Opus', config: { codec: 'opus', numberOfChannels: 1, sampleRate: 48000, bitrate: 128000 } }
    ];
    const videoCodecs = [
        { name: 'AVC (H.264) L3.1', config: { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 2000000, framerate: 30 } },
        { name: 'AVC (H.264) L5.1', config: { codec: 'avc1.4d4033', width: 3840, height: 2160, bitrate: 4000000, framerate: 30 } }
    ];

    let html = "<strong>WebCodecs Support:</strong><br>";
    
    for (const c of audioCodecs) {
        try {
            const res = await AudioEncoder.isConfigSupported(c.config);
            html += `${c.name}: ${res.supported ? '✅' : '❌'} `;
        } catch (e) { html += `${c.name}: ❌ `; }
    }
    html += "<br>";
    for (const c of videoCodecs) {
        try {
            const res = await VideoEncoder.isConfigSupported(c.config);
            html += `${c.name}: ${res.supported ? '✅' : '❌'} `;
        } catch (e) { html += `${c.name}: ❌ `; }
    }
    diagnostics.innerHTML = html;
}

// Initialization
async function init() {
    log("Initializing...");
    runDiagnostics();
    try {
        meSpeak.loadVoice(VOICE_URL, (success, msg) => {
            if (success) log("Voice loaded. System Ready.");
            else log("Error loading voice: " + msg);
        });
    } catch (e) {
        log("Initialization error: " + e.message);
    }
}

// Extract PCM from a WAV Uint8Array
function extractPCM(wavBuffer) {
    const dataView = new DataView(wavBuffer.buffer);
    const channels = dataView.getUint16(22, true);
    const sampleRate = dataView.getUint32(24, true);
    const bitsPerSample = dataView.getUint16(34, true);
    
    let offset = 12;
    while (offset < dataView.byteLength) {
        const chunkId = dataView.getUint32(offset, false);
        const chunkSize = dataView.getUint32(offset + 4, true);
        if (chunkId === 0x64617461) { // "data"
            offset += 8;
            break;
        }
        offset += 8 + chunkSize;
    }

    const sampleCount = (wavBuffer.length - offset) / (bitsPerSample / 8);
    const pcm = new Int16Array(sampleCount);

    if (bitsPerSample === 8) {
        for (let i = 0; i < sampleCount; i++) {
            pcm[i] = (wavBuffer[offset + i] - 128) << 8;
        }
    } else {
        for (let i = 0; i < sampleCount; i++) {
            pcm[i] = dataView.getInt16(offset + (i * 2), true);
        }
    }
    return { pcm, channels, sampleRate };
}

// Helper: Trim silence (zero samples) from start and end of PCM
function trimSilence(pcm) {
    let start = 0;
    let end = pcm.length;

    // Find first non-zero sample
    while (start < end && pcm[start] === 0) start++;
    
    // Find last non-zero sample
    while (end > start && pcm[end - 1] === 0) end--;

    if (start >= end) return new Int16Array(0); // All silence
    
    return pcm.subarray(start, end);
}

// Generate Audio (Async) - Manual Stitching Edition
async function generateAudio(text) {
    // 1. Split text into segments: ["text", 1000, "text"]
    const segments = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const txt = text.substring(lastIndex, match.index).trim();
        if (txt) segments.push({ type: 'text', val: txt });
        segments.push({ type: 'silence', val: parseInt(match[1]) });
        lastIndex = regex.lastIndex;
    }
    const remaining = text.substring(lastIndex).trim();
    if (remaining) segments.push({ type: 'text', val: remaining });

    if (segments.length === 0) return null;

    log(`Stitching ${segments.length} segments...`);

    const speed = parseInt(speedInput.value);
    const pitch = parseInt(pitchInput.value);
    const options = { speed, pitch, amplitude: 100, variant: 'klatt', wordgap: 2, rawdata: 'array' };

    let finalPcm = new Int16Array(0);
    let sampleRate = 22050; // Default
    let channels = 1;

    for (const segment of segments) {
        if (segment.type === 'text') {
            const wavData = await new Promise((resolve, reject) => {
                meSpeak.speak(segment.val, options, (success, id, stream) => {
                    if (success) resolve(new Uint8Array(stream));
                    else reject(new Error("Synthesis failed on: " + segment.val));
                });
            });
            const { pcm: rawPcm, channels: c, sampleRate: s } = extractPCM(wavData);
            
            // Trim engine padding
            const pcm = trimSilence(rawPcm);
            
            channels = c;
            sampleRate = s;
            
            const newPcm = new Int16Array(finalPcm.length + pcm.length);
            newPcm.set(finalPcm);
            newPcm.set(pcm, finalPcm.length);
            finalPcm = newPcm;
        } else {
            // Silence
            const numSamples = Math.floor((segment.val / 1000) * sampleRate * channels);
            const silence = new Int16Array(numSamples); // Zeroed
            
            const newPcm = new Int16Array(finalPcm.length + silence.length);
            newPcm.set(finalPcm);
            newPcm.set(silence, finalPcm.length);
            finalPcm = newPcm;
        }
    }

    return { pcm: finalPcm, channels, sampleRate };
}

// Helper to create WAV header for preview
function createWavHeader(pcmLength, channels, sampleRate) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52494646, false); // RIFF
    view.setUint32(4, 36 + pcmLength * 2, true);
    view.setUint32(8, 0x57415645, false); // WAVE
    view.setUint32(12, 0x666d7420, false); // fmt 
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true); // 16-bit
    view.setUint32(36, 0x64617461, false); // data
    view.setUint32(40, pcmLength * 2, true);
    return new Uint8Array(buffer);
}

// Audio logic shared between MP3 and Video
async function getMp3Blob(pcm, channels, sampleRate) {
    const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const mp3Data = [];
    const blockSize = 1152;
    for (let i = 0; i < pcm.length; i += blockSize) {
        const chunk = pcm.subarray(i, i + blockSize);
        const mp3buf = mp3Encoder.encodeBuffer(chunk);
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }
    const endBuf = mp3Encoder.flush();
    if (endBuf.length > 0) mp3Data.push(endBuf);
    return new Blob(mp3Data, { type: 'audio/mp3' });
}

function getTimestamp() {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// Button Handlers
btnPreview.addEventListener('click', async () => {
    const text = textInput.value;
    if (!text) return;
    try {
        const { pcm, channels, sampleRate } = await generateAudio(text);
        const header = createWavHeader(pcm.length, channels, sampleRate);
        const wav = new Uint8Array(header.length + pcm.length * 2);
        wav.set(header);
        wav.set(new Uint8Array(pcm.buffer), header.length);

        const blob = new Blob([wav], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        log("Playing stitched audio...");
    } catch (e) { log("Error: " + e.message); }
});

btnDownload.addEventListener('click', async () => {
    const text = textInput.value;
    if (!text) return;
    try {
        const { pcm, channels, sampleRate } = await generateAudio(text);
        log("Encoding MP3...");
        const blob = await getMp3Blob(pcm, channels, sampleRate);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getTimestamp()}_spkjs.mp3`;
        a.click();
        log("Download started.");
    } catch (e) { log("Error: " + e.message); }
});

// Single Button Video Flow
btnVideo.addEventListener('click', () => {
    if (!textInput.value) {
        log("Error: Input buffer empty.");
        return;
    }
    imageInput.click();
});

async function getBestAudioConfig(channels, sampleRate) {
    const configs = [
        { codec: 'mp4a.40.2', numberOfChannels: channels, sampleRate, bitrate: 128_000 }, // AAC-LC
        { codec: 'opus', numberOfChannels: channels, sampleRate, bitrate: 128_000 }
    ];

    for (const config of configs) {
        try {
            const support = await AudioEncoder.isConfigSupported(config);
            if (support.supported) return config;
        } catch (e) {}
    }
    throw new Error("No supported audio codec found.");
}

imageInput.addEventListener('change', async () => {
    const text = textInput.value;
    const imageFile = imageInput.files[0];
    if (!text || !imageFile) return;

    try {
        log("Synthesizing audio...");
        const { pcm: rawPcm, channels, sampleRate } = await generateAudio(text);
        const durationSeconds = rawPcm.length / (sampleRate * channels);
        
        log("Preparing Audio...");
        // Convert s16 to f32 (standard for WebCodecs AudioData)
        const pcmF32 = new Float32Array(rawPcm.length);
        for (let i = 0; i < rawPcm.length; i++) pcmF32[i] = rawPcm[i] / 32768;

        const audioConfig = await getBestAudioConfig(channels, sampleRate);
        log(`Using audio codec: ${audioConfig.codec}`);

        log("Preparing Video...");
        const imageBitmap = await createImageBitmap(imageFile);
        
        let width = imageBitmap.width;
        let height = imageBitmap.height;

        // Instagram limit check: Cap longest edge at 1080px
        const MAX_DIM = 1080;
        if (width > MAX_DIM || height > MAX_DIM) {
            const scale = MAX_DIM / Math.max(width, height);
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
            log(`Downscaling for Instagram: ${imageBitmap.width}x${imageBitmap.height} -> ${width}x${height}`);
        }

        // H.264 needs even dimensions
        width = Math.floor(width / 2) * 2;
        height = Math.floor(height / 2) * 2;

        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: {
                codec: 'avc',
                width: width,
                height: height
            },
            audio: {
                codec: audioConfig.codec === 'opus' ? 'opus' : 'aac',
                numberOfChannels: channels,
                sampleRate: sampleRate
            },
            fastStart: 'in-memory'
        });

        const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => log("Audio Error: " + e.message)
        });

        audioEncoder.configure(audioConfig);

        log("Encoding Audio...");
        const audioData = new AudioData({
            format: 'f32',
            sampleRate: sampleRate,
            numberOfFrames: pcmF32.length / channels,
            numberOfChannels: channels,
            timestamp: 0,
            data: pcmF32
        });
        audioEncoder.encode(audioData);
        audioData.close();
        await audioEncoder.flush();

        log("Encoding Video (Fast Mode)...");
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmap, 0, 0, width, height);
        
        let firstChunk = null;
        let firstMeta = null;
        const videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                firstChunk = chunk;
                firstMeta = meta;
            },
            error: (e) => log("Video Error: " + e.message)
        });

        // avc1.4d4033 = Main Profile, Level 5.1 (Supports 4K)
        videoEncoder.configure({
            codec: 'avc1.4d4033', 
            width: width,
            height: height,
            bitrate: 4_000_000,
            framerate: 30
        });

        const frame = new VideoFrame(canvas, { timestamp: 0 });
        videoEncoder.encode(frame, { keyFrame: true });
        frame.close();
        await videoEncoder.flush();

        if (firstChunk) {
            const videoData = new Uint8Array(firstChunk.byteLength);
            firstChunk.copyTo(videoData);

            const fps = 30;
            const totalFrames = Math.ceil(durationSeconds * fps);
            for (let i = 0; i < totalFrames; i++) {
                const timestamp = (i * 1_000_000) / fps;
                const newChunk = new EncodedVideoChunk({
                    type: firstChunk.type,
                    timestamp: timestamp,
                    duration: 1_000_000 / fps,
                    data: videoData
                });
                muxer.addVideoChunk(newChunk, firstMeta);
            }
        }

        muxer.finalize();
        const { buffer } = muxer.target;

        log("Finalizing...");
        const url = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getTimestamp()}_spkjs.mp4`;
        a.click();
        log("Video Download started.");

        imageInput.value = '';
        imageBitmap.close();

    } catch (e) {
        log("Error: " + e.message);
        console.error(e);
        imageInput.value = '';
    }
});

speedInput.addEventListener('input', (e) => speedVal.textContent = e.target.value);
pitchInput.addEventListener('input', (e) => pitchVal.textContent = e.target.value);
window.addEventListener('load', init);