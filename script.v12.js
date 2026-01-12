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
        corePath: 'lib/ffmpeg/ffmpeg-core.js'
    });
    await ffmpeg.load();
    log("FFmpeg engine ready.");
}

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
        // Command: Loop image, add audio, use libx264, tune for still image, 
        // copy audio without re-encoding, stop at shortest stream (audio).
        // Using -vf format=yuv420p for standard player compatibility.
        await ffmpeg.run(
            '-loop', '1',
            '-i', 'image',
            '-i', 'audio.mp3',
            '-c:v', 'libx264',
            '-tune', 'stillimage',
            '-c:a', 'copy',
            '-shortest',
            '-pix_fmt', 'yuv420p',
            'out.mp4'
        );

        log("Finalizing...");
        const data = ffmpeg.FS('readFile', 'out.mp4');
        
        // Clean up FS to save memory
        ffmpeg.FS('unlink', 'audio.mp3');
        ffmpeg.FS('unlink', 'image');
        ffmpeg.FS('unlink', 'out.mp4');

        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getTimestamp()}_spkjs.mp4`;
        a.click();
        log("Video Download started.");

        // Reset input for next use
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