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

const VOICE_URL = "voices/en/en-rp.json";

function log(msg) {
    logOutput.textContent = `> ${msg}`;
    console.log(msg);
}

// FFmpeg setup
const { createFFmpeg, fetchFile } = FFmpeg;
let ffmpeg = null;

async function loadFFmpeg() {
    if (ffmpeg) return;
    log("Loading FFmpeg engine...");
    ffmpeg = createFFmpeg({ 
        log: true,
        corePath: new URL('lib/ffmpeg/ffmpeg-core.js', document.location).href
    });
    await ffmpeg.load();
    log("FFmpeg engine ready.");
}

imageInput.addEventListener('change', () => {
    btnVideo.disabled = !imageInput.files.length;
});

// Initialization
async function init() {
    log("Initializing...");
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

imageInput.addEventListener('change', async () => {
    const text = textInput.value;
    const imageFile = imageInput.files[0];
    if (!text || !imageFile) return;

    try {
        const { pcm, channels, sampleRate } = await generateAudio(text);
        log("Encoding audio...");
        const mp3Blob = await getMp3Blob(pcm, channels, sampleRate);
        const mp3Buffer = new Uint8Array(await mp3Blob.arrayBuffer());

        await loadFFmpeg();
        
        log("Uploading files to FFmpeg virtual FS...");
        ffmpeg.FS('writeFile', 'audio.mp3', mp3Buffer);
        ffmpeg.FS('writeFile', 'image', await fetchFile(imageFile));

        log("Rendering Video (4K Still)...");
        // The "Brain Dead" Encoder Method:
        // x264-params: keyint=infinite:min-keyint=infinite:scenecut=0:no-deblock=1:no-cabac=1:bframes=0:ref=1
        // This disables all 'smart' H.264 features, making it a simple memory-copy operation.
        await ffmpeg.run(
            '-loop', '1',
            '-framerate', '30',
            '-i', 'image',
            '-i', 'audio.mp3',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'stillimage',
            '-x264-params', 'keyint=infinite:min-keyint=infinite:scenecut=0:no-deblock=1:no-cabac=1:bframes=0:ref=1',
            '-c:a', 'copy',
            '-shortest',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            'out.mp4'
        );

        log("Finalizing...");
        const data = ffmpeg.FS('readFile', 'out.mp4');
        
        ffmpeg.FS('unlink', 'audio.mp3');
        ffmpeg.FS('unlink', 'image');
        ffmpeg.FS('unlink', 'out.mp4');

        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getTimestamp()}_spkjs.mp4`;
        a.click();
        log("Video Download started.");

        imageInput.value = '';

    } catch (e) {
        log("Error: " + e.message);
        console.error(e);
        imageInput.value = '';
    }
});

speedInput.addEventListener('input', (e) => speedVal.textContent = e.target.value);
pitchInput.addEventListener('input', (e) => pitchVal.textContent = e.target.value);
window.addEventListener('load', init);