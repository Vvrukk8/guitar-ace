/**
 * Guitar Ace — mic pitch → 9-bar tune meter
 *
 * Bars L→R: red, red, yellow, yellow, GREEN (tall), yellow, yellow, red, red
 * Flat → left · IN TUNE → center green · Sharp → right
 *
 * Requires HTTPS or localhost for getUserMedia (Mobile Safari).
 */
(function () {
  "use strict";

  const BAR_DEFS = [
    { color: "red", zone: -4 },
    { color: "red", zone: -3 },
    { color: "yellow", zone: -2 },
    { color: "yellow", zone: -1 },
    { color: "green", zone: 0 },
    { color: "yellow", zone: 1 },
    { color: "yellow", zone: 2 },
    { color: "red", zone: 3 },
    { color: "red", zone: 4 },
  ];

  // |cents| thresholds → zone magnitude 0..4
  const THRESHOLDS = [
    { maxCents: 5, zone: 0 },
    { maxCents: 15, zone: 1 },
    { maxCents: 30, zone: 2 },
    { maxCents: 50, zone: 3 },
    { maxCents: Infinity, zone: 4 },
  ];

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const IDLE_MS = 700;
  const MIN_HZ = 70;
  const MAX_HZ = 500;
  const FFT_SIZE = 2048;

  const ledRow = document.getElementById("ledRow");
  const a4Input = document.getElementById("a4Input");
  const a4Slider = document.getElementById("a4Slider");
  const a4Down = document.getElementById("a4Down");
  const a4Up = document.getElementById("a4Up");
  const micBtn = document.getElementById("micBtn");
  const micLabel = document.getElementById("micLabel");
  const statusHint = document.getElementById("statusHint");
  const noteNameEl = document.getElementById("noteName");
  const centsReadout = document.getElementById("centsReadout");
  const resetBtn = document.getElementById("resetBtn");
  const levelFill = document.getElementById("levelFill");
  const sensSlider = document.getElementById("sensSlider");

  let a4 = 440;
  let litIndex = "";
  let idleTimer = null;
  let listening = false;
  let smoothedCents = null;
  let smoothedMidi = null;

  let audioCtx = null;
  let mediaStream = null;
  let analyser = null;
  let timeData = null;
  let floatBuf = null;
  let rafId = null;

  const leds = BAR_DEFS.map((def) => {
    const el = document.createElement("div");
    el.className = `led ${def.color}`;
    el.dataset.zone = String(def.zone);
    el.setAttribute("role", "presentation");
    ledRow.appendChild(el);
    return el;
  });

  function clampA4(n) {
    n = Math.round(Number(n) || 440);
    return Math.min(450, Math.max(430, n));
  }

  function setA4(n, syncSlider) {
    a4 = clampA4(n);
    a4Input.value = String(a4);
    if (syncSlider !== false) a4Slider.value = String(a4);
  }

  function clearLeds() {
    leds.forEach((el) => el.classList.remove("lit"));
    litIndex = "";
  }

  // Left = low (flat), right = high (sharp). One bar at a time.
  function lightSigned(zone) {
    const idx = Math.max(0, Math.min(8, zone + 4));
    const key = String(idx);
    if (key === litIndex) return;
    clearLeds();
    leds[idx].classList.add("lit");
    litIndex = key;
  }

  function centsToZone(cents) {
    const abs = Math.abs(cents);
    let mag = 4;
    for (const t of THRESHOLDS) {
      if (abs <= t.maxCents) {
        mag = t.zone;
        break;
      }
    }
    if (mag === 0) return 0;
    return cents < 0 ? -mag : mag;
  }

  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      clearLeds();
      noteNameEl.textContent = "—";
      centsReadout.textContent = "—";
      smoothedCents = null;
      smoothedMidi = null;
    }, IDLE_MS);
  }

  function showPitch(freq) {
    const semis = 12 * Math.log2(freq / a4);
    const midiFloat = semis + 69;
    const midi = Math.round(midiFloat);
    let cents = (midiFloat - midi) * 100;

    if (smoothedMidi === midi && smoothedCents !== null) {
      smoothedCents = smoothedCents * 0.65 + cents * 0.35;
      cents = smoothedCents;
    } else {
      smoothedMidi = midi;
      smoothedCents = cents;
    }

    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    noteNameEl.textContent = name + octave;
    const rounded = Math.round(cents);
    const sign = rounded > 0 ? "+" : "";
    centsReadout.textContent = sign + rounded + " ¢";
    lightSigned(centsToZone(cents));
    scheduleIdle();
  }

  /** Sensitivity 1–100 → RMS gate. Higher = hears quieter notes. */
  function gateFromSensitivity() {
    const s = Number(sensSlider.value) || 55;
    return 0.045 - (s / 100) * 0.038;
  }

  function autoCorrelate(buf, sampleRate) {
    const n = buf.length;
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < gateFromSensitivity()) return -1;

    let r1 = 0;
    let r2 = n - 1;
    const th = 0.2;
    for (let i = 0; i < n / 2; i++) {
      if (Math.abs(buf[i]) < th) { r1 = i; break; }
    }
    for (let i = 1; i < n / 2; i++) {
      if (Math.abs(buf[n - i]) < th) { r2 = n - i; break; }
    }
    const slice = buf.subarray(r1, r2);
    const size = slice.length;
    if (size < 64) return -1;

    const c = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let j = 0; j < size - i; j++) sum += slice[j] * slice[j + i];
      c[i] = sum;
    }

    let d = 0;
    while (d < size - 1 && c[d] > c[d + 1]) d++;
    let maxval = -1;
    let maxpos = -1;
    const minLag = Math.floor(sampleRate / MAX_HZ);
    const maxLag = Math.min(size - 2, Math.floor(sampleRate / MIN_HZ));
    for (let i = Math.max(d, minLag); i <= maxLag; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }
    if (maxpos < 0 || c[0] <= 0 || maxval < c[0] * 0.35) return -1;

    const x1 = c[maxpos - 1] || 0;
    const x2 = c[maxpos];
    const x3 = c[maxpos + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    let t0 = maxpos;
    if (a) t0 = maxpos - b / (2 * a);
    const freq = sampleRate / t0;
    if (freq < MIN_HZ || freq > MAX_HZ) return -1;
    return freq;
  }

  function loop() {
    if (!listening || !analyser) return;
    analyser.getFloatTimeDomainData(floatBuf);
    analyser.getByteTimeDomainData(timeData);

    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.sqrt(sum / timeData.length);
    levelFill.style.width = Math.min(100, (level / 0.35) * 100).toFixed(1) + "%";

    const freq = autoCorrelate(floatBuf, audioCtx.sampleRate);
    if (freq > 0) showPitch(freq);

    rafId = requestAnimationFrame(loop);
  }

  async function startMic() {
    statusHint.textContent = "Requesting microphone…";
    micBtn.classList.remove("error");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia not supported");
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      timeData = new Uint8Array(analyser.fftSize);
      floatBuf = new Float32Array(analyser.fftSize);
      listening = true;
      micBtn.classList.add("listening");
      micBtn.setAttribute("aria-pressed", "true");
      micLabel.textContent = "Listening — tap to stop";
      statusHint.textContent = "Play one open string. Flat lights the left, sharp the right, green when you’re in.";
      rafId = requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      listening = false;
      micBtn.classList.add("error");
      micBtn.setAttribute("aria-pressed", "false");
      micLabel.textContent = "Mic blocked — try again";
      statusHint.textContent = "Microphone permission denied or unavailable. On iPhone: Settings → Safari → Microphone. Use HTTPS.";
      stopMic(false);
    }
  }

  function stopMic(updateUi) {
    listening = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    analyser = null;
    levelFill.style.width = "0%";
    if (updateUi !== false) {
      micBtn.classList.remove("listening", "error");
      micBtn.setAttribute("aria-pressed", "false");
      micLabel.textContent = "Enable Microphone";
      statusHint.textContent = "Mic off. Tap the button to listen again.";
    }
  }

  function resetAll() {
    clearLeds();
    noteNameEl.textContent = "—";
    centsReadout.textContent = "—";
    smoothedCents = null;
    smoothedMidi = null;
    if (idleTimer) clearTimeout(idleTimer);
  }

  a4Input.addEventListener("change", () => setA4(a4Input.value));
  a4Input.addEventListener("blur", () => setA4(a4Input.value));
  a4Slider.addEventListener("input", () => setA4(a4Slider.value, false));
  a4Down.addEventListener("click", () => setA4(a4 - 1));
  a4Up.addEventListener("click", () => setA4(a4 + 1));
  micBtn.addEventListener("click", () => (listening ? stopMic(true) : startMic()));
  resetBtn.addEventListener("click", resetAll);

  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && audioCtx && audioCtx.state === "suspended" && listening) {
      audioCtx.resume().catch(() => {});
    }
  });

  setA4(440);
  clearLeds();
})();
