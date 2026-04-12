/* ============================================================
   Mandarin Pronunciation Practice — Application Logic  v2.0
   ============================================================
   Features:
     • Speech recognition (zh-CN) with char-by-char diff + score
     • Pinyin auto-convert:  nǐ hǎo / ni3hao3 / nihao → 你好
     • English auto-translate (input): "hello" → 你好
     • Transcription annotations: pinyin line + English line
     • Score ≥ 90 % turns green
   ============================================================ */

'use strict';

/* ── Service Worker ────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(reg => console.log('[SW] Registered, scope:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

/* ── DOM References ────────────────────────────────────────── */
const targetInput        = document.getElementById('target');
const convertBtn         = document.getElementById('convertBtn');
const translateInputBtn  = document.getElementById('translateInputBtn');
const recordBtn          = document.getElementById('recordBtn');
const recordLabel        = document.getElementById('recordLabel');
const statusEl           = document.getElementById('status');
const resultsSection     = document.getElementById('results');
const transcribedEl      = document.getElementById('transcribed');
const transcribedPinyin  = document.getElementById('transcribedPinyin');
const transcribedEnglish = document.getElementById('transcribedEnglish');
const comparisonBlock    = document.getElementById('comparisonBlock');
const targetDisplay      = document.getElementById('targetDisplay');
const diffDisplay        = document.getElementById('diffDisplay');
const scoreValue         = document.getElementById('scoreValue');
const tryAgainBtn        = document.getElementById('tryAgainBtn');

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

  // Show pinyin + English translation below the Chinese characters
  showTranscriptAnnotations(transcript);

  const target = targetInput.value.trim();
  if (target) {
    const { charResults, score } = compareChars(target, transcript);

    targetDisplay.textContent = target;
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
async function showTranscriptAnnotations(chineseText) {
  // ── Pinyin ────────────────────────────────────────────────
  // pinyinPro is injected by the CDN <script> tag in index.html.
  // If the library didn't load (first offline visit) we skip quietly.
  if (typeof pinyinPro !== 'undefined') {
    transcribedPinyin.textContent = pinyinPro.pinyin(chineseText, { separator: ' ' });
    transcribedPinyin.hidden = false;
  } else {
    transcribedPinyin.hidden = true;
  }

  // ── English translation ────────────────────────────────────
  transcribedEnglish.textContent = 'Translating…';
  transcribedEnglish.hidden = false;

  const english = await translateText(chineseText, 'zh', 'en');
  transcribedEnglish.textContent = english ?? '(Translation unavailable offline)';
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
      if (tChar === sChar) {
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
  resultsSection.hidden        = true;
  comparisonBlock.hidden       = true;
  transcribedEl.textContent    = '';
  transcribedPinyin.hidden     = true;
  transcribedEnglish.hidden    = true;
  targetDisplay.textContent    = '';
  diffDisplay.innerHTML        = '';
  scoreValue.textContent       = '0%';
  scoreValue.classList.remove('score__value--good');
  showStatus('');
  targetInput.focus();
}


/* ============================================================
   Pinyin → Chinese Character Conversion
   ============================================================
   Supports:
     • nǐ hǎo   (tone marks + spaces)
     • ni3hao3  (tone numbers, compact)
     • nihao    (plain, compact)
   ============================================================ */

const TONE_STRIP = {
  'ā':'a','á':'a','ǎ':'a','à':'a',
  'ē':'e','é':'e','ě':'e','è':'e',
  'ī':'i','í':'i','ǐ':'i','ì':'i',
  'ō':'o','ó':'o','ǒ':'o','ò':'o',
  'ū':'u','ú':'u','ǔ':'u','ù':'u',
  'ǖ':'v','ǘ':'v','ǚ':'v','ǜ':'v','ü':'v',
};

function normalizePinyin(str) {
  return str
    .toLowerCase()
    .replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, ch => TONE_STRIP[ch] ?? ch)
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

/* ── Detect pinyin ─────────────────────────────────────────────
   Returns true when the string looks like romanised Mandarin.
   Uses syllable coverage rather than a simple character-class
   test so that English words like "hello" don't match.
   ──────────────────────────────────────────────────────────── */
function looksLikePinyin(str) {
  if (!str.trim()) return false;
  // Any CJK character means it's already Chinese
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(str)) return false;
  // Must be only latin letters, tone marks, digits 1-5, spaces, apostrophes
  const norm = normalizePinyin(str).trim();
  if (!/^[a-z1-5\s''·]+$/.test(norm)) return false;

  // Measure what fraction of characters can be consumed by valid syllables.
  // A genuine pinyin string should score ≥ 55 %; pure English words score 0–20 %.
  const tokens = norm.split(/\s+/);
  let total = 0, matched = 0;

  for (const token of tokens) {
    total += token.length;
    let i = 0;
    while (i < token.length) {
      let hit = false;
      for (let len = Math.min(6, token.length - i); len >= 1; len--) {
        if (PY[token.slice(i, i + len)]) {
          matched += len;
          i += len;
          hit = true;
          break;
        }
      }
      if (!hit) i++;
    }
  }

  return total > 0 && matched / total >= 0.55;
}

/* ── Detect English ───────────────────────────────────────────
   True when the string has Latin words but is NOT pinyin.
   ──────────────────────────────────────────────────────────── */
function looksLikeEnglish(str) {
  if (!str.trim()) return false;
  if (/[\u4e00-\u9fff]/.test(str)) return false; // already Chinese
  if (looksLikePinyin(str)) return false;          // let pinyin converter handle it
  return /[a-zA-Z]{2,}/.test(str);
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

/* ── Convert a full pinyin string → Chinese ────────────────── */
function convertPinyin(raw) {
  const norm = normalizePinyin(raw).trim();
  if (!norm) return raw;
  if (PY[norm]) return PY[norm];
  return norm.split(/\s+/).map(convertToken).join('');
}


/* ============================================================
   Input field smart detection + auto-conversion / translation
   ============================================================
   Pinyin  → converts instantly (local lookup, synchronous)
   English → translates via MyMemory API (async):
               • paste   → translates immediately
               • typing  → translates 900 ms after last keystroke
   ============================================================ */

let translateDebounce = null;   // timer ID for debounced auto-translate

/* ── Core auto-translate helper ────────────────────────────────
   Calls the API for `val`, then writes the result back ONLY if
   the input hasn't changed while the request was in-flight.
   On failure, surfaces the manual button as a retry.
   ──────────────────────────────────────────────────────────── */
async function autoTranslateInput(val) {
  const result = await translateText(val.trim(), 'en', 'zh');

  // User changed the field while waiting — don't clobber their edit
  if (targetInput.value !== val) return;

  if (result) {
    targetInput.value = result;
    translateInputBtn.hidden = true;
    convertBtn.hidden        = true;
  } else {
    // Translation failed (offline?) → surface button as manual retry
    translateInputBtn.textContent = '→ Translate to Chinese';
    translateInputBtn.disabled    = false;
    translateInputBtn.hidden      = false;
  }
}

/* ── Input event: pinyin convert button + English debounce ─── */
targetInput.addEventListener('input', () => {
  clearTimeout(translateDebounce);

  const val  = targetInput.value;
  const isPy = looksLikePinyin(val);
  const isEn = !isPy && looksLikeEnglish(val);

  convertBtn.hidden        = !isPy;
  translateInputBtn.hidden = true;   // hidden while debounce is pending

  if (isEn && val.trim().length >= 2) {
    // Wait for the user to pause typing before hitting the API
    translateDebounce = setTimeout(() => autoTranslateInput(val), 900);
  }
});

/* ── Paste event ───────────────────────────────────────────────
   Pinyin  → convert synchronously, replace immediately.
   English → let the paste land in the field, then translate
             right away (no debounce delay for paste).
   ──────────────────────────────────────────────────────────── */
targetInput.addEventListener('paste', (e) => {
  clearTimeout(translateDebounce);
  const pasted = e.clipboardData?.getData('text') ?? '';

  if (looksLikePinyin(pasted)) {
    // ── Instant pinyin conversion ──────────────────────────
    e.preventDefault();
    const converted = convertPinyin(pasted);
    const start = targetInput.selectionStart ?? 0;
    const end   = targetInput.selectionEnd   ?? 0;
    targetInput.value =
      targetInput.value.slice(0, start) + converted + targetInput.value.slice(end);
    targetInput.selectionStart = targetInput.selectionEnd = start + converted.length;
    convertBtn.hidden        = true;
    translateInputBtn.hidden = true;

  } else if (looksLikeEnglish(pasted)) {
    // ── Immediate English translation ──────────────────────
    // Let the browser insert the pasted text normally first,
    // then translate what's now in the field.
    e.preventDefault();
    const start = targetInput.selectionStart ?? 0;
    const end   = targetInput.selectionEnd   ?? 0;
    const full  =
      targetInput.value.slice(0, start) + pasted + targetInput.value.slice(end);
    targetInput.value = full;
    targetInput.selectionStart = targetInput.selectionEnd = start + pasted.length;

    translateInputBtn.hidden = true;   // hide while in-flight
    autoTranslateInput(full);
  }
});

/* ── Convert button: manual pinyin → characters ────────────── */
convertBtn.addEventListener('click', () => {
  if (!looksLikePinyin(targetInput.value)) return;
  targetInput.value = convertPinyin(targetInput.value);
  convertBtn.hidden = true;
  targetInput.focus();
});

/* ── Translate button: manual retry when auto-translate fails ─ */
translateInputBtn.addEventListener('click', async () => {
  const val = targetInput.value.trim();
  if (!val) return;
  clearTimeout(translateDebounce);
  translateInputBtn.disabled    = true;
  translateInputBtn.textContent = 'Translating…';
  await autoTranslateInput(val);
  translateInputBtn.disabled = false;
});
