
// DOM Elements
const textInput = document.getElementById('text-input');
const speedInput = document.getElementById('speed');
const speedVal = document.getElementById('speed-val');
const pitchInput = document.getElementById('pitch');
const pitchVal = document.getElementById('pitch-val');
const btnPreview = document.getElementById('btn-preview');
const btnDownload = document.getElementById('btn-download');
const logOutput = document.getElementById('log-output');

// Config
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
        // meSpeak v2.0+ loads standard config automatically.
        // We only need to load the voice.
        // We use the callback to confirm it's loaded, though meSpeak handles deferrals.
        meSpeak.loadVoice(VOICE_URL, (success, msg) => {
            if (success) {
                log("Voice loaded. System Ready.");
            } else {
                log("Error loading voice: " + msg);
            }
        });
    } catch (e) {
        log("Initialization error: " + e.message);
        console.error(e);
    }
}

// Generate Audio (Async)
function generateAudio(text) {
    return new Promise((resolve, reject) => {
        // Mobile Convenience Rules:
        // 1. Convert [number] (e.g. [500]) to SSML break
        // We use SSML <break> because meSpeak/eSpeak handles it more reliably when -m is set.
        let safeText = text.replace(/\[(\d+)\]/g, '<break time="$1ms"/>');
        
        // 2. We remove other brackets to avoid them being read out
        safeText = safeText.replace(/\[|\]/g, '');

        log("Sending to engine: " + safeText);

        const speed = parseInt(document.getElementById('speed').value);
        const pitch = parseInt(document.getElementById('pitch').value);
        
        const options = {
            speed: speed,
            pitch: pitch,
            amplitude: 100,
            variant: 'klatt',
            wordgap: 2,
            ssml: true, // Enable SSML parsing
            rawdata: 'array'
        };

        log("Synthesizing...");

        // The callback receives: (success, id, stream)
        meSpeak.speak(safeText, options, (success, id, stream) => {
            if (success) {
                resolve(stream);
            } else {
                reject(new Error("Synthesis failed."));
            }
        });
    });
}

// Preview Button
document.getElementById('btn-preview').addEventListener('click', async () => {
    const text = document.getElementById('text-input').value;
    if (!text) return;

    try {
        const wavStream = await generateAudio(text);
        
        // wavStream is an Array (from 'array' option) or ArrayBuffer
        // We need to convert to Uint8Array for the Blob
        const buffer = new Uint8Array(wavStream);
        
        log("Playing...");
        const blob = new Blob([buffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        audio.onended = () => URL.revokeObjectURL(url);
    } catch (e) {
        log("Error: " + e.message);
    }
});

// Download Button
document.getElementById('btn-download').addEventListener('click', async () => {
    const text = document.getElementById('text-input').value;
    if (!text) return;

    try {
        const wavStream = await generateAudio(text);
        log("Encoding MP3...");

        const wavBuffer = new Uint8Array(wavStream);
        
        // Parse WAV to get PCM samples
        const dataView = new DataView(wavBuffer.buffer);
        
        // Simple WAV parsing
        // We assume 16-bit mono or stereo based on header, but meSpeak usually outputs 1 channel default
        const channels = dataView.getUint16(22, true);
        const sampleRate = dataView.getUint32(24, true);
        const bitsPerSample = dataView.getUint16(34, true);
        
        // Find data chunk
        let offset = 12;
        while (offset < dataView.byteLength) {
            if (dataView.getUint32(offset, false) === 0x64617461) { // 'data'
                offset += 8;
                break;
            }
            offset += 8 + dataView.getUint32(offset + 4, true);
        }

        const pcmData = [];
        const sampleCount = (wavBuffer.length - offset) / (bitsPerSample / 8);

        if (bitsPerSample === 8) {
            for (let i = 0; i < sampleCount; i++) {
                pcmData.push((wavBuffer[offset + i] - 128) << 8);
            }
        } else {
            for (let i = 0; i < sampleCount; i++) {
                pcmData.push(dataView.getInt16(offset + (i * 2), true));
            }
        }

        // LameJS Encoding
        const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
        const mp3Data = [];
        const sampleBlockSize = 1152;
        const int16Array = new Int16Array(pcmData);

        for (let i = 0; i < int16Array.length; i += sampleBlockSize) {
            const chunk = int16Array.subarray(i, i + sampleBlockSize);
            const mp3buf = mp3Encoder.encodeBuffer(chunk);
            if (mp3buf.length > 0) mp3Data.push(mp3buf);
        }
        const endBuf = mp3Encoder.flush();
        if (endBuf.length > 0) mp3Data.push(endBuf);

        // Download
        const blob = new Blob(mp3Data, { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tts-output.mp3';
        a.click();
        log("Download started.");
        
    } catch (e) {
        log("Error: " + e.message);
        console.error(e);
    }
});

// Update slider labels
document.getElementById('speed').addEventListener('input', (e) => document.getElementById('speed-val').textContent = e.target.value);
document.getElementById('pitch').addEventListener('input', (e) => document.getElementById('pitch-val').textContent = e.target.value);

window.addEventListener('load', init);
