// Each recording owns its recorder, MIME type, stream, meter and chunks.
// Typed requests never enter speak(); only ask(text, { voice: true }) does.
import { el, reducedMotion } from "./ui.js";
const SAMPLE_RATE = 16000;

export function encodeWav(samples) {
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
  const context = new AudioContext();
  let decoded;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
  const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded; src.connect(offline.destination); src.start();
  return encodeWav((await offline.startRendering()).getChannelData(0));
}

export async function transcribe(wav, signal) {
  const res = await fetch("api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, signal });
  if (!res.ok) throw new Error(`transcription failed (${res.status}): ${await res.text()}`);
  return (await res.json()).text;
}

export function initVoice({ button, status, onText }) {
  let recording = null, pending = false, epoch = 0, state = "Idle", running = false;
  let aborter = null, disposed = false, speechDone = null;
  let gesture = null, keyboardDown = 0;
  const bars = Array.from({ length: 12 }, () => el("i"));
  const meterText = el("span", { className: "meter-text", textContent: "Quiet" });
  const meter = el("span", { className: "mic-meter", hidden: true, ariaLabel: "Microphone input level" }, ...bars, meterText);
  const readAloud = el("input", { type: "checkbox", checked: true });
  const stopSpeech = el("button", { textContent: "Stop speaking", hidden: true });
  button.closest(".composer").append(el("div", { className: "voice-controls" }, meter,
    el("label", {}, readAloud, " Read aloud spoken replies"), stopSpeech));
  const setState = (value, message = value) => {
    state = value; button.dataset.state = value.toLowerCase();
    button.classList.toggle("recording", value === "Listening");
    // Icon-only button: the state is in its label and tooltip.
    const label = value === "Listening" ? "Listening… tap to stop" : pending ? "Cancel mic" : "Talk";
    button.title = label; button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(value === "Listening" || pending));
    button.disabled = running || value === "Transcribing";
    stopSpeech.hidden = value !== "Speaking";
    status(value === "Idle" ? message === "Idle" ? "" : message : message);
  };
  function stopMeter(session) {
    if (session.meterStopped) return;
    session.meterStopped = true;
    clearInterval(session.meterTimer);
    session.source?.disconnect(); session.analyser?.disconnect();
    session.context?.close().catch(() => {});
    if (!recording || recording === session) meter.hidden = true;
  }
  function startMeter(session) {
    try {
      const context = session.context = new AudioContext();
      const source = session.source = context.createMediaStreamSource(session.stream);
      const analyser = session.analyser = context.createAnalyser();
      analyser.fftSize = 512; source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let level = 0, last = performance.now(), lastText = 0;
      meter.hidden = false;
      session.meterTimer = setInterval(() => {
        if (document.hidden) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const now = performance.now(), dt = now - last; last = now;
        level += (rms - level) * (1 - Math.exp(-dt / (rms > level ? 60 : 180)));
        meter.classList.toggle("static", reducedMotion.matches);
        if (reducedMotion.matches) {
          if (now - lastText >= 500) { meterText.textContent = rms > 0.012 ? "Input detected" : "Quiet"; lastText = now; }
        } else bars.forEach((bar, i) => { bar.style.height = `${3 + Math.min(1, level * 10) * 15 * (0.7 + 0.3 * i / 11)}px`; });
      }, 1000 / 30);
    } catch { meter.hidden = true; /* Recording still works without a meter. */ }
  }
  async function start() {
    if (running || disposed || pending || recording || state === "Transcribing") return;
    stopSpeaking(); pending = true;
    const request = ++epoch;
    setState("Idle", "Waiting for microphone permission… release a hold to cancel");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Recording unavailable in this browser");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== epoch || disposed || !pending) { stream.getTracks().forEach((t) => t.stop()); return; }
      pending = false;
      let rec;
      try { rec = new MediaRecorder(stream); }
      catch (error) { stream.getTracks().forEach((t) => t.stop()); throw error; }
      const parts = [], mimeType = rec.mimeType;
      const session = { rec, stream, parts, mimeType, cancelled: false, request };
      recording = session;
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.onerror = () => { stop(true); setState("Idle", "Microphone recording failed; typed input is available."); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); stopMeter(session);
        if (session.cancelled || disposed || request !== epoch) return;
        const controller = aborter = new AbortController();
        setState("Transcribing", "Transcribing with Muse Voice Transcribe…");
        try {
          const wav = await toWav(new Blob(parts, { type: mimeType }));
          if (request !== epoch || disposed) return;
          const text = String(await transcribe(wav, controller.signal)).trim();
          if (request !== epoch || disposed) return;
          setState("Idle");
          if (text) await onText(text);
        } catch (error) {
          if (!disposed && error.name !== "AbortError") setState("Idle", `⚠ ${error.message ?? error}`);
        } finally { if (aborter === controller) aborter = null; }
      };
      rec.start(); startMeter(session); setState("Listening", "Listening · hold and release, or click again to stop");
    } catch (error) {
      if (request !== epoch || disposed) return;
      if (recording?.request === request) stop(true);
      pending = false; setState("Idle", `⚠ Microphone: ${error.message ?? error}. Typed input is available.`);
    }
  }
  function stop(cancel = false) {
    if (pending) { pending = false; epoch++; setState("Idle"); }
    const session = recording;
    recording = null;
    if (!session) return;
    session.cancelled = cancel;
    stopMeter(session);
    if (session.rec.state !== "inactive") session.rec.stop();
    session.stream.getTracks().forEach((t) => t.stop());
    setState(cancel ? "Idle" : "Transcribing", cancel ? "Idle" : "Transcribing…");
  }
  function toggle() { if (recording || pending) stop(); else start(); }
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || button.disabled) return;
    gesture = { at: performance.now(), already: Boolean(recording || pending) };
    button.setPointerCapture(event.pointerId);
    if (!gesture.already) start();
  });
  button.addEventListener("pointerup", () => {
    if (gesture && (gesture.already || performance.now() - gesture.at >= 250)) stop();
    gesture = null;
  });
  button.addEventListener("pointercancel", () => { gesture = null; stop(true); });
  button.addEventListener("click", (event) => { if (event.detail === 0) toggle(); });
  button.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault(); keyboardDown = performance.now();
    if (recording || pending) { stop(); keyboardDown = 0; } else start();
  });
  button.addEventListener("keyup", (event) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    if (keyboardDown && performance.now() - keyboardDown >= 250) stop();
    keyboardDown = 0;
  });
  button.addEventListener("blur", () => { if (keyboardDown) { keyboardDown = 0; stop(); } });
  function stopSpeaking() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    speechDone?.(); speechDone = null;
  }
  stopSpeech.onclick = stopSpeaking;
  readAloud.onchange = () => { if (!readAloud.checked) stopSpeaking(); };
  function dispose() { disposed = true; epoch++; pending = false; stop(true); aborter?.abort(); stopSpeaking(); }
  window.addEventListener("pagehide", dispose);
  window.addEventListener("pageshow", (event) => { if (event.persisted) { disposed = false; setState("Idle"); } });
  return {
    stop, dispose, stopSpeaking,
    setRunning(on) { running = on; if (on && (recording || pending)) stop(true); if (state !== "Speaking") setState(on ? "Running" : "Idle"); },
    speak(text) {
      stopSpeaking();
      if (!text || !readAloud.checked || !("speechSynthesis" in window) || disposed) return Promise.resolve();
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text.replace(/[*#]/g, ""));
        utterance.lang = /[çğıöşüÇĞİÖŞÜ]/.test(text) ? "tr-TR" : "en-US";
        let finished = false;
        const done = () => { if (finished) return; finished = true; clearTimeout(startTimeout); speechDone = null; setState(running ? "Running" : "Idle"); resolve(); };
        const startTimeout = setTimeout(() => { speechSynthesis.cancel(); done(); }, 10000);
        speechDone = done;
        utterance.onstart = () => { clearTimeout(startTimeout); setState("Speaking", "Speaking · Stop speaking to continue"); };
        utterance.onend = done; utterance.onerror = done;
        speechSynthesis.speak(utterance);
      });
    },
    get state() { return state; },
  };
}
