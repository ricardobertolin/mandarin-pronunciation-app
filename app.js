/* ============================================================
   Mandarin Pronunciation Practice — Application Logic  v2.3.6
   ============================================================
   Features:
     • Speech recognition (zh-CN) with char-by-char diff + score
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
const transcribedEnglish    = document.getElementById('transcribedEnglish');
const transcribedPortuguese = document.getElementById('transcribedPortuguese');
const comparisonBlock    = document.getElementById('comparisonBlock');
const targetDisplay      = document.getElementById('targetDisplay');
const targetPinyin       = document.getElementById('targetPinyin');
const diffDisplay        = document.getElementById('diffDisplay');
const scoreValue              = document.getElementById('scoreValue');
const tryAgainBtn             = document.getElementById('tryAgainBtn');
const pronounceTargetBtn      = document.getElementById('pronounceTargetBtn');
const pronounceTranscribedBtn = document.getElementById('pronounceTranscribedBtn');

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

recordBtn.addEventListener('click', () => {
  if (isRecording) stopRecording();
  else             startRecording();
});

tryAgainBtn.addEventListener('click', resetUI);

/* ── Start / Stop Recording ────────────────────────────────── */
function startRecording() {
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang            = 'zh-CN';
  recognition.interimResults  = false;
  recognition.maxAlternatives = 1;
  recognition.continuous      = false;

  recognition.onstart = () => {
    isRecording = true;
    recordBtn.classList.add('record-btn--recording');
    recordBtn.setAttribute('aria-pressed', 'true');
    recordBtn.setAttribute('aria-label', 'Stop recording');
    recordLabel.textContent = 'Listening…';
    showStatus('Speak now in Mandarin…');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    handleTranscript(transcript);
  };

  recognition.onend  = () => setIdleState();

  recognition.onerror = (event) => {
    console.warn('[Speech] Error:', event.error);
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
    if (msg) showStatus('⚠️ ' + msg);
  };

  try { recognition.start(); }
  catch (e) { console.warn('[Speech] Could not start:', e); setIdleState(); }
}

function stopRecording() {
  if (recognition) recognition.stop();
}

function setIdleState() {
  isRecording = false;
  recordBtn.classList.remove('record-btn--recording');
  recordBtn.setAttribute('aria-pressed', 'false');
  recordBtn.setAttribute('aria-label', 'Start recording');
  recordLabel.textContent = 'Tap to Speak';
}

/* ── Handle Transcription ──────────────────────────────────────
   Called with the final zh-CN transcript from the Speech API.
   ──────────────────────────────────────────────────────────── */
function handleTranscript(transcript) {
  showStatus('');

  if (!transcript) {
    showStatus('No speech was detected. Please try again.');
    return;
  }

  transcribedEl.textContent = transcript;
  pronounceTranscribedBtn.hidden = false;   // show TTS button for result

  // Show pinyin + English translation below the Chinese characters
  showTranscriptAnnotations(transcript);

  const target = targetInput.value.trim();
  if (target) {
    const { charResults, score } = compareChars(target, transcript);

    targetDisplay.textContent = target;
    if (typeof pinyinPro !== 'undefined') {
      targetPinyin.textContent = pinyinPro.pinyin(target, { separator: ' ' });
      targetPinyin.hidden = false;
    } else {
      targetPinyin.hidden = true;
    }
    renderDiff(charResults);
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

async function showTranscriptAnnotations(chineseText) {
  // ── Show placeholders ────────────────────────────────────
  transcribedEnglish.textContent    = 'Translating…';
  transcribedEnglish.hidden         = false;
  transcribedPortuguese.textContent = 'Traduzindo…';
  transcribedPortuguese.hidden      = false;
  transcribedPinyin.textContent     = '…';
  transcribedPinyin.hidden          = false;

  // ── Fetch all in parallel ────────────────────────────────
  const [english, portuguese, pinyin] = await Promise.all([
    translateText(chineseText, 'zh-CN', 'en'),
    translateText(chineseText, 'zh-CN', 'pt-BR'),
    getPinyin(chineseText),
  ]);

  transcribedEnglish.textContent    = english    ?? '(Translation unavailable)';
  transcribedPortuguese.textContent = portuguese ?? '(Tradução indisponível)';
  if (pinyin) {
    transcribedPinyin.textContent = pinyin;
    transcribedPinyin.hidden      = false;
  } else {
    transcribedPinyin.hidden = true;
  }
}

/* ── Free Translation API (MyMemory) ───────────────────────────
   Rate limit: 5 000 chars/day without key, no sign-up required.
   Returns the translated string, or null on any failure.
   ──────────────────────────────────────────────────────────── */
async function translateText(text, fromLang, toLang) {
  // Use AbortController so a slow connection doesn't block the UI forever
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const url =
      `https://api.mymemory.translated.net/get` +
      `?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;

    const res  = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json();
    // responseStatus 200 means success; 403/429 means rate-limited
    if (data.responseStatus === 200) {
      return data.responseData.translatedText;
    }
    return null;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[Translate]', e.name === 'AbortError' ? 'Timed out' : e.message);
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

/* ── Character Comparison ──────────────────────────────────────
   Aligns target and transcript by position; classifies each
   slot as: correct | wrong | missing | extra.
   ──────────────────────────────────────────────────────────── */
function compareChars(target, transcript) {
  const tChars = Array.from(target);
  const sChars = Array.from(transcript);
  const maxLen = Math.max(tChars.length, sChars.length);
  const charResults = [];
  let matches = 0;

  for (let i = 0; i < maxLen; i++) {
    const tChar = tChars[i];
    const sChar = sChars[i];

    if (tChar !== undefined && sChar !== undefined) {
      if (normalizeChar(tChar) === normalizeChar(sChar)) {
        matches++;
        charResults.push({ char: sChar, type: 'correct' });
      } else {
        charResults.push({ char: sChar, type: 'wrong', expected: tChar });
      }
    } else if (sChar !== undefined) {
      charResults.push({ char: sChar, type: 'extra' });
    } else {
      charResults.push({ char: tChar, type: 'missing' });
    }
  }

  const score = tChars.length > 0
    ? Math.round((matches / tChars.length) * 100)
    : 0;

  return { charResults, score };
}

/* ── Render Diff ───────────────────────────────────────────── */
function renderDiff(charResults) {
  diffDisplay.innerHTML = '';
  const fragment = document.createDocumentFragment();

  charResults.forEach(({ char, type, expected }) => {
    const span = document.createElement('span');
    span.classList.add('ch', `ch--${type}`);
    span.textContent = char;
    if (type === 'wrong' && expected) {
      span.setAttribute('aria-label', `said ${char}, expected ${expected}`);
      span.setAttribute('title', `Expected: ${expected}`);
    }
    fragment.appendChild(span);
  });

  diffDisplay.appendChild(fragment);
}

/* ── Helpers ───────────────────────────────────────────────── */
function showStatus(message) { statusEl.textContent = message; }

function resetUI() {
  // Stop any ongoing audio (Edge TTS or Web Speech fallback)
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();

  resultsSection.hidden              = true;
  comparisonBlock.hidden             = true;
  transcribedEl.textContent          = '';
  transcribedPinyin.hidden           = true;
  transcribedEnglish.hidden          = true;
  transcribedPortuguese.hidden       = true;
  targetPinyin.hidden                = true;
  targetPinyin.textContent           = '';
  pronounceTranscribedBtn.hidden     = true;
  pronounceTranscribedBtn.classList.remove('btn-pronounce--speaking');
  targetDisplay.textContent          = '';
  diffDisplay.innerHTML              = '';
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
let currentSpeakBtn = null;

function makeUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function edgeTTSRequest(text) {
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
        `<prosody rate='${EDGE_TTS_RATE}'>${text}</prosody>` +
        `</voice></speak>`;

      ws.send(
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}Z\r\n` +
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

async function speak(text, btn) {
  if (!text.trim()) return;

  // Toggle off if already speaking via this button
  if (currentSpeakBtn === btn && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    btn?.classList.remove('btn-pronounce--speaking');
    currentSpeakBtn = null;
    return;
  }

  // Stop any other audio that's playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentSpeakBtn?.classList.remove('btn-pronounce--speaking');
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();

  btn?.classList.add('btn-pronounce--speaking');
  currentSpeakBtn = btn;

  try {
    const blob = await edgeTTSRequest(text);
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    audio.onended = audio.onerror = () => {
      URL.revokeObjectURL(url);
      btn?.classList.remove('btn-pronounce--speaking');
      if (currentSpeakBtn === btn) currentSpeakBtn = null;
      currentAudio = null;
    };

    await audio.play();
  } catch (err) {
    console.warn('[EdgeTTS] Failed, falling back to Web Speech:', err);
    btn?.classList.remove('btn-pronounce--speaking');
    if (currentSpeakBtn === btn) currentSpeakBtn = null;
    speakWebSpeech(text, btn);
  }
}

function speakWebSpeech(text, btn) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang  = 'zh-CN';
  utterance.rate  = 0.75;
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
    if (/th|wh|gh|ph|ck|qu/.test(norm)) return false;
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
  '.':'。', ',':'，', '!':'！', '?':'？', ';':'；', ':':'：',
  '…':'…', '"':'「', '"':'」',
};

/* ── Convert a full pinyin string → Chinese ────────────────── */
function convertPinyin(raw) {
  const norm = normalizePinyin(raw).trim();
  if (!norm) return raw;
  if (PY[norm]) return PY[norm];
  return norm.split(/\s+/).map(token => {
    // Separate trailing punctuation from the syllable
    const m = token.match(/^([a-z1-5''·]+)([.,!?;:…""]+)?$/);
    if (!m) return token;                       // not pinyin, pass through
    const hanzi = convertToken(m[1]);
    const punct = m[2] ? m[2].split('').map(c => PUNCT_MAP[c] || c).join('') : '';
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
  // MyMemory's pt-BR|zh-CN pair has weak coverage.
  // Chain through English (pt-BR → en → zh-CN) for reliable results.
  let result;
  if (fromLang === 'pt-BR') {
    const intermediate = await translateText(val.trim(), 'pt-BR', 'en');
    result = intermediate ? await translateText(intermediate, 'en', 'zh-CN') : null;
  } else {
    result = await translateText(val.trim(), fromLang, 'zh-CN');
    // Fallback: if English translation failed, try as Portuguese
    // (handles PT words not in our word list that were misdetected as English)
    if ((!result || result === val.trim()) && fromLang === 'en') {
      const intermediate = await translateText(val.trim(), 'pt-BR', 'en');
      if (intermediate && intermediate !== val.trim()) {
        result = await translateText(intermediate, 'en', 'zh-CN');
      }
    }
  }
  if (targetInput.value !== val) return;   // user edited while we waited

  if (result && result !== val.trim()) {
    targetInput.value = result;
    translateInputBtn.hidden   = true;
    translateInputBtn.disabled = false;
    convertBtn.hidden          = true;
    // Show pronounce button now that the field has Chinese text
    pronounceTargetBtn.hidden  = false;
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
