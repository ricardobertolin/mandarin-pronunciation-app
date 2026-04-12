/* ============================================================
   Mandarin Pronunciation Practice — Application Logic
   ============================================================
   Flow:
     1. User optionally enters a target phrase in the <input>.
     2. User taps the record button → SpeechRecognition starts.
     3. Browser transcribes speech (zh-CN) and returns the text.
     4. If a target was provided, a character-by-character diff
        is computed and displayed with a percentage score.
     5. "Try Again" resets the UI back to the initial state.
   ============================================================ */

'use strict';

/* ── Register Service Worker ───────────────────────────────── */
if ('serviceWorker' in navigator) {
  // Wait until page load so the SW registration doesn't
  // compete with critical resource fetches.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(reg => console.log('[SW] Registered, scope:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

/* ── DOM References ────────────────────────────────────────── */
const targetInput     = document.getElementById('target');
const recordBtn       = document.getElementById('recordBtn');
const recordLabel     = document.getElementById('recordLabel');
const statusEl        = document.getElementById('status');
const resultsSection  = document.getElementById('results');
const transcribedEl   = document.getElementById('transcribed');
const comparisonBlock = document.getElementById('comparisonBlock');
const targetDisplay   = document.getElementById('targetDisplay');
const diffDisplay     = document.getElementById('diffDisplay');
const scoreValue      = document.getElementById('scoreValue');
const tryAgainBtn     = document.getElementById('tryAgainBtn');

/* ── Speech Recognition Setup ──────────────────────────────── */
// Vendor-prefixed for broad browser support.
// Bracket notation avoids the TS/JSDoc type-checker hint about
// window.SpeechRecognition not being in the standard DOM typings yet.
const SpeechRecognition =
  window['SpeechRecognition'] || window['webkitSpeechRecognition'];

// Show a clear error if the browser doesn't support the API
// (e.g. Firefox Desktop without the flag, or non-HTTPS pages)
if (!SpeechRecognition) {
  showStatus(
    '⚠️ Your browser does not support the Web Speech API. ' +
    'Please use Chrome on Android or desktop.',
    'error'
  );
  recordBtn.disabled = true;
}

let recognition = null;   // created fresh for each recording session
let isRecording  = false;

/* ── Record Button ─────────────────────────────────────────── */
recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

/* ── Try Again Button ──────────────────────────────────────── */
tryAgainBtn.addEventListener('click', resetUI);

/* ── Start Recording ───────────────────────────────────────── */
function startRecording() {
  if (!SpeechRecognition) return;

  // Create a new recognition instance each time so we can restart
  // cleanly after a previous session ends.
  recognition = new SpeechRecognition();

  recognition.lang           = 'zh-CN';  // Mandarin Chinese (Simplified)
  recognition.interimResults = false;    // only fire when speech is final
  recognition.maxAlternatives = 1;       // we only need the best guess
  recognition.continuous     = false;    // stop after first utterance

  // ── Event: recognition has started ──────────────────────
  recognition.onstart = () => {
    isRecording = true;
    recordBtn.classList.add('record-btn--recording');
    recordBtn.setAttribute('aria-pressed', 'true');
    recordBtn.setAttribute('aria-label', 'Stop recording');
    recordLabel.textContent = 'Listening…';
    showStatus('Speak now in Mandarin…');
  };

  // ── Event: final result received ────────────────────────
  recognition.onresult = (event) => {
    // event.results is a SpeechRecognitionResultList.
    // [0][0].transcript is the first (best) alternative of the
    // first (and only, since continuous=false) result.
    const transcript = event.results[0][0].transcript.trim();
    handleTranscript(transcript);
  };

  // ── Event: recognition ended (natural or manual stop) ───
  recognition.onend = () => {
    setIdleState();
  };

  // ── Event: error ─────────────────────────────────────────
  recognition.onerror = (event) => {
    console.warn('[Speech] Error:', event.error);
    setIdleState();

    const messages = {
      'no-speech':         'No speech detected. Please try again.',
      'audio-capture':     'Microphone not found. Check your device settings.',
      'not-allowed':       'Microphone permission denied. Please allow access and reload.',
      'network':           'Network error. Check your connection.',
      'aborted':           '',            // user stopped manually — no message needed
      'service-not-allowed': 'Speech service not allowed. Make sure the page is served over HTTPS.',
    };

    const msg = messages[event.error];
    if (msg) showStatus('⚠️ ' + msg);
  };

  // Start listening
  try {
    recognition.start();
  } catch (e) {
    // Can throw if called while already active
    console.warn('[Speech] Could not start:', e);
    setIdleState();
  }
}

/* ── Stop Recording (manual tap) ───────────────────────────── */
function stopRecording() {
  if (recognition) {
    // .stop() lets the engine finish processing what it heard;
    // .abort() would discard the audio entirely.
    recognition.stop();
  }
}

/* ── Restore idle button state ─────────────────────────────── */
function setIdleState() {
  isRecording = false;
  recordBtn.classList.remove('record-btn--recording');
  recordBtn.setAttribute('aria-pressed', 'false');
  recordBtn.setAttribute('aria-label', 'Start recording');
  recordLabel.textContent = 'Tap to Speak';
}

/* ── Handle the transcribed text ──────────────────────────────
   Called once we have a final transcript from the API.
   ──────────────────────────────────────────────────────────── */
function handleTranscript(transcript) {
  showStatus('');  // clear "Speak now" message

  if (!transcript) {
    showStatus('No speech was detected. Please try again.');
    return;
  }

  // Show what was transcribed
  transcribedEl.textContent = transcript;

  const target = targetInput.value.trim();

  if (target) {
    // ── Mode 2: compare transcription against the target ──
    const { charResults, score } = compareChars(target, transcript);

    targetDisplay.textContent = target;
    renderDiff(charResults);
    scoreValue.textContent    = score + '%';
    comparisonBlock.hidden    = false;
  } else {
    // ── Mode 1: no target — just show what was said ───────
    comparisonBlock.hidden = true;
  }

  // Reveal the results card
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Character Comparison ──────────────────────────────────────
   Aligns target and transcript by position and classifies each
   slot as: correct | wrong | missing | extra.

   @param {string} target     – the intended phrase
   @param {string} transcript – what the user actually said
   @returns {{ charResults: Array, score: number }}
   ──────────────────────────────────────────────────────────── */
function compareChars(target, transcript) {
  // Use Array.from() so we correctly iterate Unicode code points
  // (important for emoji and rare CJK extension characters).
  const tChars = Array.from(target);
  const sChars = Array.from(transcript);

  const maxLen = Math.max(tChars.length, sChars.length);
  const charResults = [];
  let   matches = 0;

  for (let i = 0; i < maxLen; i++) {
    const tChar = tChars[i];  // undefined if transcript is longer
    const sChar = sChars[i];  // undefined if target is longer

    if (tChar !== undefined && sChar !== undefined) {
      if (tChar === sChar) {
        matches++;
        charResults.push({ char: sChar, type: 'correct' });
      } else {
        // Wrong character said at this position.
        // We display what the user SAID (sChar) in red so they
        // can see exactly what came out of their mouth.
        charResults.push({ char: sChar, type: 'wrong', expected: tChar });
      }
    } else if (sChar !== undefined) {
      // User said more characters than the target has.
      charResults.push({ char: sChar, type: 'extra' });
    } else {
      // Target has a character here but the user didn't say it.
      charResults.push({ char: tChar, type: 'missing' });
    }
  }

  // Score: percentage of TARGET characters that were correct.
  // Using tChars.length (not maxLen) so extra syllables don't
  // inflate the score above 100%.
  const score = tChars.length > 0
    ? Math.round((matches / tChars.length) * 100)
    : 0;

  return { charResults, score };
}

/* ── Render Diff ───────────────────────────────────────────────
   Builds <span> elements for each character result and injects
   them into #diffDisplay. Each span gets a class that maps to
   the colour scheme defined in style.css.

   For 'wrong' characters a tooltip (title attribute) shows what
   the expected character was — useful on desktop; on mobile the
   long-press context menu may expose it.
   ──────────────────────────────────────────────────────────── */
function renderDiff(charResults) {
  // Clear previous diff
  diffDisplay.innerHTML = '';

  const fragment = document.createDocumentFragment();

  charResults.forEach(({ char, type, expected }) => {
    const span = document.createElement('span');
    span.classList.add('ch', `ch--${type}`);
    span.textContent = char;

    if (type === 'wrong' && expected) {
      // Screen-reader-friendly label: "said X expected Y"
      span.setAttribute('aria-label', `said ${char}, expected ${expected}`);
      span.setAttribute('title', `Expected: ${expected}`);
    }

    fragment.appendChild(span);
  });

  diffDisplay.appendChild(fragment);
}

/* ── Show / clear status message ──────────────────────────────*/
function showStatus(message) {
  statusEl.textContent = message;
}

/* ── Reset UI to initial state ─────────────────────────────── */
function resetUI() {
  // Hide results and clear content
  resultsSection.hidden   = true;
  comparisonBlock.hidden  = true;
  transcribedEl.textContent  = '';
  targetDisplay.textContent  = '';
  diffDisplay.innerHTML      = '';
  scoreValue.textContent     = '0%';

  // Clear any lingering status text
  showStatus('');

  // Put focus back on the input so the user can change the target
  targetInput.focus();
}
