const VOICE_URL = "voices/en/en-rp.json";

function log(msg) {
    const logOutput = document.getElementById('log-output');
    logOutput.textContent = `> ${msg}`;
    console.log(msg);
}

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

    const speed = parseInt(document.getElementById('speed').value);
    const pitch = parseInt(document.getElementById('pitch').value);
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
            const { pcm, channels: c, sampleRate: s } = extractPCM(wavData);
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

// Button Handlers
document.getElementById('btn-preview').addEventListener('click', async () => {
    const text = document.getElementById('text-input').value;
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

document.getElementById('btn-download').addEventListener('click', async () => {
    const text = document.getElementById('text-input').value;
    if (!text) return;
    try {
        const { pcm, channels, sampleRate } = await generateAudio(text);
        log("Encoding MP3...");
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

        const blob = new Blob(mp3Data, { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Generate timestamp YYYY-MM-DD_HH-MM-SS
        const now = new Date();
        const pad = n => n.toString().padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        
        a.download = `${timestamp}_spkjs.mp3`;
        a.click();
        log("Download started.");
    } catch (e) { log("Error: " + e.message); }
});

document.getElementById('speed').addEventListener('input', (e) => document.getElementById('speed-val').textContent = e.target.value);
document.getElementById('pitch').addEventListener('input', (e) => document.getElementById('pitch-val').textContent = e.target.value);
window.addEventListener('load', init);