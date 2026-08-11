/* ============================================================
   Mandarin Pronunciation Practice — Application Logic  v2.5.0
   ============================================================
   Features:
     • Speech recognition (zh-CN) with LCS-aligned diff + score
     • Tone-aware diff: right syllable on the wrong pitch is called
       out as a tone slip, not lumped in with a wrong character
     • Pinyin auto-convert:  nǐ hǎo / ni3hao3 / nihao → 你好
     • English auto-translate (input): "hello" → 你好
     • Transcription annotations: pinyin line + English line
     • Score ≥ 90 % turns green
   ============================================================ */

'use strict';

/* ── Service Worker — unregister any previously installed SW ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}
// Clear leftover caches from old service workers
if ('caches' in window) {
  caches.keys().then(names => names.forEach(n => caches.delete(n)));
}

/* ── DOM References ────────────────────────────────────────── */
const targetInput        = document.getElementById('target');
const convertBtn         = document.getElementById('convertBtn');
const translateInputBtn  = document.getElementById('translateInputBtn');
const detectedLangRow    = document.getElementById('detectedLangRow');
const langChips          = detectedLangRow.querySelectorAll('.lang-chip');
const recordBtn          = document.getElementById('recordBtn');
const recordLabel        = document.getElementById('recordLabel');
const statusEl           = document.getElementById('status');
const resultsSection     = document.getElementById('results');
const transcribedEl         = document.getElementById('transcribed');
const transcribedPinyin     = document.getElementById('transcribedPinyin');
const comparisonBlock    = document.getElementById('comparisonBlock');
const targetDisplay      = document.getElementById('targetDisplay');
const targetPinyin       = document.getElementById('targetPinyin');
const diffDisplay        = document.getElementById('diffDisplay');
const toneNote           = document.getElementById('toneNote');
const scoreValue              = document.getElementById('scoreValue');
const tryAgainBtn             = document.getElementById('tryAgainBtn');
const pronounceTargetBtn      = document.getElementById('pronounceTargetBtn');
const pronounceTranscribedBtn = document.getElementById('pronounceTranscribedBtn');
const translateTargetBtn      = document.getElementById('translateTargetBtn');
const translateTranscribedBtn = document.getElementById('translateTranscribedBtn');

const offlineBar      = document.getElementById('offlineBar');
const offlineCloseBtn = document.getElementById('offlineCloseBtn');

const appLogo = document.getElementById('appLogo');

/* Translation panel (floats over the record button) */
const txOverlay    = document.getElementById('txOverlay');
const txBackdrop   = document.getElementById('txBackdrop');
const txCloseBtn   = document.getElementById('txCloseBtn');
const txHanzi      = document.getElementById('txHanzi');
const txPinyin     = document.getElementById('txPinyin');
const txEnglish    = document.getElementById('txEnglish');
const txPortuguese = document.getElementById('txPortuguese');
const txSpeakBtn   = document.getElementById('txSpeakBtn');
const txRetryBtn   = document.getElementById('txRetryBtn');

/* ── Connectivity notice ───────────────────────────────────────
   Most of this app talks to the network — the recogniser uploads audio,
   the voice comes from Edge TTS, translations from Google/MyMemory — and
   each of those used to fail in its own way, or silently.  One banner says
   it once, up front.

   `navigator.onLine` only reports whether the browser has a network
   interface, so it's a hint, not proof: it can read "online" behind a
   captive portal.  The per-feature errors stay as the real backstop.

   Anti-spam, by construction:
     • every change is compared against the state already on screen, so
       repeated or duplicate events do nothing at all;
     • transitions are debounced, and going offline waits longer than
       coming back, so a flapping connection can't strobe the banner;
     • it's one fixed element, never a stack of toasts, and dismissing it
       keeps it down until the connection has actually recovered.
   ──────────────────────────────────────────────────────────── */
const OFFLINE_SETTLE_MS = 1500;   // wait this long before believing we dropped
const ONLINE_SETTLE_MS  = 300;    // …but restore promptly

let connectivityShown = true;     // assume online until told otherwise
let connectivityTimer = null;
let offlineDismissed  = false;

function applyConnectivity(online) {
  if (online === connectivityShown) return;   // nothing actually changed
  connectivityShown = online;

  document.body.classList.toggle('is-offline', !online);
  if (online) offlineDismissed = false;       // a fresh drop earns a fresh notice
  offlineBar.hidden = online || offlineDismissed;
}

function scheduleConnectivityCheck() {
  clearTimeout(connectivityTimer);
  // Re-read navigator.onLine when the timer fires rather than trusting the
  // event that woke us — by then the connection may have settled the other way.
  connectivityTimer = setTimeout(
    () => applyConnectivity(navigator.onLine),
    navigator.onLine ? ONLINE_SETTLE_MS : OFFLINE_SETTLE_MS);
}

window.addEventListener('online',  scheduleConnectivityCheck);
window.addEventListener('offline', scheduleConnectivityCheck);

offlineCloseBtn.addEventListener('click', () => {
  offlineDismissed = true;
  offlineBar.hidden = true;   // the dimming stays: we're still offline
});

applyConnectivity(navigator.onLine);   // the page may have loaded offline

/* ── Easter egg: seven taps on the logo ────────────────────────
   Undocumented on purpose.  Everything about it is best-effort: the
   sound lives on someone else's CDN, so offline, a blocked request, a
   stalled one, or a browser that refuses the format all end the same
   way — nothing plays, nothing is logged, nothing looks broken.

   The clip is only fetched on the seventh tap: it is 140 kB nobody
   asked for, and requesting it at load would also hand every visitor's
   IP to a third party for a joke they may never find.

   Nothing at all happens on an ordinary tap — no flicker, no hint that
   anything is counting.  The logo only reacts once the sound is actually
   playing, and then it has to go quiet for a spell before it will run
   again, so the joke can't be turned into a machine gun.
   ──────────────────────────────────────────────────────────── */
const EGG_TAPS        = 7;
const EGG_WINDOW_MS   = 1200;   // max gap between taps; deliberate, not accidental
const EGG_TIMEOUT_MS  = 5000;   // give up on a request that never arrives
const EGG_COOLDOWN_MS = 4000;   // quiet spell once it has finished
const EGG_SOUND_URL   =
  'https://cdn.freesound.org/previews/866/866078_18150200-hq.mp3';

let eggTaps    = 0;
let eggLastTap = 0;
let eggAudio   = null;   // kept across plays so the clip is cached, not refetched
let eggTimer   = null;
let eggReadyAt = 0;      // no re-trigger until this moment has passed

const eggPlaying = () => !!eggAudio && !eggAudio.paused;

function eggPlay() {
  if (!eggAudio) {
    eggAudio = new Audio(EGG_SOUND_URL);
    eggAudio.preload = 'none';
    eggAudio.addEventListener('ended', eggStop);
    eggAudio.addEventListener('error', eggStop);
  } else if (eggAudio.readyState > 0) {
    eggAudio.currentTime = 0;   // replay the cached clip from the top
  }

  // play() rejects on a failed load or a blocked autoplay, but a request
  // that merely hangs leaves it pending forever — hence the timeout.
  clearTimeout(eggTimer);
  eggTimer = setTimeout(() => { if (eggAudio && eggAudio.paused) eggStop(); },
                        EGG_TIMEOUT_MS);

  const attempt = eggAudio.play();
  if (attempt && typeof attempt.catch === 'function') attempt.catch(eggStop);

  appLogo.classList.add('logo--egg');
}

function eggStop() {
  clearTimeout(eggTimer);
  eggReadyAt = Date.now() + EGG_COOLDOWN_MS;   // counts from the end, not the start
  if (eggAudio) {
    eggAudio.pause();
    // Nothing loaded means the fetch failed or stalled: drop the element so a
    // dead CDN can't hold a socket open, and so the next try starts clean.
    if (eggAudio.readyState === 0) {
      eggAudio.removeAttribute('src');
      eggAudio.load();
      eggAudio = null;
    }
  }
  appLogo.classList.remove('logo--egg');
}

appLogo.addEventListener('click', () => {
  const now = Date.now();
  eggTaps = (now - eggLastTap < EGG_WINDOW_MS) ? eggTaps + 1 : 1;
  eggLastTap = now;

  if (eggTaps < EGG_TAPS) return;
  eggTaps = 0;

  // Still playing, or inside the cooldown that follows: swallow it. The
  // counter is spent either way, so leaning on the logo can't queue up a
  // second run to fire the moment the first finishes.
  if (eggPlaying() || now < eggReadyAt) return;
  eggPlay();
});

/* ── Speech Recognition ────────────────────────────────────── */
const SpeechRecognition =
  window['SpeechRecognition'] || window['webkitSpeechRecognition'];

if (!SpeechRecognition) {
  showStatus(
    '⚠️ Your browser does not support the Web Speech API. ' +
    'Please use Chrome on Android or desktop.'
  );
  recordBtn.disabled = true;
}

let recognition = null;
let isRecording  = false;
let stopping     = false;   // stop() sent, waiting for the engine's onend

/* Auto-stop bookkeeping: the engine sometimes keeps the session open long
   after the speaker is done, so we close it ourselves once the audio has
   been quiet for a moment.  (Hold-to-talk switches all of this off — there
   the user's finger decides when the session ends.) */
const SILENCE_MS  = 1400;   // quiet time after speech before we stop
const MAX_REC_MS  = 15000;  // hard cap so a stuck session can't run forever
const MAX_HOLD_MS = 120000; // same, but generous while the button is held
let silenceTimer  = null;
let maxRecTimer   = null;
let lastInterim   = '';     // best interim guess, used if stop() yields nothing
let resultSent    = false;  // a transcript was already handed to the UI
let speechStarted = false;  // the engine reported the start of an utterance

/* ── Hold-to-talk ──────────────────────────────────────────────
   A quick tap works exactly as before: the session auto-closes on
   silence.  Press and *hold* the button and nothing stops the
   session until the button is released, so long phrases (with
   pauses for breath) come through in one piece.                 */
const HOLD_MS   = 350;      // press longer than this ⇒ hold-to-talk
const IDLE_LABEL = 'Tap or Hold';
let holdMode    = false;    // current session ends only on release
let pressActive = false;    // pointer / key currently held on a record button
let pressStart  = 0;
/* Hold sessions can produce several final chunks (the engine finalises a
   phrase whenever the speaker pauses); we stitch them back together. */
let finalChunks   = [];
let lastFinalAlts = [];

function clearRecTimers() {
  clearTimeout(silenceTimer); silenceTimer = null;
  clearTimeout(maxRecTimer);  maxRecTimer  = null;
}

/* Restart the quiet-countdown; when it expires we stop as if the user had
   tapped the button again.  No-op while the button is held. */
function armSilenceTimer() {
  if (holdMode) return;
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => { if (isRecording) stopRecording(); }, SILENCE_MS);
}

/* Everything heard this session that hasn't been handed to the UI yet:
   the finalised chunks plus whatever the engine is still chewing on.
   Returns the alternatives of the *last* chunk, each prefixed with the
   earlier chunks, so homophone matching still has something to work with. */
function collectPending() {
  const joined = (s) => (finalChunks.join('') + s).trim();

  if (lastInterim) {
    const combined = joined(lastInterim);
    return combined ? [combined] : [];
  }
  if (finalChunks.length) {
    const head = finalChunks.slice(0, -1).join('');
    const tail = lastFinalAlts.length ? lastFinalAlts : [finalChunks[finalChunks.length - 1]];
    return tail.map(a => (head + a).trim()).filter(Boolean);
  }
  return [];
}

/* Which UI initiated the current recording — the record button, its label,
   the status element and the callback that receives the transcript.
   Defaults to the Practice view; the Flashcards view swaps it in on click. */
const practiceRec = {
  btn:      recordBtn,
  label:    recordLabel,
  statusEl: statusEl,
  onResult: handleTranscript,
};
let activeRec = practiceRec;

/* ── Press handling (tap-to-toggle *and* hold-to-talk) ─────────
   A press always starts recording immediately and optimistically
   assumes it is a hold, so no auto-stop can cut the speaker off.
   Releasing within HOLD_MS downgrades the session to the classic
   tap behaviour; releasing later ends it.                        */
function beginPress(ctx, ev) {
  if (ev) ev.preventDefault();
  if (pressActive) return;

  // Pressing again while a session is running means "stop" (tap-to-toggle).
  if (isRecording || stopping) { stopRecording(); return; }

  // Say why up front instead of opening the mic and letting the recogniser
  // come back with a bare "network error" a few seconds later.
  if (!navigator.onLine) {
    showStatus('⚠️ You\'re offline — recording needs a connection.', ctx.statusEl);
    return;
  }

  pressActive = true;
  pressStart  = Date.now();
  holdMode    = true;      // a quick release downgrades this below
  holdResumes = 0;
  startRecording(ctx);
}

function endPress() {
  if (!pressActive) return;
  pressActive = false;

  if (Date.now() - pressStart >= HOLD_MS) {
    stopRecording();       // held → release ends the session
    return;
  }

  // Quick tap → behave like before: keep listening, close on silence.
  holdMode = false;
  if (!isRecording) return;
  clearTimeout(maxRecTimer);
  maxRecTimer = setTimeout(() => { if (isRecording) stopRecording(); }, MAX_REC_MS);
  activeRec.label.textContent = 'Listening…';
  showStatus('Speak now in Mandarin…', activeRec.statusEl);
  if (speechStarted) armSilenceTimer();
}

/* Wire a record button for pointer (mouse / touch / pen) and keyboard use. */
function wireRecordButton(ctx) {
  const btn = ctx.btn;

  btn.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;   // main button only
    try { btn.setPointerCapture(ev.pointerId); } catch (e) { /* not critical */ }
    beginPress(ctx, ev);
    btn.focus({ preventScroll: true });
  });

  btn.addEventListener('pointerup',     endPress);
  btn.addEventListener('pointercancel', endPress);
  // Long-press on touch would otherwise pop up the selection callout / menu.
  btn.addEventListener('contextmenu', ev => ev.preventDefault());

  btn.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    if (ev.repeat) { ev.preventDefault(); return; }
    beginPress(ctx, ev);
  });
  btn.addEventListener('keyup', (ev) => {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    endPress();
  });
}

wireRecordButton(practiceRec);

tryAgainBtn.addEventListener('click', resetUI);

/* ── Start / Stop Recording ──────────────────────────────────
   `resume` restarts the engine mid-hold (see resumeHold) and keeps
   everything heard so far instead of starting a fresh transcript. */
function startRecording(ctx, resume = false) {
  if (!SpeechRecognition) return;
  if (isRecording || stopping) return;   // a session is still winding down
  activeRec = ctx;

  recognition = new SpeechRecognition();
  recognition.lang            = 'zh-CN';
  // Interim results are what let us notice that the speaker went quiet, so we
  // can end the session automatically instead of waiting for a second tap.
  recognition.interimResults  = true;
  // Ask for several guesses: short single syllables (你/我/去…) are often
  // mis-heard as a homophone on the first guess, so we check them all.
  recognition.maxAlternatives = 6;
  // While the button is held the speaker may pause mid-phrase; continuous
  // mode keeps the session alive across those pauses instead of finalising.
  recognition.continuous      = holdMode;

  if (resume) {
    // Carry an unfinished phrase over into the new session.
    if (lastInterim) { finalChunks.push(lastInterim); lastFinalAlts = [lastInterim]; }
    lastInterim = '';
  } else {
    lastInterim   = '';
    resultSent    = false;
    finalChunks   = [];
    lastFinalAlts = [];
  }
  speechStarted = false;

  recognition.onstart = () => {
    isRecording = true;
    // The hard cap outranks a stuck finger, so drop the press first —
    // otherwise onend would just resume the hold.
    maxRecTimer = setTimeout(() => { if (isRecording) cancelRecording(); },
                             holdMode ? MAX_HOLD_MS : MAX_REC_MS);
    // The button may have been released while the engine was starting up.
    if (holdMode && !pressActive) { stopRecording(); return; }
    activeRec.btn.classList.add('record-btn--recording');
    activeRec.btn.setAttribute('aria-pressed', 'true');
    activeRec.btn.setAttribute('aria-label', 'Stop recording');
    activeRec.label.textContent = holdMode ? 'Release to Stop' : 'Listening…';
    showStatus(holdMode ? 'Keep holding and speak… release when done'
                        : 'Speak now in Mandarin…', activeRec.statusEl);
    if (!resume) startMicMeter(activeRec.btn);   // a resumed hold keeps its meter
  };

  // Speech started — from here on, a stretch of silence means "done talking".
  recognition.onspeechstart = () => { speechStarted = true; armSilenceTimer(); };

  // The engine itself noticed the end of the utterance: close immediately —
  // unless the button is still held, in which case the user isn't done.
  recognition.onspeechend = () => { if (isRecording && !holdMode) stopRecording(); };

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const alternatives = Array.from(result)
      .map(a => a.transcript.trim())
      .filter(Boolean);

    if (result.isFinal) {
      if (holdMode) {
        // Bank this chunk and keep listening until the button is released.
        finalChunks.push(alternatives[0] || '');
        lastFinalAlts = alternatives;
        lastInterim   = '';
      } else {
        deliverResult(alternatives);
        stopRecording();          // no reason to keep the mic open
      }
    } else {
      lastInterim = alternatives[0] || lastInterim;
      armSilenceTimer();          // still talking — push the deadline back
    }
  };

  recognition.onend = () => {
    // Still holding the button? The engine closed on its own (a long pause,
    // its own time limit…) — that's exactly what hold-to-talk must ignore.
    if (pressActive && holdMode) { resumeHold(); return; }

    // stop() usually flushes a final result, but if it didn't, fall back to
    // what we banked so the user still sees what was heard.
    if (!resultSent) {
      const pending = collectPending();
      if (pending.length) deliverResult(pending);
    }
    setIdleState();
  };

  recognition.onerror = (event) => {
    console.warn('[Speech] Error:', event.error);
    const target = activeRec.statusEl;
    const fatal = event.error === 'not-allowed' ||
                  event.error === 'service-not-allowed' ||
                  event.error === 'audio-capture';
    // A recoverable hiccup while the button is held: let onend resume us.
    if (pressActive && holdMode && !fatal) return;
    if (!resultSent) {
      const pending = collectPending();
      if (pending.length) deliverResult(pending);
    }
    pressActive = false;
    setIdleState();
    const messages = {
      'no-speech':           'No speech detected. Please try again.',
      'audio-capture':       'Microphone not found. Check your device settings.',
      'not-allowed':         'Microphone permission denied. Please allow access and reload.',
      'network':             'Network error. Check your connection.',
      'aborted':             '',
      'service-not-allowed': 'Speech service not allowed (needs HTTPS).',
    };
    const msg = messages[event.error];
    if (msg && !resultSent) showStatus('⚠️ ' + msg, target);
  };

  try { recognition.start(); }
  catch (e) { console.warn('[Speech] Could not start:', e); setIdleState(); }
}

/* Hand a transcript to whichever view started the recording — exactly once
   per session, since a final result and the onend fallback can both fire. */
function deliverResult(alternatives) {
  if (resultSent) return;
  resultSent = true;
  activeRec.onResult(alternatives[0] || '', alternatives);
}

/* The engine ended a session while the button is still held — start a new
   one straight away, keeping the transcript we've built up. The mic meter
   and the button's recording state stay as they are, so the restart is
   invisible to the user. */
const MAX_HOLD_RESUMES = 40;   // stop chasing an engine that won't stay up
let holdResumes = 0;

function resumeHold() {
  clearRecTimers();
  stopping    = false;
  isRecording = false;
  if (++holdResumes > MAX_HOLD_RESUMES) { pressActive = false; setIdleState(); return; }
  startRecording(activeRec, true);
}

/* End the session for good — used when something other than the user's
   finger closes it (view change, next card, hard cap), so a held button
   can't resurrect it. */
function cancelRecording() {
  pressActive = false;
  stopRecording();
}

function stopRecording() {
  if (stopping) return;         // stop() already requested; wait for onend
  stopping = true;
  clearRecTimers();
  if (recognition) { try { recognition.stop(); } catch (e) { setIdleState(); } }
}

function setIdleState() {
  clearRecTimers();
  stopping    = false;
  isRecording = false;
  holdMode    = false;
  pressActive = false;
  stopMicMeter();
  activeRec.btn.classList.remove('record-btn--recording');
  activeRec.btn.setAttribute('aria-pressed', 'false');
  activeRec.btn.setAttribute('aria-label', 'Start recording');
  activeRec.label.textContent = IDLE_LABEL;
}

/* ── Live microphone level meter ───────────────────────────────
   Opens a second mic stream (independent of the Speech API) and
   measures input volume each frame, exposing it as the CSS
   --mic-level custom property (0–1) on the active record button.
   Purely cosmetic — if it fails, recording still works.
   ──────────────────────────────────────────────────────────── */
let micStream   = null;
let micAudioCtx = null;
let micRafId    = null;

/* Phones/tablets typically allow only ONE microphone consumer at a time,
   so a second stream for the meter would starve the Speech API and it would
   hang on "Listening…". Detect touch devices and skip the meter there — the
   CSS pulsing ring still signals that recording is active. */
const METER_DISABLED =
  (navigator.maxTouchPoints || 0) > 0 ||
  (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

async function startMicMeter(btn) {
  if (METER_DISABLED) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    // Raw tap: disable AGC/noise/echo processing so this passive meter
    // stream doesn't fight the Speech API's own capture.
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    console.warn('[MicMeter] getUserMedia failed:', e);
    return;
  }
  // Recording may have already stopped while we awaited permission
  if (!isRecording) { micStream.getTracks().forEach(t => t.stop()); micStream = null; return; }

  const Ctx = window.AudioContext || window['webkitAudioContext'];
  micAudioCtx = new Ctx();
  const source   = micAudioCtx.createMediaStreamSource(micStream);
  const analyser = micAudioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let smoothed = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;   // −1 … 1
      sum += v * v;
    }
    const rms   = Math.sqrt(sum / data.length);
    const level = Math.min(1, rms * 3.2);          // amplify for visibility
    smoothed += (level - smoothed) * 0.35;         // ease jitter, keep it snappy
    btn.style.setProperty('--mic-level', smoothed.toFixed(3));
    micRafId = requestAnimationFrame(tick);
  };
  tick();
}

function stopMicMeter() {
  if (micRafId)    { cancelAnimationFrame(micRafId); micRafId = null; }
  if (micStream)   { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (micAudioCtx) { micAudioCtx.close().catch(() => {}); micAudioCtx = null; }
  activeRec.btn.style.setProperty('--mic-level', '0');
}

/* ── Handle Transcription ──────────────────────────────────────
   Called with the final zh-CN transcript from the Speech API.
   ──────────────────────────────────────────────────────────── */
function handleTranscript(transcript, alternatives = [transcript]) {
  showStatus('');

  if (!transcript) {
    showStatus('No speech was detected. Please try again.');
    return;
  }

  const target = targetInput.value.trim();

  // With a target set, keep whichever guess best matches it so a correct
  // attempt isn't penalised for a homophone landing as the top guess.
  if (target) {
    const cands = (alternatives.length ? alternatives : [transcript]).filter(Boolean);
    let best = cands[0], bestScore = -1;
    for (const c of cands) {
      const s = compareChars(target, c).score;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    transcript = best;
  }

  transcribedEl.textContent = transcript;
  pronounceTranscribedBtn.hidden = false;   // show TTS button for result
  translateTranscribedBtn.hidden = false;   // …and the translation panel

  // Pinyin under the transcript; translations wait in the panel
  showTranscriptAnnotations(transcript);

  if (target) {
    const { charResults, score, toneSlips } = compareChars(target, transcript);

    targetDisplay.textContent = target;
    if (typeof pinyinPro !== 'undefined') {
      targetPinyin.textContent = pinyinPro.pinyin(target, { separator: ' ' });
      targetPinyin.hidden = false;
    } else {
      targetPinyin.hidden = true;
    }
    renderDiff(charResults);
    renderToneNote(toneSlips);
    scoreValue.textContent = score + '%';
    // ≥ 90 % → green; < 90 % → default red
    scoreValue.classList.toggle('score__value--good', score >= 90);

    comparisonBlock.hidden = false;
  } else {
    comparisonBlock.hidden = true;
  }

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Transcript Annotations ────────────────────────────────────
   Displays pinyin (via the pinyinPro CDN library if available)
   and an English translation (via the MyMemory free API) below
   the "You said" Chinese text.
   ──────────────────────────────────────────────────────────── */
/* ── Get pinyin for Chinese text ───────────────────────────────
   Uses pinyin-pro CDN library if loaded, otherwise falls back
   to the MyMemory transliteration API (zh-CN → pinyin).
   ──────────────────────────────────────────────────────────── */
function getPinyinLib() {
  if (typeof pinyinPro !== 'undefined') return pinyinPro;
  if (typeof pinyin_pro !== 'undefined') return pinyin_pro;
  return null;
}

async function getPinyin(chineseText) {
  const lib = getPinyinLib();
  if (lib) return lib.pinyin(chineseText, { separator: ' ' });
  return null;
}

/* Normalised, toneful pinyin used to compare pronunciations.
   e.g. 他 and 她 → "tā"  (homophones match; wrong tone does not).
   Returns null when the pinyin library isn't loaded. */
function pinyinKey(text) {
  const lib = getPinyinLib();
  if (!lib) return null;
  return lib.pinyin(text, { separator: ' ', toneType: 'symbol' })
            .toLowerCase()
            .replace(/\s+/g, '');
}

let annotationGeneration = 0;   // invalidates stale in-flight fetches

/* Only pinyin goes under the transcript — the English and Portuguese
   readings live in the translation panel, one tap away, so the results
   card keeps the same compact height whatever was said. */
async function showTranscriptAnnotations(chineseText) {
  const gen = ++annotationGeneration;

  transcribedPinyin.textContent = '…';
  transcribedPinyin.hidden      = false;

  // Warm the panel's cache now, so opening it is instant
  translationFor(chineseText);

  const pinyin = await getPinyin(chineseText);
  if (gen !== annotationGeneration) return;   // reset, or a newer transcript

  transcribedPinyin.textContent = pinyin ?? '';
  transcribedPinyin.hidden      = !pinyin;
}

/* ── Translation panel ─────────────────────────────────────────
   One floating window shared by the target phrase and the
   transcript.  Results are cached per phrase so reopening it (or
   opening it for a phrase already annotated) costs no request.
   ──────────────────────────────────────────────────────────── */
const translationCache = new Map();   // chinese text → Promise<{en, pt}>

function translationFor(chineseText, { refresh = false } = {}) {
  if (refresh) translationCache.delete(chineseText);

  if (!translationCache.has(chineseText)) {
    const pending = Promise.all([
      translateText(chineseText, 'zh-CN', 'en'),
      translateText(chineseText, 'zh-CN', 'pt-BR'),
    ]).then(([en, pt]) => ({ en, pt }));

    // A run where both sides failed is worth retrying, so don't keep it
    pending.then(({ en, pt }) => {
      if (!en && !pt) translationCache.delete(chineseText);
    });

    translationCache.set(chineseText, pending);
  }
  return translationCache.get(chineseText);
}

let txText       = '';   // the phrase currently in the panel
let txGeneration = 0;    // invalidates results for a phrase we've moved off

function setTxLine(el, text, state) {
  el.textContent = text;
  el.classList.toggle('tx-line__text--pending', state === 'pending');
  el.classList.toggle('tx-line__text--failed',  state === 'failed');
}

async function openTranslation(chineseText, { refresh = false } = {}) {
  const text = (chineseText || '').trim();
  if (!text) return;

  const gen = ++txGeneration;
  txText    = text;

  txHanzi.textContent  = text;
  txPinyin.textContent = getPinyinLib()?.pinyin(text, { separator: ' ' }) ?? '';
  setTxLine(txEnglish,    'Translating…', 'pending');
  setTxLine(txPortuguese, 'Traduzindo…',  'pending');
  txRetryBtn.hidden = true;

  if (txOverlay.hidden) {
    txOverlay.hidden = false;
    document.body.classList.add('tx-open');
    txCloseBtn.focus();
  }

  // Anything translated earlier this session is still readable offline;
  // anything else can't be fetched, so say so rather than spinning.
  if (!navigator.onLine && !(translationCache.has(text) && !refresh)) {
    setTxLine(txEnglish,    'Offline — connect to translate',      'failed');
    setTxLine(txPortuguese, 'Offline — conecte-se para traduzir',  'failed');
    txRetryBtn.hidden = false;
    return;
  }

  const { en, pt } = await translationFor(text, { refresh });
  if (gen !== txGeneration) return;   // panel closed or moved to another phrase

  setTxLine(txEnglish,    en ?? 'Translation unavailable',  en ? null : 'failed');
  setTxLine(txPortuguese, pt ?? 'Tradução indisponível',    pt ? null : 'failed');
  txRetryBtn.hidden = !!(en && pt);
}

function closeTranslation() {
  if (txOverlay.hidden) return;
  txGeneration++;            // drop whatever is still in flight
  txOverlay.hidden = true;
  document.body.classList.remove('tx-open');
  stopCurrentAudio();
}

txCloseBtn.addEventListener('click', closeTranslation);
txBackdrop.addEventListener('click', closeTranslation);
txSpeakBtn.addEventListener('click', () => { if (txText) speak(txText, txSpeakBtn); });
txRetryBtn.addEventListener('click', () => openTranslation(txText, { refresh: true }));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTranslation();
});

translateTranscribedBtn.addEventListener('click',
  () => openTranslation(transcribedEl.textContent));
translateTargetBtn.addEventListener('click',
  () => openTranslation(targetInput.value));

/* ── Translation ───────────────────────────────────────────────
   Primary:  Google Translate free "gtx" endpoint — best quality,
             handles pt-BR ↔ zh-CN directly. Unofficial, so it
             may break someday; the fallback covers that.
   Fallback: MyMemory free API — 5 000 chars/day anonymous; set
             MYMEMORY_EMAIL to raise the limit to 50 000/day.
   Returns the translated string, or null on any failure.
   ──────────────────────────────────────────────────────────── */
const MYMEMORY_EMAIL = '';   // optional contact email → higher MyMemory quota

async function translateText(text, fromLang, toLang) {
  const result = await translateGoogle(text, fromLang, toLang);
  return result ?? translateMyMemory(text, fromLang, toLang);
}

/* AbortController so a slow connection doesn't block the UI forever */
function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function translateGoogle(text, fromLang, toLang) {
  try {
    const sl  = fromLang === 'pt-BR' ? 'pt' : fromLang;
    const tl  = toLang   === 'pt-BR' ? 'pt' : toLang;
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const data = await res.json();
    // data[0] is a list of [translatedSegment, sourceSegment, …] entries
    const out = (data?.[0] ?? []).map(seg => seg?.[0] ?? '').join('').trim();
    return out || null;
  } catch (e) {
    console.warn('[Translate:Google]', e.name === 'AbortError' ? 'Timed out' : e.message);
    return null;
  }
}

async function translateMyMemory(text, fromLang, toLang) {
  // MyMemory's direct pt-BR ↔ zh-CN pair has weak coverage:
  // chain through English for reliable results.
  if (fromLang === 'pt-BR' && toLang === 'zh-CN') {
    const english = await myMemoryRequest(text, 'pt-BR', 'en');
    return english ? myMemoryRequest(english, 'en', 'zh-CN') : null;
  }
  return myMemoryRequest(text, fromLang, toLang);
}

async function myMemoryRequest(text, fromLang, toLang) {
  try {
    const url =
      `https://api.mymemory.translated.net/get` +
      `?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}` +
      (MYMEMORY_EMAIL ? `&de=${encodeURIComponent(MYMEMORY_EMAIL)}` : '');

    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const data = await res.json();
    // responseStatus 200 means success; 403/429 means rate-limited
    if (data.responseStatus === 200) {
      return data.responseData.translatedText;
    }
    return null;
  } catch (e) {
    console.warn('[Translate:MyMemory]', e.name === 'AbortError' ? 'Timed out' : e.message);
    return null;
  }
}

/* ── Character normalisation for comparison ────────────────────
   Treats uppercase = lowercase and hanzi digits = arabic digits
   so the diff is not penalised for stylistic differences.
   ──────────────────────────────────────────────────────────── */
const HANZI_TO_DIGIT = {
  '零':'0','〇':'0',
  '一':'1','二':'2','三':'3','四':'4','五':'5',
  '六':'6','七':'7','八':'8','九':'9',
};

function normalizeChar(ch) {
  if (!ch) return ch;
  const lower = ch.toLowerCase();
  return HANZI_TO_DIGIT[lower] ?? lower;
}

/* Comparison key for a single character. Since this app grades
   *pronunciation*, two hanzi that sound the same (e.g. 他/她 → "tā")
   share a key and count as a match. Tone marks are kept, so a wrong
   tone still differs. Digits keep their numeric equivalence, and when
   the pinyin library isn't loaded this falls back to the plain char. */
function charKey(ch) {
  const base = normalizeChar(ch);
  if (/^[0-9]$/.test(base)) return base;              // 五 ↔ 5 etc.
  const lib = getPinyinLib();
  if (lib && /[一-鿿㐀-䶿]/.test(ch)) {
    const py = lib.pinyin(ch, { toneType: 'symbol' });
    if (py && py.trim()) return py.toLowerCase().trim();
  }
  return base;
}

/* ── Tones ─────────────────────────────────────────────────────
   Saying the right syllable on the wrong pitch and saying a different
   syllable entirely are not the same mistake — the first is a near miss
   worth naming, the second is a different word.  The diff has always had
   the information to tell them apart (charKey keeps the tone marks); it
   just reported both as "wrong".

   NFD splits ǒ into o + U+030C, so the combining mark *is* the tone.
   ──────────────────────────────────────────────────────────── */
/* Escapes, not literals: a lone combining mark in source is invisible
   and the next editor to touch this file would eat it. */
const TONE_MARKS = {
  '\u0304': 1,   // ō  macron — high level
  '\u0301': 2,   // ó  acute  — rising
  '\u030c': 3,   // ǒ  caron  — dipping
  '\u0300': 4,   // ò  grave  — falling
};
const TONE_NAMES = ['neutral', '1st', '2nd', '3rd', '4th'];

/* Tone of a pinyin syllable: 1–4, or 0 for the toneless neutral. */
function toneOf(key) {
  for (const ch of key.normalize('NFD')) {
    if (TONE_MARKS[ch]) return TONE_MARKS[ch];
  }
  return 0;
}

/* Right syllable, wrong tone?  normalizePinyin strips the marks, so equal
   bases with unequal keys means the vowels landed and only the pitch
   missed.  Guarded to letters: with the pinyin library offline charKey
   returns raw hanzi, and two different hanzi are never a tone slip. */
function isToneSlip(said, expected) {
  return said !== expected
      && /[a-z]/.test(said) && /[a-z]/.test(expected)
      && normalizePinyin(said) === normalizePinyin(expected);
}

/* ── Character Comparison ──────────────────────────────────────
   Aligns target and transcript with an LCS (longest common
   subsequence) so a single inserted or dropped character no
   longer shifts everything after it out of alignment.
   Punctuation, whitespace and symbols are ignored — the Speech
   API rarely returns them, so they shouldn't cost points.
   Classifies each slot as: correct | tone | wrong | missing | extra.

   A tone slip still scores zero for that character: this app grades
   pronunciation, and in Mandarin the tone is part of the word.  It is
   called out separately so the student knows *what* to fix, not to
   soften the mark.
   ──────────────────────────────────────────────────────────── */
const IGNORED_CHAR = /[\s\p{P}\p{S}]/u;

function compareChars(target, transcript) {
  const tChars = Array.from(target).filter(ch => !IGNORED_CHAR.test(ch));
  const sChars = Array.from(transcript).filter(ch => !IGNORED_CHAR.test(ch));
  const tNorm  = tChars.map(charKey);
  const sNorm  = sChars.map(charKey);
  const m = tChars.length;
  const n = sChars.length;

  // dp[i][j] = LCS length of tChars[i:] vs sChars[j:]
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = tNorm[i] === sNorm[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the alignment; pair up unmatched runs as substitutions
  // ("wrong") instead of separate missing + extra entries.
  const charResults = [];
  const toneSlips   = [];   // right syllable, wrong pitch — reported separately
  let matches = 0;
  let i = 0, j = 0;
  let missingRun = [], extraRun = [];

  const flushRuns = () => {
    const pairs = Math.min(missingRun.length, extraRun.length);
    for (let k = 0; k < pairs; k++) {
      const said = extraRun[k], want = missingRun[k];
      const slip = isToneSlip(said.key, want.key);
      charResults.push({
        char: said.char,
        type: slip ? 'tone' : 'wrong',
        expected: want.char,
        saidPinyin: slip ? said.key : undefined,
        wantPinyin: slip ? want.key : undefined,
      });
      if (slip) {
        toneSlips.push({
          hanzi: want.char,
          said:  said.key,   want: want.key,
          saidTone: toneOf(said.key), wantTone: toneOf(want.key),
        });
      }
    }
    for (let k = pairs; k < extraRun.length; k++) {
      charResults.push({ char: extraRun[k].char, type: 'extra' });
    }
    for (let k = pairs; k < missingRun.length; k++) {
      charResults.push({ char: missingRun[k].char, type: 'missing' });
    }
    missingRun = [];
    extraRun   = [];
  };

  while (i < m || j < n) {
    if (i < m && j < n && tNorm[i] === sNorm[j]) {
      flushRuns();
      matches++;
      charResults.push({ char: sChars[j], type: 'correct' });
      i++; j++;
    } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
      extraRun.push({ char: sChars[j], key: sNorm[j] });
      j++;
    } else {
      missingRun.push({ char: tChars[i], key: tNorm[i] });
      i++;
    }
  }
  flushRuns();

  const score = m > 0 ? Math.round((matches / m) * 100) : 0;
  return { charResults, score, toneSlips };
}

/* ── Render Diff ───────────────────────────────────────────── */
function renderDiff(charResults) {
  diffDisplay.innerHTML = '';
  const fragment = document.createDocumentFragment();

  charResults.forEach(({ char, type, expected, saidPinyin, wantPinyin }) => {
    const span = document.createElement('span');
    span.classList.add('ch', `ch--${type}`);
    span.textContent = char;
    if (type === 'tone') {
      const detail = `${wantPinyin} (${TONE_NAMES[toneOf(wantPinyin)]} tone), ` +
                     `heard ${saidPinyin} (${TONE_NAMES[toneOf(saidPinyin)]})`;
      span.setAttribute('aria-label', `right sound, wrong tone: expected ${detail}`);
      span.setAttribute('title', `Right sound, wrong tone — expected ${detail}`);
    } else if (type === 'wrong' && expected) {
      span.setAttribute('aria-label', `said ${char}, expected ${expected}`);
      span.setAttribute('title', `Expected: ${expected}`);
    }
    fragment.appendChild(span);
  });

  diffDisplay.appendChild(fragment);
}

/* ── Tone note ─────────────────────────────────────────────────
   Spelling out each slip beats a colour alone: "3rd came out as 2nd"
   is something the student can go and practise, and it names the tone
   they are actually losing when the same one keeps appearing.
   ──────────────────────────────────────────────────────────── */
function renderToneNote(toneSlips) {
  if (!toneSlips.length) {
    toneNote.hidden = true;
    toneNote.textContent = '';
    return;
  }

  const detail = toneSlips.map(s =>
    `${s.hanzi} ${s.want} → ${s.said} ` +
    `(${TONE_NAMES[s.wantTone]} → ${TONE_NAMES[s.saidTone]})`
  ).join(' · ');

  // When every slip loses the same tone, that is the lesson, not the list.
  const tones = new Set(toneSlips.map(s => s.wantTone));
  const lead = (tones.size === 1 && toneSlips.length > 1)
    ? `Your ${TONE_NAMES[toneSlips[0].wantTone]} tone is slipping — `
    : 'Right sounds, wrong tones — ';

  toneNote.textContent = lead + detail;
  toneNote.hidden = false;
}

/* ── Helpers ───────────────────────────────────────────────── */
function showStatus(message, target = statusEl) { target.textContent = message; }

function resetUI() {
  annotationGeneration++;   // drop any in-flight annotation results
  closeTranslation();
  stopCurrentAudio();       // stop Edge TTS / Web Speech playback

  resultsSection.hidden              = true;
  comparisonBlock.hidden             = true;
  transcribedEl.textContent          = '';
  transcribedPinyin.hidden           = true;
  targetPinyin.hidden                = true;
  targetPinyin.textContent           = '';
  pronounceTranscribedBtn.hidden     = true;
  translateTranscribedBtn.hidden     = true;
  pronounceTranscribedBtn.classList.remove('btn-pronounce--speaking');
  targetDisplay.textContent          = '';
  diffDisplay.innerHTML              = '';
  toneNote.hidden                    = true;
  toneNote.textContent               = '';
  scoreValue.textContent             = '0%';
  scoreValue.classList.remove('score__value--good');
  showStatus('');
  targetInput.focus();
}


/* ============================================================
   Text-to-Speech  — Edge TTS WebSocket (primary)
                    Web Speech API (fallback)
   ============================================================
   Voice:  zh-CN-YunyangNeural  (natural Mandarin male)
   Rate:   -25%
   Uses the same Edge TTS WebSocket protocol as the Python
   edge-tts package.  Falls back to Web Speech on WS failure.
   ============================================================ */

const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_VOICE = 'zh-CN-YunyangNeural';
const EDGE_TTS_RATE  = '-25%';
const EDGE_TTS_WS    = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

let currentAudio    = null;
let currentAudioUrl = null;
let currentSpeakBtn = null;
let speakGeneration = 0;      // invalidates in-flight TTS fetches

/* ── Stop any playing / pending audio and release resources ── */
function stopCurrentAudio() {
  speakGeneration++;          // cancel any in-flight Edge TTS fetch
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  currentSpeakBtn?.classList.remove('btn-pronounce--speaking');
  currentSpeakBtn = null;
  window.speechSynthesis?.cancel();
}

function makeUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* Escape text for embedding inside SSML/XML */
function escapeXml(str) {
  return str.replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function edgeTTSRequest(text, rate = EDGE_TTS_RATE) {
  return new Promise((resolve, reject) => {
    const connId = makeUUID().replace(/-/g, '');
    const url    = `${EDGE_TTS_WS}?TrustedClientToken=${EDGE_TTS_TOKEN}&ConnectionId=${connId}`;
    const ws     = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    const audioChunks = [];
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    ws.onopen = () => {
      // 1. Speech config
      ws.send(
        `X-Timestamp:${ts}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":` +
        `{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},` +
        `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      );

      // 2. SSML synthesis request
      const reqId = makeUUID().replace(/-/g, '');
      const ssml  =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
        `<voice name='${EDGE_TTS_VOICE}'>` +
        `<prosody rate='${rate}'>${escapeXml(text)}</prosody>` +
        `</voice></speak>`;

      ws.send(
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}\r\n` +
        `Path:ssml\r\n\r\n` + ssml
      );
    };

    ws.onmessage = ({ data }) => {
      if (data instanceof ArrayBuffer) {
        // Binary frame: [2-byte big-endian header length][header][MP3 audio]
        const headerLen = new DataView(data).getUint16(0);
        const audio     = data.slice(2 + headerLen);
        if (audio.byteLength > 0) audioChunks.push(audio);
      } else if (typeof data === 'string' && data.includes('Path:turn.end')) {
        ws.close();
        resolve(new Blob(audioChunks, { type: 'audio/mpeg' }));
      }
    };

    ws.onerror = (e) => { console.warn('[EdgeTTS] WS error', e); reject(e); };
    ws.onclose = (e) => {
      if (!e.wasClean && audioChunks.length === 0) {
        reject(new Error('WebSocket closed unexpectedly'));
      }
    };
  });
}

/* `rate` is an Edge TTS percentage ("-25%", "-50%"); the Web Speech
   fallback takes the same figure as a multiplier. */
async function speak(text, btn, rate = EDGE_TTS_RATE) {
  if (!text.trim()) return;

  // A second click on the active button acts as a stop button
  // (this also cancels a TTS fetch that is still in flight)
  const toggleOff = currentSpeakBtn === btn;
  stopCurrentAudio();
  if (toggleOff) return;

  btn?.classList.add('btn-pronounce--speaking');
  currentSpeakBtn = btn;
  const gen = speakGeneration;

  try {
    const blob = await edgeTTSRequest(text, rate);
    if (gen !== speakGeneration) return;   // superseded / stopped meanwhile

    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio    = audio;
    currentAudioUrl = url;

    audio.onended = audio.onerror = () => {
      if (currentAudio === audio) stopCurrentAudio();
      else URL.revokeObjectURL(url);       // superseded; just free the blob
    };

    await audio.play();
  } catch (err) {
    if (gen !== speakGeneration) return;
    console.warn('[EdgeTTS] Failed, falling back to Web Speech:', err);
    stopCurrentAudio();
    speakWebSpeech(text, btn, rate);
  }
}

function speakWebSpeech(text, btn, rate = EDGE_TTS_RATE) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang  = 'zh-CN';
  utterance.rate  = 1 + (parseInt(rate, 10) || 0) / 100;   // "-25%" → 0.75
  btn?.classList.add('btn-pronounce--speaking');
  currentSpeakBtn = btn;
  utterance.onend = utterance.onerror = () => {
    btn?.classList.remove('btn-pronounce--speaking');
    if (currentSpeakBtn === btn) currentSpeakBtn = null;
  };
  window.speechSynthesis.speak(utterance);
}

// Wire up both pronounce buttons
pronounceTargetBtn.addEventListener('click', () => {
  speak(targetInput.value.trim(), pronounceTargetBtn);
});

pronounceTranscribedBtn.addEventListener('click', () => {
  speak(transcribedEl.textContent.trim(), pronounceTranscribedBtn);
});

/* ============================================================
   Pinyin → Chinese Character Conversion
   ============================================================
   Supports:
     • nǐ hǎo   (tone marks + spaces)
     • ni3hao3  (tone numbers, compact)
     • nihao    (plain, compact)
   ============================================================ */

/* ── Robust tone stripping via NFD decomposition ─────────────
   NFD splits e.g. ǒ → o + U+030C (combining caron).
   We handle ü → v first, then strip all combining diacritics.
   This works regardless of how the OS/keyboard encodes the input.
   ──────────────────────────────────────────────────────────── */
function normalizePinyin(str) {
  return str
    .normalize('NFD')
    .toLowerCase()
    .replace(/u\u0308/g, 'v')            // ü (u + combining diaeresis) → v
    .replace(/[\u0300-\u036f]/g, '')      // strip all combining diacritics
    .replace(/([a-z]+)[1-5]/g, '$1');
}

/* ── Pinyin → Hanzi dictionary ──────────────────────────────
   Keys: plain pinyin (no tones), space-separated syllables.
   Multi-syllable entries appear first so greedy match picks
   them before falling through to single-syllable entries.
   ─────────────────────────────────────────────────────────── */
const PY = {
  // ── 3-syllable+ phrases ─────────────────────────────────
  'wei shen me':    '为什么',
  'shen me shi hou':'什么时候',
  'zen me yang':    '怎么样',
  'duo shao qian':  '多少钱',
  'yi dian er':     '一点儿',
  'mei wen ti':     '没问题',
  'you yi si':      '有意思',
  'cha bu duo':     '差不多',
  'dui bu qi':      '对不起',
  'mei guan xi':    '没关系',
  'bu ke qi':       '不客气',
  'pu tong hua':    '普通话',
  'da jia hao':     '大家好',
  'ni hao ma':      '你好吗',
  'zao shang hao':  '早上好',
  'wan shang hao':  '晚上好',
  'xia wu hao':     '下午好',
  'jia na da':      '加拿大',
  'kan dian shi':   '看电视',
  'ting yin yue':   '听音乐',
  'shen me ming zi': '什么名字',

  // ── 2-syllable words ─────────────────────────────────────
  'ni hao':    '你好',
  'xie xie':   '谢谢',
  'zai jian':  '再见',
  'man zou':   '慢走',
  'bao zhong': '保重',
  'jin tian':  '今天',
  'ming tian': '明天',
  'zuo tian':  '昨天',
  'xian zai':  '现在',
  'zao shang': '早上',
  'zhong wu':  '中午',
  'xia wu':    '下午',
  'wan shang': '晚上',
  'yi qian':   '以前',
  'yi hou':    '以后',
  'mei tian':  '每天',
  'peng you':  '朋友',
  'lao shi':   '老师',
  'xue sheng': '学生',
  'tong xue':  '同学',
  'tong shi':  '同事',
  'ba ba':     '爸爸',
  'ma ma':     '妈妈',
  'ge ge':     '哥哥',
  'di di':     '弟弟',
  'jie jie':   '姐姐',
  'mei mei':   '妹妹',
  'ye ye':     '爷爷',
  'nai nai':   '奶奶',
  'er zi':     '儿子',
  'nv er':     '女儿',
  'hai zi':    '孩子',
  'lao po':    '老婆',
  'lao gong':  '老公',
  'xian sheng':'先生',
  'zhong guo': '中国',
  'mei guo':   '美国',
  'ying guo':  '英国',
  'fa guo':    '法国',
  'ri ben':    '日本',
  'han guo':   '韩国',
  'ao zhou':   '澳洲',
  'zhong wen': '中文',
  'ying wen':  '英文',
  'han yu':    '汉语',
  'xi huan':   '喜欢',
  'zhi dao':   '知道',
  'jue de':    '觉得',
  'ren wei':   '认为',
  'chi fan':   '吃饭',
  'he shui':   '喝水',
  'kan shu':   '看书',
  'shuo hua':  '说话',
  'shang ke':  '上课',
  'xia ke':    '下课',
  'piao liang':'漂亮',
  'ke ai':     '可爱',
  'hao chi':   '好吃',
  'hao he':    '好喝',
  'hao wan':   '好玩',
  'hao ting':  '好听',
  'hao kan':   '好看',
  'hen hao':   '很好',
  'tai hao':   '太好',
  'fei chang': '非常',
  'yi dian':   '一点',
  'zen me':    '怎么',
  'shen me':   '什么',
  'na li':     '哪里',
  'zhe li':    '这里',
  'ke yi':     '可以',
  'ying gai':  '应该',
  'bi xu':     '必须',
  'yi ding':   '一定',
  'ye xu':     '也许',
  'suo yi':    '所以',
  'yin wei':   '因为',
  'dan shi':   '但是',
  'ke shi':    '可是',
  'hai shi':   '还是',
  'er qie':    '而且',
  'zhi you':   '只有',
  'zhi shi':   '只是',
  'yi qi':     '一起',
  'yi ban':    '一般',
  'yi yang':   '一样',
  'bu tong':   '不同',
  'dui le':    '对了',
  'hao de':    '好的',
  'mei cuo':   '没错',
  'dang ran':  '当然',
  'mei shi':   '没事',
  'bu cuo':    '不错',
  'guo lai':   '过来',
  'guo qu':    '过去',
  'shang qu':  '上去',
  'xia lai':   '下来',
  'jin lai':   '进来',
  'chu qu':    '出去',
  'hui lai':   '回来',
  'duo shao':  '多少',
  'da jia':    '大家',
  'dian hua':  '电话',
  'shou ji':   '手机',
  'dian nao':  '电脑',
  'wang luo':  '网络',
  'kai shi':   '开始',
  'jie shu':   '结束',
  'wen ti':    '问题',
  'ban fa':    '办法',
  'shi qing':  '事情',
  'di fang':   '地方',
  'shi jian':  '时间',
  'ji hui':    '机会',
  'gong zuo':  '工作',
  'xue xi':    '学习',
  'sheng huo': '生活',
  'jia ting':  '家庭',
  'shen ti':   '身体',
  'jian kang': '健康',
  'kuai le':   '快乐',
  'gao xing':  '高兴',
  'nan guo':   '难过',
  'sheng qi':  '生气',
  'hai pa':    '害怕',
  'xi wang':   '希望',
  'xiang nian':'想念',
  'ai qing':   '爱情',
  'hun yin':   '婚姻',
  'shui jiao': '睡觉',
  'qi chuang': '起床',
  'xi zao':    '洗澡',
  'kai che':   '开车',
  'zuo che':   '坐车',
  'shang ban': '上班',
  'xia ban':   '下班',
  'hui jia':   '回家',
  'chu men':   '出门',
  'xiu xi':    '休息',
  'yun dong':  '运动',
  'tiao wu':   '跳舞',
  'chang ge':  '唱歌',

  // ── Single syllables ─────────────────────────────────────
  'a':     '啊', 'ai':    '爱', 'an':    '安', 'ang':   '昂', 'ao':    '奥',
  'ba':    '吧', 'bai':   '白', 'ban':   '半', 'bang':  '帮', 'bao':   '包',
  'bei':   '北', 'ben':   '本', 'bi':    '比', 'bian':  '边', 'biao':  '表',
  'bie':   '别', 'bin':   '宾', 'bing':  '病', 'bo':    '播', 'bu':    '不',
  'ca':    '擦', 'cai':   '才', 'can':   '餐', 'cao':   '草', 'ce':    '测',
  'ceng':  '曾', 'cha':   '茶', 'chai':  '拆', 'chan':  '产', 'chang': '常',
  'chao':  '超', 'che':   '车', 'chen':  '晨', 'cheng': '城', 'chi':   '吃',
  'chong': '重', 'chou':  '愁', 'chu':   '出', 'chuan': '船', 'chuang':'床',
  'chun':  '春', 'ci':    '次', 'cong':  '从', 'cou':   '凑', 'cu':    '粗',
  'cuan':  '窜', 'cui':   '催', 'cun':   '村', 'cuo':   '错',
  'da':    '大', 'dai':   '带', 'dan':   '但', 'dang':  '当', 'dao':   '道',
  'de':    '的', 'dei':   '得', 'deng':  '等', 'di':    '地', 'dian':  '点',
  'ding':  '定', 'dong':  '东', 'dou':   '都', 'du':    '读', 'duan':  '段',
  'dui':   '对', 'dun':   '顿', 'duo':   '多',
  'e':     '饿', 'en':    '嗯', 'er':    '而',
  'fa':    '发', 'fan':   '饭', 'fang':  '方', 'fei':   '非', 'fen':   '分',
  'feng':  '风', 'fo':    '佛', 'fu':    '服',
  'gai':   '该', 'gan':   '感', 'gang':  '刚', 'gao':   '高', 'ge':    '个',
  'gei':   '给', 'gen':   '跟', 'geng':  '更', 'gong':  '工', 'gou':   '够',
  'gu':    '故', 'gua':   '瓜', 'guai':  '乖', 'guan':  '关', 'guang': '广',
  'gui':   '贵', 'gun':   '滚', 'guo':   '过',
  'ha':    '哈', 'hai':   '还', 'han':   '汉', 'hang':  '行', 'hao':   '好',
  'he':    '和', 'hei':   '黑', 'hen':   '很', 'heng':  '横', 'hong':  '红',
  'hou':   '后', 'hu':    '呼', 'hua':   '话', 'huai':  '坏', 'huan':  '换',
  'huang': '黄', 'hui':   '会', 'hun':   '婚', 'huo':   '火',
  'ji':    '几', 'jia':   '家', 'jian':  '见', 'jiang': '讲', 'jiao':  '叫',
  'jie':   '姐', 'jin':   '今', 'jing':  '京', 'jiong': '囧', 'jiu':   '就',
  'ju':    '句', 'juan':  '卷', 'jun':   '军',
  'ka':    '卡', 'kai':   '开', 'kan':   '看', 'kang':  '康', 'kao':   '考',
  'ke':    '可', 'ken':   '肯', 'keng':  '坑', 'kong':  '空', 'kou':   '口',
  'ku':    '苦', 'kuai':  '快', 'kuan':  '宽', 'kui':   '愧', 'kun':   '困', 'kuo':'扩',
  'la':    '啦', 'lai':   '来', 'lan':   '蓝', 'lang':  '朗', 'lao':   '老',
  'le':    '了', 'lei':   '累', 'leng':  '冷', 'li':    '里', 'lian':  '连',
  'liang': '两', 'liao':  '聊', 'lin':   '林', 'ling':  '零', 'liu':   '六',
  'long':  '龙', 'lou':   '楼', 'lu':    '路', 'luan':  '乱', 'lun':   '论',
  'luo':   '落', 'lv':    '旅',
  'ma':    '吗', 'mai':   '买', 'man':   '慢', 'mang':  '忙', 'mao':   '猫',
  'me':    '么', 'mei':   '没', 'men':   '们', 'mi':    '米', 'mian':  '面',
  'miao':  '妙', 'min':   '民', 'ming':  '名', 'mo':    '末', 'mou':   '某', 'mu': '木',
  'na':    '那', 'nai':   '奶', 'nan':   '南', 'nao':   '脑', 'ne':    '呢',
  'nei':   '内', 'neng':  '能', 'ni':    '你', 'nian':  '年', 'niang': '娘',
  'niao':  '鸟', 'nin':   '您', 'niu':   '牛', 'nong':  '农', 'nu':    '怒',
  'nuan':  '暖', 'nv':    '女',
  'o':     '哦', 'ou':    '哦',
  'pa':    '怕', 'pai':   '牌', 'pan':   '盼', 'pang':  '旁', 'pao':   '跑',
  'pei':   '陪', 'pen':   '喷', 'peng':  '朋', 'pi':    '皮', 'pian':  '片',
  'piao':  '漂', 'pin':   '品', 'ping':  '平', 'po':    '破', 'pu':    '普',
  'qi':    '起', 'qia':   '恰', 'qian':  '钱', 'qiang': '强', 'qiao':  '桥',
  'qin':   '亲', 'qing':  '请', 'qiong': '穷', 'qiu':   '球', 'qu':    '去',
  'quan':  '全', 'que':   '却', 'qun':   '群',
  'ran':   '然', 'rang':  '让', 'rao':   '绕', 're':    '热', 'ren':   '人',
  'ri':    '日', 'rong':  '容', 'rou':   '肉', 'ru':    '如', 'ruan':  '软',
  'rui':   '瑞', 'run':   '润', 'ruo':   '若',
  'sa':    '撒', 'sai':   '赛', 'san':   '三', 'sang':  '桑', 'sao':   '扫',
  'se':    '色', 'sen':   '森', 'sha':   '沙', 'shan':  '山', 'shang': '上',
  'shao':  '少', 'she':   '社', 'shei':  '谁', 'shen':  '什', 'sheng': '生',
  'shi':   '是', 'shou':  '手', 'shu':   '书', 'shua':  '刷', 'shuang':'双',
  'shui':  '水', 'shun':  '顺', 'shuo':  '说', 'si':    '四', 'song':  '送',
  'sou':   '搜', 'su':    '速', 'suan':  '算', 'sui':   '岁', 'sun':   '孙', 'suo':'所',
  'ta':    '他', 'tai':   '太', 'tan':   '谈', 'tang':  '汤', 'tao':   '套',
  'te':    '特', 'ti':    '题', 'tian':  '天', 'tiao':  '条', 'tie':   '贴',
  'ting':  '听', 'tong':  '同', 'tou':   '头', 'tu':    '图', 'tuan':  '团',
  'tui':   '腿', 'tun':   '吞', 'tuo':   '拖',
  'wa':    '哇', 'wai':   '外', 'wan':   '晚', 'wang':  '往', 'wei':   '为',
  'wen':   '问', 'weng':  '翁', 'wo':    '我', 'wu':    '五',
  'xi':    '西', 'xia':   '下', 'xian':  '先', 'xiang': '想', 'xiao':  '小',
  'xie':   '些', 'xin':   '心', 'xing':  '行', 'xiong': '熊', 'xiu':   '休',
  'xu':    '需', 'xuan':  '选', 'xue':   '学', 'xun':   '训',
  'ya':    '呀', 'yan':   '眼', 'yang':  '样', 'yao':   '要', 'ye':    '也',
  'yi':    '一', 'yin':   '因', 'ying':  '应', 'yong':  '用', 'you':   '有',
  'yu':    '语', 'yuan':  '元', 'yue':   '月', 'yun':   '运',
  'za':    '咋', 'zai':   '在', 'zan':   '咱', 'zang':  '脏', 'zao':   '早',
  'ze':    '则', 'zen':   '怎', 'zha':   '炸', 'zhai':  '宅', 'zhan':  '站',
  'zhang': '张', 'zhao':  '找', 'zhe':   '这', 'zhen':  '真', 'zheng': '正',
  'zhi':   '知', 'zhong': '中', 'zhou':  '周', 'zhu':   '住', 'zhuan': '转',
  'zhuang':'壮', 'zhui':  '追', 'zhun':  '准', 'zhuo':  '桌', 'zi':    '字',
  'zong':  '总', 'zou':   '走', 'zu':    '足', 'zui':   '最', 'zuo':   '做',
};

/* ── English word list ─────────────────────────────────────────
   Common English words that could otherwise pass the Mandarin
   syllable-coverage test (e.g. "rice" → ri+ce = 100 % coverage).
   Any input token matching this set is treated as English.
   ──────────────────────────────────────────────────────────── */
const EN_WORDS = new Set([
  // Pronouns / articles / prepositions / conjunctions
  'i','a','an','the','and','or','but','not','so','if','as','by','of',
  'in','on','at','to','up','is','it','be','do','go','we','he','she',
  'me','my','us','no','for','out','was','are','has','had','with',
  'from','can','will','have','this','that','they','them','their',
  // Common verbs
  'eat','drink','like','love','know','see','say','ask','use','try',
  'run','walk','talk','work','live','play','cook','read','write',
  'sing','dance','help','tell','give','take','make','come','get',
  'find','look','feel','want','need','wake','sleep','buy','sell',
  'think','speak','learn','teach','study','listen','watch','open',
  // Common nouns / adjectives likely typed as practice targets
  'rice','fish','meat','milk','tea','food','water','bread','cake',
  'cat','dog','bird','tree','book','home','city','road','time','day',
  'night','week','year','name','word','hand','head','face','life',
  'good','bad','big','small','hot','cold','new','old','fast','slow',
  'hard','easy','long','short','happy','sad','nice','right','wrong',
  // Greetings / common phrases
  'hello','bye','yes','please','sorry','thanks','thank','excuse',
  'today','tomorrow','yesterday','morning','evening',
  // qu- words ('qu' is a valid pinyin syllable, so these need listing)
  'question','quite','quiet','quality','queen','quit','quiz','quarter',
]);

/* ── Detect pinyin ─────────────────────────────────────────────
   Returns true when the string looks like romanised Mandarin.
   First rejects known English words, then measures syllable
   coverage — genuine pinyin scores ≥ 55 %.
   ──────────────────────────────────────────────────────────── */
function looksLikePinyin(str) {
  if (!str.trim()) return false;
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(str)) return false;

  // Tone-marked vowels are a definitive pinyin signal.
  // Use NFD: any combining diacritical mark means tones are present.
  const hasToneMarks = /[\u0300-\u036f]/.test(str.normalize('NFD'));

  const norm = normalizePinyin(str).replace(/[.,!?;:，。！？；：…""''「」\-]/g, '').trim();
  if (!/^[a-z1-5\s''·]+$/.test(norm)) return false;

  // Reject immediately if any space-separated token is a known English word
  const tokens = norm.split(/\s+/);
  // If tone marks are present, skip the English-word and consonant-cluster
  // rejection — tone marks are unambiguous pinyin.
  if (!hasToneMarks) {
    if (tokens.some(t => EN_WORDS.has(t))) return false;
    // NOTE: no 'qu' here — it is a valid pinyin syllable (去 qù)
    if (/th|wh|gh|ph|ck/.test(norm)) return false;
    if (/([bcdfghjklmnpqrstvwxyz])\1/.test(norm)) return false;
  }

  // If tone marks present and syllables look reasonable, accept immediately
  if (hasToneMarks) return true;

  // Syllable coverage check
  let total = 0, matched = 0;
  for (const token of tokens) {
    total += token.length;
    let i = 0;
    while (i < token.length) {
      let hit = false;
      for (let len = Math.min(6, token.length - i); len >= 1; len--) {
        if (PY[token.slice(i, i + len)]) {
          matched += len; i += len; hit = true; break;
        }
      }
      if (!hit) i++;
    }
  }
  return total > 0 && matched / total >= 0.55;
}

/* ── Detect English ───────────────────────────────────────────
   True when the string contains Latin words that are NOT pinyin.
   ──────────────────────────────────────────────────────────── */
function looksLikeEnglish(str) {
  if (!str.trim()) return false;
  if (/[\u4e00-\u9fff]/.test(str)) return false;
  if (looksLikePinyin(str)) return false;

  const lower  = str.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);

  // Any known English word → English
  if (tokens.some(t => EN_WORDS.has(t))) return true;
  // English-only consonant patterns
  if (/th|wh|gh|ph|ck|qu/.test(lower)) return true;
  if (/([bcdfghjklmnpqrstvwxyz])\1/.test(lower)) return true; // double consonant
  // Longer words that aren't valid pinyin sequences
  if (tokens.some(t => t.length >= 5 && !looksLikePinyin(t))) return true;

  return /[a-zA-Z]{2,}/.test(str);
}

/* ── Detect Portuguese ────────────────────────────────────────
   True when the string is likely Brazilian Portuguese.
   Must be checked BEFORE pinyin — many PT words (ola, boa, dia)
   are valid pinyin syllable sequences and would be misclassified.
   ──────────────────────────────────────────────────────────── */
const PT_WORDS = new Set([
  // Greetings / common phrases
  'ola','olá','oi','bom','boa','noite','tarde','manha','manhã',
  'tchau','obrigado','obrigada',
  // Pronouns / connectives (long enough to be unambiguous)
  'voce','você','nao','não','sim','isso','este','esta','essa',
  'nosso','nossa','meu','minha','seu','sua',
  // Verbs
  'fazer','estar','falar','quero','posso','tenho','preciso',
  'gosto','acho','saber','poder','vamos','estou','estamos',
  // Common words
  'muito','pouco','aqui','agora','hoje','amanha','amanhã',
  'porque','entao','então','quando','onde','como','para',
  'obrigado','obrigada','desculpa','desculpe',
  // Animals / everyday nouns
  'cachorro','gato','casa','carro','comida','agua','água',
  'livro','escola','trabalho','amigo','amiga','pessoa',
  'homem','mulher','criança','menino','menina','filho','filha',
]);

function looksLikePortuguese(str) {
  if (!str.trim()) return false;
  if (/[\u4e00-\u9fff]/.test(str)) return false;
  // Portuguese-specific accent characters are a definitive signal
  if (/[ãõçêâúíóàáéèÃÕÇÊÂÚÍÓÀÁÉÈ]/.test(str)) return true;
  // Check known PT words — do NOT call looksLikePinyin here;
  // many PT words (ola=o+la, boa=bo+a) score high on pinyin coverage
  const tokens = str.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.some(t => PT_WORDS.has(t));
}

/* ── Unified language detector for the input field ───────────
   Returns: 'pinyin' | 'pt-BR' | 'en' | null
   Portuguese is checked FIRST — it must win over pinyin for
   words like "ola", "boa", "dia" that are valid in both.
   ──────────────────────────────────────────────────────────── */
function detectInputLang(str) {
  if (!str.trim()) return null;
  if (/[\u4e00-\u9fff]/.test(str)) return null;
  // Pinyin-specific tone marks (macron U+0304, caron U+030C) are unambiguous.
  // Check pinyin first when they're present so Portuguese doesn't grab shared accents.
  const hasPinyinTones = /[\u0304\u030C]/.test(str.normalize('NFD'));
  if (hasPinyinTones && looksLikePinyin(str)) return 'pinyin';
  if (looksLikePortuguese(str)) return 'pt-BR';
  if (looksLikePinyin(str))     return 'pinyin';
  if (looksLikeEnglish(str))    return 'en';
  return null;
}

/* ── Convert a single compact token (no spaces) ───────────────
   Greedy longest-match so "nihao" → ni + hao → 你好.
   ──────────────────────────────────────────────────────────── */
function convertToken(token) {
  if (!token) return '';
  if (PY[token]) return PY[token];

  let result = '';
  let i = 0;
  while (i < token.length) {
    let found = false;
    for (let len = Math.min(6, token.length - i); len >= 1; len--) {
      const sub = token.slice(i, i + len);
      if (PY[sub]) { result += PY[sub]; i += len; found = true; break; }
    }
    if (!found) { result += token[i]; i++; }
  }
  return result;
}

/* ── Punctuation map: Western → Chinese equivalents ────────── */
const PUNCT_MAP = {
  '.':'。', ',':'，', '!':'！', '?':'？', ';':'；', ':':'：', '…':'…',
};

/* ── Convert a full pinyin string → Chinese ────────────────── */
function convertPinyin(raw) {
  const norm = normalizePinyin(raw).trim();
  if (!norm) return raw;
  if (PY[norm]) return PY[norm];

  // Straight double quotes alternate between opening 「 and closing 」
  let quoteOpen = true;
  const mapPunct = c => {
    if (c === '"') {
      const q = quoteOpen ? '「' : '」';
      quoteOpen = !quoteOpen;
      return q;
    }
    return PUNCT_MAP[c] || c;
  };

  return norm.split(/\s+/).map(token => {
    // Separate trailing punctuation from the syllable
    const m = token.match(/^([a-z1-5'·]+)([.,!?;:…"]+)?$/);
    if (!m) return token;                       // not pinyin, pass through
    const hanzi = convertToken(m[1]);
    const punct = m[2] ? m[2].split('').map(mapPunct).join('') : '';
    return hanzi + punct;
  }).join('');
}


/* ============================================================
   Input field smart detection + conversion / translation
   ============================================================
   Both pinyin AND English now behave the same way:
     • Typing  → show a button (convert / translate)
     • Pasting → act immediately (no button click needed)
   This avoids mid-word API calls and false detections.
   ============================================================ */

/* ── Shared translate-and-replace helper ───────────────────────
   Fires the MyMemory API for `val`.  Writes the result back only
   if the field hasn't been edited while the request was in-flight.
   On failure it re-surfaces the button as a manual retry.
   ──────────────────────────────────────────────────────────── */
async function autoTranslateInput(val, fromLang = 'en') {
  let result = await translateText(val.trim(), fromLang, 'zh-CN');

  // Fallback: if English translation failed or came back unchanged, retry
  // as Portuguese (handles PT words missing from our word list that were
  // misdetected as English)
  if ((!result || result === val.trim()) && fromLang === 'en') {
    const ptResult = await translateText(val.trim(), 'pt-BR', 'zh-CN');
    if (ptResult && ptResult !== val.trim()) result = ptResult;
  }

  if (targetInput.value !== val) return;   // user edited while we waited

  if (result && result !== val.trim()) {
    targetInput.value = result;
    translateInputBtn.hidden   = true;
    translateInputBtn.disabled = false;
    convertBtn.hidden          = true;
    // Show the pronounce / translation buttons now that the field has Chinese
    pronounceTargetBtn.hidden  = false;
    translateTargetBtn.hidden  = false;
  } else {
    translateInputBtn.textContent = '→ Translate to Chinese';
    translateInputBtn.disabled    = false;
    translateInputBtn.hidden      = false;
  }
}

/* ── Language override state ───────────────────────────────── */
let langOverride = null;   // null = use auto-detection

/* ── Update buttons and chips for the active language ──────── */
function applyLang(lang) {
  const val       = targetInput.value;
  const isPy      = lang === 'pinyin';
  const isChinese = /[\u4e00-\u9fff]/.test(val);

  convertBtn.hidden         = !isPy;
  translateInputBtn.hidden  = !lang || isPy;
  translateInputBtn.textContent = '→ Translate to Chinese';
  translateInputBtn.disabled    = false;
  pronounceTargetBtn.hidden = !isChinese || !val.trim();
  translateTargetBtn.hidden = pronounceTargetBtn.hidden;

  // Update chip row visibility and active state
  const showChips = !!(lang || (isChinese && val.trim()));
  detectedLangRow.hidden = !showChips;
  langChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.lang === lang);
  });
}

/* ── Resolve current language (override or auto-detect) ────── */
function currentLang() {
  return langOverride || detectInputLang(targetInput.value);
}

/* ── Input event: auto-detect, reset override ─────────────── */
targetInput.addEventListener('input', () => {
  langOverride = null;       // new typing resets manual override
  applyLang(detectInputLang(targetInput.value));
});

/* ── Chip click: manual language override ─────────────────── */
langChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const chosen = chip.dataset.lang;
    langOverride = chosen;
    applyLang(chosen);
  });
});

/* ── Paste event ───────────────────────────────────────────────
   No auto-conversion — just let the text be pasted normally.
   The input event handler will detect the language and show
   the appropriate button for manual conversion / translation.
   ──────────────────────────────────────────────────────────── */

/* ── Convert button: manual pinyin → characters ────────────── */
convertBtn.addEventListener('click', () => {
  targetInput.value = convertPinyin(targetInput.value);
  convertBtn.hidden         = true;
  pronounceTargetBtn.hidden = false;
  translateTargetBtn.hidden = false;
  targetInput.focus();
});

/* ── Translate button: manual trigger / retry ──────────────── */
translateInputBtn.addEventListener('click', async () => {
  const val = targetInput.value.trim();
  if (!val) return;
  translateInputBtn.disabled    = true;
  translateInputBtn.textContent = 'Translating…';
  const lang     = currentLang();
  const fromLang = lang === 'pt-BR' ? 'pt-BR' : 'en';
  await autoTranslateInput(val, fromLang);
  // State (re-enable / hide) is handled entirely inside autoTranslateInput
});


/* ============================================================
   Mode Tabs  —  Practice  ⇄  Flashcards
   ============================================================ */
const tabButtons = document.querySelectorAll('.tab');
const VIEWS = {
  practice:   document.getElementById('view-practice'),
  flashcards: document.getElementById('view-flashcards'),
  listening:  document.getElementById('view-listening'),
};

function switchView(view) {
  // Stop any active recording / audio before leaving the current view
  if (isRecording) cancelRecording();
  stopCurrentAudio();

  tabButtons.forEach(btn => {
    const on = btn.dataset.view === view;
    btn.classList.toggle('tab--active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  Object.entries(VIEWS).forEach(([key, el]) => { el.hidden = key !== view; });
  // Lets the stylesheet trim the shared header/footer on short screens for
  // the flashcard view only — the other views keep their normal spacing.
  document.body.classList.toggle('is-flashcards', view === 'flashcards');
  document.body.classList.toggle('is-listening',  view === 'listening');

  if (view === 'flashcards' && !fcInitialized) fcInit();
  if (view === 'listening') {
    if (!lsInitialized) lsInit();
    else lsScheduleFit();   // the window may have been resized while away
  }
  fcScheduleFit();   // sizes the card on entry, releases the lock on exit
}

tabButtons.forEach(btn =>
  btn.addEventListener('click', () => switchView(btn.dataset.view))
);


/* ============================================================
   Flashcards  —  see a character, pronounce it
   ============================================================
   Decks come from vocab.js (FLASHCARD_DECKS): revisão prova 1
   and prova 2.  Speech recognition is reused via startRecording
   with a flashcard-specific result handler.
   ============================================================ */
const fcDeckTabs    = document.querySelectorAll('.fc-deck-tab');
const fcCounter     = document.getElementById('fcCounter');
const fcShuffleBtn  = document.getElementById('fcShuffleBtn');
const fcFrontBtn    = document.getElementById('fcFrontBtn');
const fcCard        = document.getElementById('fcCard');
const fcPrompt      = document.getElementById('fcPrompt');
const fcListenBtn   = document.getElementById('fcListenBtn');
const fcAnswer      = document.getElementById('fcAnswer');
const fcAnsHanzi    = document.getElementById('fcAnsHanzi');
const fcPinyin      = document.getElementById('fcPinyin');
const fcMeaningPt   = document.getElementById('fcMeaningPt');
const fcMeaningEn   = document.getElementById('fcMeaningEn');
const fcRevealBtn   = document.getElementById('fcRevealBtn');
const fcRecordBtn   = document.getElementById('fcRecordBtn');
const fcRecordLabel = document.getElementById('fcRecordLabel');
const fcStatus      = document.getElementById('fcStatus');
const fcResult      = document.getElementById('fcResult');
const fcVerdict     = document.getElementById('fcVerdict');
const fcYouSaid     = document.getElementById('fcYouSaid');
const fcPrevBtn     = document.getElementById('fcPrevBtn');
const fcNextBtn     = document.getElementById('fcNextBtn');
const fcDoneChk     = document.getElementById('fcDoneChk');
const fcClearBtn    = document.getElementById('fcClearBtn');

const flashcardRec = {
  btn:      fcRecordBtn,
  label:    fcRecordLabel,
  statusEl: fcStatus,
  onResult: handleFlashcardResult,
};

let fcInitialized = false;
let fcDeckKey     = 'prova1';
let fcOrder       = [];   // indices into the active deck (optionally shuffled)
let fcPos         = 0;
let fcShuffled    = false;

/* Which field is the prompt — three ways to drill the same deck:
   see the characters and say them, read the pinyin, or work back from
   the meaning.  Whatever is on the front is left out of the answer. */
const FC_FRONTS = [
  { key: 'hanzi',   label: '汉字', name: 'characters' },
  { key: 'pinyin',  label: '拼音', name: 'pinyin' },
  { key: 'meaning', label: '意思', name: 'meaning' },
];
let fcFront = 'hanzi';   // characters by default

/* Portuguese and English on one line, for the meaning front */
const fcMeaningText = card => (card.en ? `${card.pt} · ${card.en}` : card.pt);

/* The prompt for a card in a given mode */
function fcFrontText(card, front = fcFront) {
  if (front === 'pinyin')  return card.pinyin;
  if (front === 'meaning') return fcMeaningText(card);
  return card.hanzi;
}

function fcApplyFront(front) {
  FC_FRONTS.forEach(m =>
    fcCard.classList.toggle(`fc-front--${m.key}`, m.key === front));
  // The prompt's language changes with it, so screen readers and the font
  // stack follow the content rather than the markup.
  fcPrompt.lang = front === 'hanzi' ? 'zh-CN'
                : front === 'pinyin' ? 'zh-Latn'
                : 'pt-BR';
}

/* Cards ticked as "done" drop out of the rotation.  One storage key per
   deck, so exam 1 and exam 2 progress never mix, and cards are keyed by
   their characters rather than their position, so the marks survive
   vocab.js being regenerated. */
const FC_DONE_KEY = 'mpp.fc.done.';
let fcDone = new Set();          // hanzi of the done cards in the ACTIVE deck

const fcDeck = () => FLASHCARD_DECKS[fcDeckKey];
const fcCurrentCard = () => fcDeck()[fcOrder[fcPos]];
const fcIsDone = card => fcDone.has(card.hanzi);

function fcLoadDone() {
  try {
    const saved = JSON.parse(localStorage.getItem(FC_DONE_KEY + fcDeckKey));
    fcDone = new Set(Array.isArray(saved) ? saved : []);
  } catch { fcDone = new Set(); }   // corrupt entry — start this deck clean
}

function fcSaveDone() {
  // Private browsing / full quota: the marks just don't survive the session.
  try { localStorage.setItem(FC_DONE_KEY + fcDeckKey, JSON.stringify([...fcDone])); }
  catch { /* ignore */ }
}

/* Build the play order — sequential, or Fisher–Yates shuffled.
   Done cards are left out entirely, so shuffle only ever draws from
   what is still to study. */
function fcBuildOrder() {
  const deck = fcDeck();
  fcOrder = deck.map((_, i) => i).filter(i => !fcIsDone(deck[i]));
  if (fcShuffled) {
    for (let i = fcOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fcOrder[i], fcOrder[j]] = [fcOrder[j], fcOrder[i]];
    }
  }
  fcPos = 0;
}

function fcInit() {
  fcInitialized = true;
  fcLoadDeck('prova1');
}

function fcLoadDeck(key) {
  fcDeckKey = key;
  fcDeckTabs.forEach(tab => {
    const on = tab.dataset.deck === key;
    tab.classList.toggle('fc-deck-tab--active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  fcLoadDone();
  fcBuildOrder();
  fcRender();
  // No re-fit: the screen is sized from every deck at once, so switching
  // decks changes the content and nothing else.
}

function fcRender() {
  if (isRecording) cancelRecording();
  stopCurrentAudio();

  const card  = fcCurrentCard();
  const empty = !card;   // every card in this deck is marked done

  // Every field is filled in; the stylesheet leaves out whichever one is
  // currently the prompt.
  fcPrompt.textContent    = empty ? '🎉' : fcFrontText(card);
  fcAnsHanzi.textContent  = empty ? '' : card.hanzi;
  fcPinyin.textContent    = empty ? '' : card.pinyin;
  // The answer gives the meaning in both languages: Portuguese and English.
  fcMeaningPt.textContent = empty ? '' : card.pt;
  fcMeaningEn.textContent = empty ? '' : card.en || '';

  fcDoneChk.checked = !empty && fcIsDone(card);
  [fcDoneChk, fcListenBtn, fcRevealBtn, fcRecordBtn, fcPrevBtn, fcNextBtn]
    .forEach(el => { el.disabled = empty; });

  // The answer and verdict slots keep their reserved height either way —
  // only their visibility changes, so the card never moves.
  fcAnswer.classList.remove('fc-answer--shown');
  fcResult.classList.remove('fc-result--shown');
  fcVerdict.textContent = '';
  fcYouSaid.textContent = '';
  showStatus(empty ? 'Deck finished — tap ↺ Clear to study it again.' : '', fcStatus);
  fcUpdateCounter();
}

/* Counter + Clear button; kept apart from fcRender so ticking "done"
   can refresh them without rebuilding the card. */
function fcUpdateCounter() {
  const left = fcCurrentCard() ? `${fcPos + 1} / ${fcOrder.length}` : 'All done';
  fcCounter.textContent = fcDone.size ? `${left} · ${fcDone.size} done` : left;
  fcClearBtn.hidden = fcDone.size === 0;
}

/* ── Fit the flashcard screen to the viewport ──────────────────
   Two goals, in this order:
     1. The screen never grows past the fold — no scrolling.
     2. It is the *same* screen on every card of the deck: one character
        size throughout, and a fixed height for everything above Prev/Next.
   Both come from measuring the deck's biggest card once (per deck, per
   viewport) instead of re-sizing on every card, which is what used to make
   the layout twitch as you flipped through. */
const FC_HANZI_MAX     = 104;  // px — matches the clamp() ceiling in the CSS
const FC_HANZI_COMFORT = 52;   // px — floor while the rest is still full size
const FC_HANZI_MIN     = 32;   // px — smaller than this stops being readable
const FC_ZOOM_MIN      = 0.4;  // deepest the whole screen may be scaled down

/* The pinyin and meaning fronts get whatever size fits the box the
   characters left behind — Latin text at 100px would look absurd anyway,
   hence the lower ceilings. */
const FC_PINYIN_MAX  = 56, FC_PINYIN_MIN  = 18;
const FC_MEANING_MAX = 30, FC_MEANING_MIN = 13;
let fcFitQueued = false;

const fcRoot = document.documentElement;

const fcOverflows = () =>
  fcRoot.scrollHeight > fcRoot.clientHeight + 1;   // 1px slack for rounding

/* Size of the prompt text as drawn, whatever the alignment — scrollWidth
   can't see the overflow of centred text, a Range can.  Measured in the
   same (zoomed) space as the box it's compared against. */
function fcPromptTextRect() {
  const range = document.createRange();
  range.selectNodeContents(fcPrompt);
  return range.getBoundingClientRect();
}

/* The most demanding cards in *every* deck: the widest characters, and the
   handful with the wordiest answers.  Measuring across all decks rather
   than the active one is what keeps Exam 1 and Exam 2 exactly the same
   shape — sized per deck, Exam 2's longer words and wordier glosses gave
   it a slightly different card.  (Measuring all ~192 cards on every resize
   would just be waste — the tallest answer is always among the longest.) */
let fcWorstCaseCache = null;

function fcWorstCase() {
  if (!fcWorstCaseCache) {
    const all = Object.values(FLASHCARD_DECKS).flat();
    const len = c => (c.pinyin || '').length + (c.pt || '').length + (c.en || '').length;
    const longest = (best, s) => ((s || '').length > best.length ? s : best);

    fcWorstCaseCache = {
      hanzi:    all.reduce((best, c) => longest(best, c.hanzi), ''),
      pinyin:   all.reduce((best, c) => longest(best, c.pinyin), ''),
      meaning:  all.reduce((best, c) => longest(best, fcMeaningText(c)), ''),
      wordiest: [...all].sort((a, b) => len(b) - len(a)).slice(0, 3),
    };
  }
  return fcWorstCaseCache;
}

/* Sample verdict long enough to fill the two lines the slot allows —
   -webkit-line-clamp caps it there, so the measured height is exact. */
const FC_SAID_SAMPLE = 'You said: ' + '你好世界 · nǐ hǎo shì jiè '.repeat(6);

/* Largest size in [min, max] at which the prompt text — wrapped as needed —
   still fits inside the fixed prompt box.  Used for the pinyin and meaning
   fronts, which have to live in the box the characters defined. */
function fcFitPromptText(cssVar, max, min) {
  const box   = fcPrompt.getBoundingClientRect();
  const fits  = px => {
    fcRoot.style.setProperty(cssVar, Math.round(px) + 'px');
    const text = fcPromptTextRect();
    return text.height <= box.height + 1 && text.width <= box.width + 1;
  };

  let best = min;
  if (fits(max)) {
    best = max;
  } else {
    let lo = min, hi = max;
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) { best = mid; lo = mid; } else hi = mid;
    }
  }
  fcRoot.style.setProperty(cssVar, Math.round(best) + 'px');
}

/* Largest value in [lo, hi] that doesn't overflow, found by bisection.
   `apply` writes the candidate to the DOM; ~7 reflows per search. */
function fcLargestFitting(lo, hi, step, apply) {
  let best = lo;
  apply(lo);
  if (fcOverflows()) return lo;      // nothing in range fits
  while (hi - lo > step) {
    const mid = (lo + hi) / 2;
    apply(mid);
    if (fcOverflows()) hi = mid;
    else { best = mid; lo = mid; }
  }
  apply(best);
  return best;
}

function fcFit() {
  if (VIEWS.flashcards.hidden) {
    document.body.classList.remove('fc-fit');
    fcRoot.style.removeProperty('--fc-zoom');
    return;
  }

  // Swap the deck's most demanding content in for the measurements — all
  // within this one frame, so nothing is ever painted.
  const worst = fcWorstCase();
  const shown = {
    prompt:  fcPrompt.textContent,    ansHanzi: fcAnsHanzi.textContent,
    pinyin:  fcPinyin.textContent,    pt:       fcMeaningPt.textContent,
    en:      fcMeaningEn.textContent, verdict:  fcVerdict.textContent,
    youSaid: fcYouSaid.textContent,
  };
  fcVerdict.textContent = '✗ 再试一次 · 100%';
  fcYouSaid.textContent = FC_SAID_SAMPLE;

  document.body.classList.remove('fc-fit');       // measure without the lock
  document.body.classList.add('fc-measuring');    // slots take their natural height
  fcRoot.style.removeProperty('--fc-prompt-h');   // …and so does the prompt

  const setHanzi = px => fcRoot.style.setProperty('--fc-hanzi', Math.round(px) + 'px');
  const setZoom  = z  => fcRoot.style.setProperty('--fc-zoom', z.toFixed(3));

  // ── Reserve the fixed slots first, so the fit below sizes the character
  //    against the screen every card will actually get.  The answer holds
  //    two of the three fields, so it is reserved for the worst mode too.
  setZoom(1);
  let answerH = 0;
  for (const card of worst.wordiest) {
    fcAnsHanzi.textContent  = card.hanzi;
    fcPinyin.textContent    = card.pinyin;
    fcMeaningPt.textContent = card.pt;
    fcMeaningEn.textContent = card.en || '';
    for (const front of FC_FRONTS) {
      fcApplyFront(front.key);
      answerH = Math.max(answerH, fcAnswer.offsetHeight);
    }
  }
  fcRoot.style.setProperty('--fc-answer-h',  answerH + 'px');
  fcRoot.style.setProperty('--fc-result-h', fcResult.offsetHeight + 'px');
  document.body.classList.remove('fc-measuring');

  // The whole-screen fit is done on the characters — the tallest front, and
  // the one whose size the other two then have to fit inside.
  fcApplyFront('hanzi');
  fcPrompt.textContent = worst.hanzi;

  /* Largest size that keeps the longest card on a single line. Box and text
     are measured under the same zoom, so their ratio is zoom-independent. */
  const widthCap = () => {
    setHanzi(FC_HANZI_MAX);
    const avail = fcPrompt.getBoundingClientRect().width;
    const text  = fcPromptTextRect().width;
    return text > avail
      ? Math.max(FC_HANZI_MIN, Math.floor(FC_HANZI_MAX * avail / text))
      : FC_HANZI_MAX;
  };

  let cap = widthCap();
  setHanzi(cap);

  if (fcOverflows()) {
    // 1. Shrinking the character is the cheapest fix — it leaves the rest of
    //    the screen at full size. Worth doing only if it solves the fit on
    //    its own, so it stops at a size that's still comfortable to read.
    fcLargestFitting(Math.min(FC_HANZI_COMFORT, cap), cap, 1, setHanzi);

    if (fcOverflows()) {
      // 2. Then it's the surrounding chrome, not the character, that doesn't
      //    fit — roughly 850px of it. Scale the whole screen down instead:
      //    holding the character large and zooming out leaves it far bigger
      //    than squeezing it alone ever could (81px vs 29px at 1280x800).
      setHanzi(cap);
      fcLargestFitting(FC_ZOOM_MIN, 1, 0.005, setZoom);

      // Zooming out widens the card in CSS pixels, so the one-line budget
      // has to be recomputed before any further shrinking.
      cap = widthCap();
      setHanzi(cap);

      // 3. Last resort before giving up: shrink the character at full zoom-out.
      if (fcOverflows()) fcLargestFitting(Math.min(FC_HANZI_MIN, cap), cap, 1, setHanzi);
    }
  }

  // Lock the box the characters ended up needing, then size the other two
  // fronts to live inside exactly that — same card, whichever is showing.
  fcRoot.style.setProperty('--fc-prompt-h', fcPrompt.offsetHeight + 'px');

  fcApplyFront('pinyin');
  fcPrompt.textContent = worst.pinyin;
  fcFitPromptText('--fc-pinyin-front', FC_PINYIN_MAX, FC_PINYIN_MIN);

  fcApplyFront('meaning');
  fcPrompt.textContent = worst.meaning;
  fcFitPromptText('--fc-meaning-front', FC_MEANING_MAX, FC_MEANING_MIN);

  fcApplyFront(fcFront);
  fcPrompt.textContent    = shown.prompt;
  fcAnsHanzi.textContent  = shown.ansHanzi;
  fcPinyin.textContent    = shown.pinyin;
  fcMeaningPt.textContent = shown.pt;
  fcMeaningEn.textContent = shown.en;
  fcVerdict.textContent   = shown.verdict;
  fcYouSaid.textContent   = shown.youSaid;

  // If it still doesn't fit (an extremely short window), leave the page
  // scrollable rather than clipping content away.
  document.body.classList.toggle('fc-fit', !fcOverflows());
}

/* Coalesce the bursts of calls (render + reveal + resize) into one pass */
function fcScheduleFit() {
  if (fcFitQueued) return;
  fcFitQueued = true;
  requestAnimationFrame(() => { fcFitQueued = false; fcFit(); });
}

/* The slot is already there — revealing is purely a visibility change,
   so no re-fit and no reflow of the rest of the screen. */
function fcReveal() { fcAnswer.classList.add('fc-answer--shown'); }

/* Move `delta` cards, dropping anything ticked done on the way out.  A card
   stays on screen while it's ticked, so an accidental tap can be undone
   before you navigate away. */
function fcStep(delta) {
  if (!fcOrder.length) return;
  const deck  = fcDeck();
  const next  = (fcPos + delta + fcOrder.length) % fcOrder.length;
  const wanted = fcOrder[next];

  fcOrder = fcOrder.filter(i => !fcIsDone(deck[i]));
  if (fcOrder.length) {
    const at = fcOrder.indexOf(wanted);
    fcPos = at >= 0 ? at : next % fcOrder.length;
  } else {
    fcPos = 0;
  }
  fcRender();
}

/* Compare what the user said to the current card's characters.
   We receive every guess the recognizer offered and keep the one that
   best matches the card — so a correct pronunciation isn't rejected just
   because the top guess was a homophone. */
function handleFlashcardResult(transcript, alternatives = [transcript]) {
  showStatus('', fcStatus);

  const cands = (alternatives.length ? alternatives : [transcript]).filter(Boolean);
  if (!cands.length) {
    showStatus('No speech detected. Please try again.', fcStatus);
    return;
  }

  const card = fcCurrentCard();
  if (!card) return;   // deck finished — nothing to score against

  // This is a *pronunciation* drill, so judge by pinyin, not by the written
  // character. Homophones like 他/她 (both "tā") must count as correct.
  // Tone marks are kept, so a wrong tone is still wrong.
  const targetKey = pinyinKey(card.hanzi);

  let transcript_ = cands[0];
  let score = -1;
  let matched = false;
  for (const c of cands) {
    if (targetKey && pinyinKey(c) === targetKey) { transcript_ = c; matched = true; break; }
    const s = compareChars(card.hanzi, c).score;   // fallback when pinyin lib is offline
    if (s > score) { score = s; transcript_ = c; }
  }
  transcript = transcript_;
  if (matched) score = 100;
  const ok = matched || score >= 100;

  fcResult.classList.add('fc-result--shown');
  fcVerdict.textContent = ok ? '✓ 对了 · Correct!' : `✗ 再试一次 · ${score}%`;
  fcVerdict.classList.toggle('fc-verdict--good', ok);
  fcVerdict.classList.toggle('fc-verdict--bad', !ok);

  const lib  = getPinyinLib();
  const said = lib
    ? `${transcript} · ${lib.pinyin(transcript, { separator: ' ' })}`
    : transcript;
  fcYouSaid.textContent = 'You said: ' + said;

  fcReveal();   // reveal pinyin + meaning after an attempt
}

/* ── Wire up flashcard controls ────────────────────────────── */
fcDeckTabs.forEach(tab =>
  tab.addEventListener('click', () => fcLoadDeck(tab.dataset.deck))
);

/* Cycle the front: characters → pinyin → meaning → characters.  Sizes for
   all three were worked out by the last fit, so this only swaps content —
   the card itself stays exactly as big as it was. */
fcFrontBtn.addEventListener('click', () => {
  const at   = FC_FRONTS.findIndex(m => m.key === fcFront);
  const next = FC_FRONTS[(at + 1) % FC_FRONTS.length];

  fcFront = next.key;
  fcFrontBtn.textContent = next.label;
  const hint = `Front of card: ${next.name} — tap to change`;
  fcFrontBtn.setAttribute('aria-label', hint);
  fcFrontBtn.title = hint;

  fcApplyFront(fcFront);
  fcRender();   // re-prompts the current card, hiding any revealed answer
});

fcShuffleBtn.addEventListener('click', () => {
  fcShuffled = !fcShuffled;
  fcShuffleBtn.setAttribute('aria-pressed', String(fcShuffled));
  fcShuffleBtn.classList.toggle('fc-shuffle--on', fcShuffled);
  fcBuildOrder();
  fcRender();
});

/* Ticking "done" retires the card; it disappears on the next navigation. */
fcDoneChk.addEventListener('change', () => {
  const card = fcCurrentCard();
  if (!card) return;
  if (fcDoneChk.checked) fcDone.add(card.hanzi);
  else                   fcDone.delete(card.hanzi);
  fcSaveDone();
  fcUpdateCounter();
});

/* Clear only this deck's marks — the other exam is untouched. */
fcClearBtn.addEventListener('click', () => {
  if (!fcDone.size) return;
  if (!confirm(`Clear ${fcDone.size} card(s) marked done in this deck?`)) return;
  fcDone.clear();
  fcSaveDone();
  fcBuildOrder();
  fcRender();
});

fcRevealBtn.addEventListener('click', fcReveal);
fcListenBtn.addEventListener('click', () => {
  const card = fcCurrentCard();
  if (card) speak(card.hanzi, fcListenBtn);
});
fcNextBtn.addEventListener('click', () => fcStep(1));
fcPrevBtn.addEventListener('click', () => fcStep(-1));

wireRecordButton(flashcardRec);

/* Re-fit on anything that changes the available height: window resize,
   rotation, and the late layout shift when the web fonts finish loading. */
['resize', 'orientationchange', 'load'].forEach(evt =>
  window.addEventListener(evt, fcScheduleFit)
);


/* ============================================================
   Listening  —  hear a phrase, rebuild it
   ============================================================
   The phrase itself comes from phrases.js, which assembles it from
   the chosen deck's own vocabulary using written-out grammar
   templates.  Nothing here is pre-scripted and nothing is generated
   by a model, so the drill works with the vocabulary the student
   actually has — and its Portuguese and English are exact rather
   than fetched.

   Grading is by reconstruction: the phrase's words are offered as
   tiles, shuffled and salted with a few decoys, and the student taps
   them in the order they heard.  That is checkable to the character
   without a microphone, and it makes the student parse the sentence
   rather than recognise its shape.
   ============================================================ */
const lsScopeBtns = document.querySelectorAll('.ls-scope__btn');
const lsCard      = document.getElementById('lsCard');
const lsStage     = document.getElementById('lsStage');
const lsScoreEl   = document.getElementById('lsScore');
const lsSlowBtn   = document.getElementById('lsSlowBtn');
const lsSkipBtn   = document.getElementById('lsSkipBtn');
const lsPlayBtn   = document.getElementById('lsPlayBtn');
const lsPlayLabel = document.getElementById('lsPlayLabel');
const lsHint      = document.getElementById('lsHint');
const lsAnswer    = document.getElementById('lsAnswer');
const lsBank      = document.getElementById('lsBank');
const lsCheckBtn  = document.getElementById('lsCheckBtn');
const lsRevealBtn = document.getElementById('lsRevealBtn');
const lsResult    = document.getElementById('lsResult');
const lsVerdict   = document.getElementById('lsVerdict');
const lsZh        = document.getElementById('lsZh');
const lsPy        = document.getElementById('lsPy');
const lsPt        = document.getElementById('lsPt');
const lsEn        = document.getElementById('lsEn');
const lsStatus    = document.getElementById('lsStatus');
const lsNextBtn   = document.getElementById('lsNextBtn');

/* The 🐢 toggle, as an Edge TTS percentage.  Normal delivery is already
   -25%, so this is roughly half of that again — slow enough to separate
   the syllables of a compound like 洗衣机 rather than merely unhurried. */
const LS_SLOW_RATE = '-65%';
const LS_PREF_KEY  = 'mpp.ls.prefs';

/* Kept together so the fit can reserve room for the longest of them —
   "not scored" says out loud why the counter didn't move, which is the
   part that looks broken when you've read the answer rather than tried. */
const LS_VERDICTS = {
  shown: '答案 · Answer (not scored)',
  sound: '✓ 同音 · Correct — same sound',
  right: '✓ 对了 · Correct!',
  wrong: '✗ 不对 · Not quite',
};

let lsInitialized = false;
let lsScope   = 'prova1';
let lsSlow    = false;
let lsPhrase  = null;   // the phrase being drilled, from buildListeningPhrase
let lsTiles   = [];     // { id, w } — the phrase's words plus decoys, shuffled
let lsPlaced  = [];     // tile ids, in the order the student tapped them
let lsDone    = false;  // answered or revealed: the tiles are frozen
let lsAsked   = 0;
let lsRight   = 0;

/* Scope and speed are worth remembering between sessions; the score is
   not — it is a measure of this sitting.  The scope is checked against
   the buttons actually on screen, so a preference saved before "Exam 1 +
   2" was folded into "Exam 2" resolves to a button that still exists. */
const lsScopeExists = key => [...lsScopeBtns].some(b => b.dataset.scope === key);

function lsLoadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PREF_KEY)) || {};
    if (lsScopeExists(saved.scope)) lsScope = saved.scope;
    else if (saved.scope === 'both') lsScope = 'prova2';   // retired button
    lsSlow = !!saved.slow;
  } catch { /* corrupt entry — keep the defaults */ }
}

function lsSavePrefs() {
  try { localStorage.setItem(LS_PREF_KEY, JSON.stringify({ scope: lsScope, slow: lsSlow })); }
  catch { /* private browsing — the preference just doesn't persist */ }
}

function lsApplyScope() {
  lsScopeBtns.forEach(btn => {
    const on = btn.dataset.scope === lsScope;
    btn.classList.toggle('ls-scope__btn--active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function lsApplySlow() {
  lsSlowBtn.classList.toggle('fc-shuffle--on', lsSlow);
  lsSlowBtn.setAttribute('aria-pressed', String(lsSlow));
}

function lsUpdateScore() {
  lsScoreEl.textContent = lsAsked
    ? `${lsRight} / ${lsAsked} correct`
    : '0 correct';
}

function lsInit() {
  lsInitialized = true;
  lsLoadPrefs();
  lsApplyScope();
  lsApplySlow();
  lsNewPhrase({ autoplay: false });   // a first tap should be the student's
  lsFit();   // before the first paint, so nothing is seen to resize
}

/* ── Building the tile row ─────────────────────────────────── */

function lsTileButton(tile, placed) {
  const btn = document.createElement('button');
  btn.type        = 'button';
  btn.className   = 'ls-tile';
  btn.textContent = tile.w;
  btn.lang        = 'zh-CN';
  btn.disabled    = lsDone;
  btn.dataset.id  = tile.id;
  btn.setAttribute('aria-label',
    placed ? `${tile.w} — tap to take it back` : `${tile.w} — tap to add it`);
  return btn;
}

function lsRenderTiles() {
  const placed = new Set(lsPlaced);

  lsAnswer.replaceChildren(...lsPlaced.map(id => {
    const tile = lsTiles.find(t => t.id === id);
    const btn  = lsTileButton(tile, true);
    btn.addEventListener('click', () => {
      lsPlaced = lsPlaced.filter(x => x !== id);
      lsRenderTiles();
    });
    return btn;
  }));

  lsBank.replaceChildren(...lsTiles.filter(t => !placed.has(t.id)).map(tile => {
    const btn = lsTileButton(tile, false);
    btn.addEventListener('click', () => {
      lsPlaced.push(tile.id);
      lsRenderTiles();
    });
    return btn;
  }));

  // The answer slot keeps its height whether or not anything is in it
  lsAnswer.classList.toggle('ls-answer--empty', lsPlaced.length === 0);
  lsCheckBtn.disabled = lsDone || lsPlaced.length !== lsPhrase?.tokens.length;
}

/* ── A new phrase ──────────────────────────────────────────── */

function lsNewPhrase({ autoplay = true } = {}) {
  stopCurrentAudio();

  const built = buildListeningPhrase(lsScope, lsPhrase?.id);
  if (!built) {
    // Only reachable if a deck were edited down to almost nothing
    lsPhrase = null;
    lsAnswer.replaceChildren();
    lsBank.replaceChildren();
    lsPlayBtn.disabled = lsCheckBtn.disabled = lsRevealBtn.disabled = true;
    showStatus('No phrase can be built from this vocabulary.', lsStatus);
    return;
  }

  lsPhrase = built;
  lsDone   = false;
  lsPlaced = [];

  // Ids rather than the words themselves: a phrase may use the same word
  // twice, and each tile still has to be its own button.
  lsTiles = [...built.tokens, ...built.decoys]
    .map((w, i) => ({ id: i, w }))
    .sort(() => Math.random() - 0.5);

  lsPlayBtn.disabled = lsRevealBtn.disabled = false;
  lsBank.hidden   = false;    // the two share one fixed-height slot
  lsResult.hidden = true;
  lsCheckBtn.hidden = lsRevealBtn.hidden = false;
  lsNextBtn.hidden  = true;   // nothing to move on from yet
  lsVerdict.className = 'ls-verdict';
  lsHint.textContent = 'Tap the words in the order you heard them.';
  showStatus('', lsStatus);
  lsRenderTiles();

  if (autoplay) lsSpeak();
}

function lsSpeak() {
  if (!lsPhrase) return;
  if (!navigator.onLine) {
    showStatus("You're offline — playback may not work.", lsStatus);
  }
  speak(lsPhrase.text, lsPlayBtn, lsSlow ? LS_SLOW_RATE : EDGE_TTS_RATE);
}

/* ── Answering ─────────────────────────────────────────────── */

/* Reveal everything and freeze the tiles.  `ok` is null when the student
   gave up rather than answered, which is not counted either way.
   `bySound` marks an answer that was right to the ear but written with a
   homophone — worth saying, since the revealed phrase will differ from
   what they built and that would otherwise look like a mistake. */
function lsFinish(ok, bySound = false) {
  lsDone = true;
  // The bank is spent; the result takes over its slot rather than being
  // added under the buttons, which would push them down the screen.
  lsBank.hidden   = true;
  lsResult.hidden = false;
  lsZh.textContent = lsPhrase.text;
  lsPy.textContent = lsPhrase.pinyin;
  lsPt.textContent = lsPhrase.pt;
  lsEn.textContent = lsPhrase.en;

  lsVerdict.textContent = ok === null ? LS_VERDICTS.shown
                        : bySound     ? LS_VERDICTS.sound
                        : ok          ? LS_VERDICTS.right
                        :               LS_VERDICTS.wrong;
  lsVerdict.classList.toggle('ls-verdict--good', ok === true);
  lsVerdict.classList.toggle('ls-verdict--bad',  ok === false);

  lsHint.textContent = 'Play it once more now that you can see it.';
  lsRenderTiles();          // repaints the tiles as disabled
  lsCheckBtn.hidden = lsRevealBtn.hidden = true;
  lsNextBtn.hidden  = false;
  lsNextBtn.focus({ preventScroll: true });
}

/* Judged by sound, not by spelling.  This is a listening drill: if what
   the student built is pronounced exactly like the phrase, they heard it
   correctly, and marking 她 wrong for a 他 they cannot possibly have
   distinguished would be punishing them for having ears. */
function lsCheck() {
  if (!lsPhrase || lsDone) return;

  const said  = lsPlaced.map(id => lsTiles.find(t => t.id === id).w);
  const exact = said.join('') === lsPhrase.tokens.join('');
  const ok    = exact ||
    listenSoundOf(said, lsScope) === listenSoundOf(lsPhrase.tokens, lsScope);

  lsAsked++;
  if (ok) lsRight++;
  lsUpdateScore();
  lsFinish(ok, ok && !exact);
}

/* ── Holding the layout still ──────────────────────────────────
   Same idea as the flashcard fit, and for the same reason: the two
   tile rows and the result all vary with the phrase, and if they set
   their own height then placing a word, revealing an answer or moving
   to a longer phrase would shift the buttons under the reader's thumb.

   So each gets a slot measured once per viewport against the worst
   case, and the worst case is drawn from *every* deck rather than the
   selected one — the same choice that made exam 1 and exam 2 identical
   in the flashcard view. */

/* The most demanding phrase the generator can actually produce, found by
   sampling it — the widest tile row, the longest answer row, and the
   longest of each line of the result.  Sampling real output rather than
   filling the slots with synthetic text matters: filler always fills
   every line the clamps allow, which reserves a third of the screen for
   phrases that never happen.  The clamps stay as a backstop for anything
   the sample missed.  Cached; only re-read on a resize. */
let lsWorstCache = null;

function lsWorstCase() {
  if (!lsWorstCache) {
    const width  = words => words.join('').length + words.length;   // chars + padding
    const longer = (best, s) => (s.length > best.length ? s : best);
    const worst  = { tiles: [], answer: [], text: '', pinyin: '', pt: '', en: '' };

    // Seeded, so the card is the same height every time the app is opened
    // rather than a few pixels different depending on what got drawn.
    withSeededPhrases(0x5A11AD, () => {
      for (let i = 0; i < 600; i++) {
        const p = buildListeningPhrase('both');
        if (!p) continue;
        const all = [...p.tokens, ...p.decoys];
        if (width(all) > width(worst.tiles))        worst.tiles  = all;
        if (width(p.tokens) > width(worst.answer))  worst.answer = p.tokens;
        worst.text   = longer(worst.text,   p.text);
        worst.pinyin = longer(worst.pinyin, p.pinyin);
        worst.pt     = longer(worst.pt,     p.pt);
        worst.en     = longer(worst.en,     p.en);
      }
    });
    lsWorstCache = worst;
  }
  return lsWorstCache;
}

/* Heights are fractional, and offsetHeight rounds — reserving 177px for
   something that is really 178.4px tall clips it by two. getBoundingClientRect
   keeps the fraction; rounding it up is what makes the reserve a true
   upper bound. */
const lsHeightOf = el => Math.ceil(el.getBoundingClientRect().height);

/* Height of `el` when filled with `words` instead of what's in it */
function lsMeasureTiles(el, words) {
  const shown = [...el.children];
  el.replaceChildren(...words.map(w => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'ls-tile';
    tile.textContent = w;
    return tile;
  }));
  const height = lsHeightOf(el);
  el.replaceChildren(...shown);
  return height;
}

function lsFit() {
  if (!lsInitialized || VIEWS.listening.hidden) return;

  const worst = lsWorstCase();
  const shown = {
    bank:    lsBank.hidden,     result: lsResult.hidden,
    verdict: lsVerdict.textContent, zh: lsZh.textContent,
    py:      lsPy.textContent,  pt: lsPt.textContent, en: lsEn.textContent,
  };

  // Everything below happens inside one frame, so none of it is painted.
  lsCard.classList.add('ls-measuring');

  const answerH = lsMeasureTiles(lsAnswer, worst.answer);

  lsBank.hidden = false;
  lsResult.hidden = true;
  const bankH = lsMeasureTiles(lsBank, worst.tiles);

  lsBank.hidden = true;
  lsResult.hidden = false;
  lsVerdict.textContent =
    Object.values(LS_VERDICTS).reduce((a, b) => (b.length > a.length ? b : a));
  lsZh.textContent = worst.text;
  lsPy.textContent = worst.pinyin;
  lsPt.textContent = worst.pt;
  lsEn.textContent = worst.en;
  const resultH = lsHeightOf(lsResult);

  // Put back exactly what was on screen before
  lsVerdict.textContent = shown.verdict;
  lsZh.textContent = shown.zh;
  lsPy.textContent = shown.py;
  lsPt.textContent = shown.pt;
  lsEn.textContent = shown.en;
  lsBank.hidden   = shown.bank;
  lsResult.hidden = shown.result;
  lsCard.classList.remove('ls-measuring');

  // 1px of slack: sub-pixel layout can land just over a whole-pixel reserve,
  // and a hair of unused space is invisible where a clipped line is not.
  fcRoot.style.setProperty('--ls-answer-h', `${answerH + 1}px`);
  fcRoot.style.setProperty('--ls-stage-h',  `${Math.max(bankH, resultH) + 1}px`);
}

let lsFitQueued = false;

function lsScheduleFit() {
  if (lsFitQueued) return;
  lsFitQueued = true;
  requestAnimationFrame(() => { lsFitQueued = false; lsFit(); });
}

['resize', 'orientationchange', 'load'].forEach(evt =>
  window.addEventListener(evt, lsScheduleFit)
);

/* ── Wiring ────────────────────────────────────────────────── */

lsScopeBtns.forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.scope === lsScope) return;
  lsScope = btn.dataset.scope;
  lsApplyScope();
  lsSavePrefs();
  lsNewPhrase({ autoplay: false });   // different vocabulary, fresh phrase
}));

lsSlowBtn.addEventListener('click', () => {
  lsSlow = !lsSlow;
  lsApplySlow();
  lsSavePrefs();
  lsSpeak();          // hearing the difference immediately is the point
});

lsPlayBtn.addEventListener('click', lsSpeak);
lsCheckBtn.addEventListener('click', lsCheck);
lsRevealBtn.addEventListener('click', () => { if (!lsDone) lsFinish(null); });
lsNextBtn.addEventListener('click', () => lsNewPhrase());
/* Skipping doesn't count against the score — it is for a phrase the
   student would rather not spend time on, not a wrong answer. */
lsSkipBtn.addEventListener('click', () => lsNewPhrase({ autoplay: false }));
