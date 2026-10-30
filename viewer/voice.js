// Voice mode: push-to-talk recording -> WAV -> Muse Voice Transcribe (through
// the server, which holds the key) -> text for the Expert Operator. Replies can
// be read aloud with the browser's speech synthesis.

const SAMPLE_RATE = 16000;

function encodeWav(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, SAMPLE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([buf], { type: "audio/wav" });
}

async function toWav(blob) {
  const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  return encodeWav((await offline.startRendering()).getChannelData(0));
}

export async function transcribe(wav) {
  const res = await fetch("api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  if (!res.ok) throw new Error(`transcription failed (${res.status}): ${await res.text()}`);
  return (await res.json()).text;
}

export function initVoice({ button, status, onText, speakToggle }) {
  let recorder = null;
  let chunks = [];

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        status("Transcribing with Muse Voice Transcribe…");
        const text = (await transcribe(await toWav(new Blob(chunks, { type: recorder.mimeType })))).trim();
        status("");
        if (text) onText(text);
      } catch (e) {
        status(`⚠️ ${e.message ?? e}`);
      }
    };
    recorder.start();
    button.classList.add("recording");
    button.textContent = "■ Stop";
    status("Listening… press Stop when you are done");
  }

  function stop() {
    recorder?.stop();
    recorder = null;
    button.classList.remove("recording");
    button.textContent = "🎤 Talk";
  }

  button.onclick = () => (recorder ? stop() : start().catch((e) => status(`⚠️ microphone: ${e.message ?? e}`)));

  return {
    speak(text) {
      if (!speakToggle.checked || !text || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = /[çğıöşüÇĞİÖŞÜ]/.test(text) ? "tr-TR" : "en-US";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
  };
}
