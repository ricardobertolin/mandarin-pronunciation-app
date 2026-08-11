/* ============================================================
   Sentence builder for the listening drill
   ============================================================
   No AI, and no pre-written sentence list either: every phrase is
   assembled at run time from hand-written grammar templates whose
   slots are filled with words taken from the flashcard decks in
   vocab.js.  Two consequences worth knowing:

     · Every character spoken is a character from the deck the
       student picked, so the drill can never outrun the vocabulary.
     · The Portuguese and English come from the same template that
       built the Chinese, so they are exact by construction — no
       translation service involved, and it works offline.

   Adding vocabulary:  give the word an entry in LISTEN_WORDS with
   the roles it can play.  Words without an entry are simply never
   picked; nothing breaks.  A word is only ever offered when the
   deck it lives in is in scope, which is read from FLASHCARD_DECKS
   rather than repeated here.
   ============================================================ */

/* ── Portuguese: present indicative ────────────────────────────
   Brazilian Portuguese distinguishes four forms across the people
   this drill uses:  eu · você/ele/ela · nós · vocês/eles. */
const PT_PERSON   = { '1sg': 0, '3sg': 1, '1pl': 2, '3pl': 3 };
const PT_ENDINGS  = {
  ar: ['o', 'a', 'amos', 'am'],
  er: ['o', 'e', 'emos', 'em'],
  ir: ['o', 'e', 'imos', 'em'],
};
const PT_IRREGULAR = {
  ser:     ['sou',    'é',      'somos',     'são'],
  estar:   ['estou',  'está',   'estamos',   'estão'],
  ter:     ['tenho',  'tem',    'temos',     'têm'],
  ir:      ['vou',    'vai',    'vamos',     'vão'],
  ver:     ['vejo',   'vê',     'vemos',     'veem'],
  fazer:   ['faço',   'faz',    'fazemos',   'fazem'],
  dormir:  ['durmo',  'dorme',  'dormimos',  'dormem'],
  poder:   ['posso',  'pode',   'podemos',   'podem'],
  saber:   ['sei',    'sabe',   'sabemos',   'sabem'],
  querer:  ['quero',  'quer',   'queremos',  'querem'],
  dirigir: ['dirijo', 'dirige', 'dirigimos', 'dirigem'],
};

function ptVerb(inf, n) {
  const i = PT_PERSON[n] ?? 1;
  if (PT_IRREGULAR[inf]) return PT_IRREGULAR[inf][i];
  const endings = PT_ENDINGS[inf.slice(-2)] || PT_ENDINGS.ar;
  return inf.slice(0, -2) + endings[i];
}

/* ── Portuguese: pretérito perfeito ────────────────────────────
   Only 过 needs it — 我去过日本 is "eu já fui ao Japão", and there is no
   way to say that in the present. */
const PT_PAST_ENDINGS = {
  ar: ['ei', 'ou', 'amos', 'aram'],
  er: ['i',  'eu', 'emos', 'eram'],
  ir: ['i',  'iu', 'imos', 'iram'],
};
const PT_PAST_IRREGULAR = {
  ser:   ['fui',    'foi',    'fomos',     'foram'],
  ir:    ['fui',    'foi',    'fomos',     'foram'],
  estar: ['estive', 'esteve', 'estivemos', 'estiveram'],
  ter:   ['tive',   'teve',   'tivemos',   'tiveram'],
  ver:   ['vi',     'viu',    'vimos',     'viram'],
  fazer: ['fiz',    'fez',    'fizemos',   'fizeram'],
  poder: ['pude',   'pôde',   'pudemos',   'puderam'],
  saber: ['soube',  'soube',  'soubemos',  'souberam'],
  querer:['quis',   'quis',   'quisemos',  'quiseram'],
};

function ptPast(inf, n) {
  const i = PT_PERSON[n] ?? 1;
  if (PT_PAST_IRREGULAR[inf]) return PT_PAST_IRREGULAR[inf][i];
  const endings = PT_PAST_ENDINGS[inf.slice(-2)] || PT_PAST_ENDINGS.ar;
  return inf.slice(0, -2) + endings[i];
}

/* ── English: only the third person singular inflects ────────── */
const EN_3SG = { have: 'has', be: 'is', do: 'does', go: 'goes', study: 'studies' };

function enVerb(base, n3) {
  if (!n3) return base;
  if (EN_3SG[base]) return EN_3SG[base];
  if (/(s|sh|ch|x|z|o)$/.test(base)) return base + 'es';
  if (/[^aeiou]y$/.test(base))       return base.slice(0, -1) + 'ies';
  return base + 's';
}

/* 过 in English is the present perfect: "have"/"has" + past participle */
const EN_PARTICIPLE = {
  be: 'been', go: 'been', see: 'seen', eat: 'eaten', drink: 'drunk',
  buy: 'bought', speak: 'spoken', have: 'had', do: 'done',
};

function enPart(base) {
  if (EN_PARTICIPLE[base]) return EN_PARTICIPLE[base];
  if (/e$/.test(base))               return base + 'd';            // use → used
  if (/[^aeiou]y$/.test(base))       return base.slice(0, -1) + 'ied';
  return base + 'ed';                                              // watch → watched
}

const enHave = s => (s.n3 ? 'has' : 'have');

const enBe = s => (s.n === '1sg' ? 'am' : s.n3 ? 'is' : 'are');
const enDo = s => (s.n3 ? 'does' : 'do');

/* ── Article helpers ───────────────────────────────────────── */
const cap   = s => s.charAt(0).toUpperCase() + s.slice(1);
const ptThe = w => (w.g === 'f' ? 'a '   : 'o '  ) + w.pt;   // o / a
const ptTo  = w => (w.g === 'f' ? 'à '   : 'ao ' ) + w.pt;   // a + o/a
const ptIn  = w => (w.g === 'f' ? 'na '  : 'no ' ) + w.pt;   // em + o/a
const ptInA = w => (w.g === 'f' ? 'numa ': 'num ') + w.pt;   // em + um/uma
const ptNear = w => (w.g === 'f' ? 'perto da ' : 'perto do ') + w.pt;

/* Mass nouns take no indefinite article: "compro roupa", not
   "compro uma roupa"; "buy fruit", not "buy a fruit". */
const ptA = w => (w.ptMass ? w.pt : (w.g === 'f' ? 'uma ' : 'um ') + w.pt);
const enA = w => (w.enMass || w.enPl ? w.en
                : (/^[aeiou]/i.test(w.en) ? 'an ' : 'a ') + w.en);   // an older brother

/* Same choice for a phrase that is already assembled — "an old office" */
const enAn = s => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;

/* A few English glosses are grammatically plural ("clothes",
   "trousers") and drag the verb and the demonstrative with them. */
const enIs   = w => (w.enPl ? 'are'   : 'is');
const enThis = w => (w.enPl ? 'these' : 'this');

/* Adjectives agree with the noun they describe — in number too, once the
   [NCAS] order starts counting them: "dois gatos fofos", "duas lojas
   pequenas", "três alunos jovens". */
const ptAdj = (a, noun) => (noun.g === 'f' ? a.ptf : a.pt);
const ptPlural = form => (form.endsWith('m') ? form.slice(0, -1) + 'ns' : form + 's');

/* 新/旧 describe objects and 可爱 describes creatures; neither crosses
   over, so 这只狗很旧 never gets generated. */
const adjFits = (a, o) => !(a.objOnly && o.animal) && !(a.alive && !o.animal);

/* 我的爸爸 → "meu pai", but 他的爸爸 → "o pai dele": third person
   possessives go after the noun in natural Brazilian Portuguese. */
function ptPoss(poss, noun) {
  if (poss.post) return `${noun.g === 'f' ? 'a' : 'o'} ${noun.pt} ${poss.post}`;
  return `${noun.g === 'f' ? poss.ptf : poss.pt} ${noun.pt}`;
}

/* Object of a transitive verb — which article to use is a property of
   the verb ("compro um livro" but "bebo água"), so it is stored there.
   'pl' is the generic plural liking takes: "gosto de gatos". */
const ptObj = (v, o) =>
  v.ptArt === 'a'   ? ptA(o)
: v.ptArt === 'the' ? ptThe(o)
: v.ptArt === 'pl'  ? (o.ptp || o.pt)
: o.pt;

const enObj = (v, o) =>
  v.enArt === 'a'   ? enA(o)
: v.enArt === 'the' ? 'the ' + o.en
: v.enArt === 'pl'  ? (o.enp || o.en)
: o.en;

/* Verbs whose Portuguese/English needs a fixed tail: 上班 is not
   "trabalhar" but "ir ao trabalho". */
const ptTail = v => (v.ptTail ? ' ' + v.ptTail : '');
const enTail = v => (v.enTail ? ' ' + v.enTail : '');


/* ============================================================
   The vocabulary the generator may use
   ============================================================
   r     roles this word can fill in a template
   pt/en gloss for *this* use — deliberately narrower than the
         flashcard gloss, which lists every sense
   g     grammatical gender, for Portuguese articles/adjectives
   ptp   Portuguese plural, enp English plural (counting template)
   mw    this noun's measure word
   n     grammatical person (pronouns), n3 = English 3rd sg
   ============================================================ */
const LISTEN_WORDS = {
  /* ── Pronouns ─────────────────────────────────────────────── */
  /* pronS = singular only.  Nationalities use it because "eles são
     cubano" would need a plural form of every nationality gloss. */
  '我':     { r: 'pron pronS',     n: '1sg', n3: false, pt: 'eu',    en: 'I' },
  '你':     { r: 'pron pronS you', n: '3sg', n3: false, pt: 'você',  en: 'you' },
  '他':     { r: 'pron pronS',     n: '3sg', n3: true,  pt: 'ele',   en: 'he' },
  '她':     { r: 'pron pronS',     n: '3sg', n3: true,  pt: 'ela',   en: 'she', f: true },
  '我们':   { r: 'pron',           n: '1pl', n3: false, pt: 'nós',   en: 'we' },
  '你们':   { r: 'pron you',       n: '3pl', n3: false, pt: 'vocês', en: 'you' },
  '他们':   { r: 'pron',           n: '3pl', n3: false, pt: 'eles',  en: 'they' },

  /* ── Possessives ──────────────────────────────────────────── */
  '我的':   { r: 'poss',       pt: 'meu',   ptf: 'minha', en: 'my' },
  '你的':   { r: 'poss poss2', pt: 'seu',   ptf: 'sua',   en: 'your' },
  '我们的': { r: 'poss',       pt: 'nosso', ptf: 'nossa', en: 'our' },
  '他的':   { r: 'poss poss2', post: 'dele', en: 'his' },
  '她的':   { r: 'poss poss2', post: 'dela', en: 'her' },

  /* ── People ───────────────────────────────────────────────── */
  /* You have exactly one of each of these, so they stay out of `count`
     — otherwise the generator asks 你有几个爸爸？ */
  '爸爸':   { r: 'person', mw: '个', g: 'm', pt: 'pai', en: 'father' },
  '妈妈':   { r: 'person', mw: '个', g: 'f', pt: 'mãe', en: 'mother' },
  '哥哥':   { r: 'person count', mw: '个', g: 'm', pt: 'irmão mais velho', ptp: 'irmãos mais velhos', en: 'older brother',   enp: 'older brothers' },
  '弟弟':   { r: 'person count', mw: '个', g: 'm', pt: 'irmão mais novo',  ptp: 'irmãos mais novos',  en: 'younger brother', enp: 'younger brothers' },
  '姐姐':   { r: 'person count', mw: '个', g: 'f', pt: 'irmã mais velha',  ptp: 'irmãs mais velhas',  en: 'older sister',    enp: 'older sisters' },
  '妹妹':   { r: 'person count', mw: '个', g: 'f', pt: 'irmã mais nova',   ptp: 'irmãs mais novas',   en: 'younger sister',  enp: 'younger sisters' },
  '儿子':   { r: 'person count', mw: '个', g: 'm', pt: 'filho',  ptp: 'filhos',  en: 'son',      enp: 'sons' },
  '女儿':   { r: 'person count', mw: '个', g: 'f', pt: 'filha',  ptp: 'filhas',  en: 'daughter', enp: 'daughters' },
  '爷爷':   { r: 'person', mw: '个', g: 'm', pt: 'avô', en: 'grandfather' },
  '奶奶':   { r: 'person', mw: '个', g: 'f', pt: 'avó', en: 'grandmother' },
  '同学':   { r: 'person count', mw: '个', g: 'm', pt: 'colega', ptp: 'colegas', en: 'classmate', enp: 'classmates' },
  '老师':   { r: 'person count job', mw: '个', g: 'm', pt: 'professor', ptf: 'professora', ptp: 'professores', en: 'teacher', enp: 'teachers' },
  '朋友':   { r: 'person count', mw: '个', g: 'm', pt: 'amigo',  ptp: 'amigos',  en: 'friend',  enp: 'friends' },
  '学生':   { r: 'person count job', mw: '个', g: 'm', pt: 'aluno', ptf: 'aluna', ptp: 'alunos', en: 'student', enp: 'students' },

  /* ── Occupations ──────────────────────────────────────────────
     Used after 是 and 当, where Portuguese takes no article ("ele é
     médico") but agrees with the subject's gender — hence ptf.  The
     plurals and measure word are for the [NCAS] order, which counts
     them: 这间医院有三个好的医生. */
  '医生':   { r: 'job', mw: '个', g: 'm', pt: 'médico',   ptf: 'médica',   ptp: 'médicos',   en: 'doctor',   enp: 'doctors' },
  '商人':   { r: 'job', mw: '个', g: 'm', pt: 'vendedor', ptf: 'vendedora', ptp: 'vendedores', en: 'merchant', enp: 'merchants' },
  '职员':   { r: 'job', mw: '个', g: 'm', pt: 'escriturário', ptf: 'escriturária', ptp: 'escriturários', en: 'office worker', enp: 'office workers' },
  '律师':   { r: 'job', mw: '个', g: 'm', pt: 'advogado', ptf: 'advogada', ptp: 'advogados', en: 'lawyer', enp: 'lawyers' },
  '司机':   { r: 'job', mw: '个', g: 'm', pt: 'motorista', ptf: 'motorista', ptp: 'motoristas', en: 'driver', enp: 'drivers' },
  '工人':   { r: 'job', mw: '个', g: 'm', pt: 'trabalhador', ptf: 'trabalhadora', ptp: 'trabalhadores', en: 'worker', enp: 'workers' },
  '工程师': { r: 'job', mw: '个', g: 'm', pt: 'engenheiro', ptf: 'engenheira', ptp: 'engenheiros', en: 'engineer', enp: 'engineers' },

  /* ── Numbers ──────────────────────────────────────────────────
     二 is left out on purpose: it is how you *read* the digit, while
     counting things takes 两 — 两本书, never 二本书. */
  '一':  { r: 'num', v: 1, pt: 'um', ptf: 'uma', en: 'one' },
  '两':  { r: 'num', v: 2, pt: 'dois', ptf: 'duas', en: 'two' },
  '三':  { r: 'num', v: 3, pt: 'três',  en: 'three' },
  '四':  { r: 'num', v: 4, pt: 'quatro', en: 'four' },
  '五':  { r: 'num', v: 5, pt: 'cinco', en: 'five' },
  '六':  { r: 'num', v: 6, pt: 'seis',  en: 'six' },
  '七':  { r: 'num', v: 7, pt: 'sete',  en: 'seven' },
  '八':  { r: 'num', v: 8, pt: 'oito',  en: 'eight' },
  '九':  { r: 'num', v: 9, pt: 'nove',  en: 'nine' },
  '十':  { r: 'num', v: 10, pt: 'dez',  en: 'ten' },

  /* ── Measure words ────────────────────────────────────────── */
  '个': { r: 'mw' }, '本': { r: 'mw' }, '张': { r: 'mw' }, '只': { r: 'mw' },
  '支': { r: 'mw' }, '辆': { r: 'mw' }, '件': { r: 'mw' }, '台': { r: 'mw' },
  '间': { r: 'mw' },

  /* ── Objects ──────────────────────────────────────────────── */
  '书':     { r: 'thing count buyable usable', mw: '本', g: 'm', pt: 'livro',      ptp: 'livros',      en: 'book',       enp: 'books' },
  '字典':   { r: 'thing count buyable usable', mw: '本', g: 'm', pt: 'dicionário', ptp: 'dicionários', en: 'dictionary', enp: 'dictionaries' },
  '笔':     { r: 'thing count buyable usable', mw: '支', g: 'f', pt: 'caneta',     ptp: 'canetas',     en: 'pen',        enp: 'pens' },
  '电脑':   { r: 'thing count buyable usable', mw: '台', g: 'm', pt: 'computador', ptp: 'computadores', en: 'computer',  enp: 'computers' },
  '电视':   { r: 'thing count watchable',      mw: '台', g: 'f', pt: 'televisão',  ptp: 'televisões',  en: 'television', enp: 'televisions' },
  '手机':   { r: 'thing count buyable usable', mw: '台', g: 'm', pt: 'celular',    ptp: 'celulares',   en: 'mobile phone', enp: 'mobile phones' },
  '冰箱':   { r: 'thing count buyable',        mw: '台', g: 'f', pt: 'geladeira',  ptp: 'geladeiras',  en: 'fridge',     enp: 'fridges' },
  '洗衣机': { r: 'thing count buyable usable', mw: '台', g: 'f', pt: 'máquina de lavar', ptp: 'máquinas de lavar', en: 'washing machine', enp: 'washing machines' },
  '照相机': { r: 'thing count buyable usable', mw: '台', g: 'f', pt: 'câmera',     ptp: 'câmeras',     en: 'camera',     enp: 'cameras' },
  '车子':   { r: 'thing count buyable',        mw: '辆', g: 'm', pt: 'carro',      ptp: 'carros',      en: 'car',        enp: 'cars' },
  '床':     { r: 'thing count buyable',        mw: '张', g: 'f', pt: 'cama',       ptp: 'camas',       en: 'bed',        enp: 'beds' },
  '小狗':   { r: 'thing count buyable likeable', mw: '只', g: 'm', animal: true, pt: 'cachorrinho', ptp: 'cachorrinhos', en: 'puppy', enp: 'puppies' },
  '狗':     { r: 'thing count buyable likeable', mw: '只', g: 'm', animal: true, pt: 'cachorro', ptp: 'cachorros', en: 'dog', enp: 'dogs' },
  '猫':     { r: 'thing count buyable likeable', mw: '只', g: 'm', animal: true, pt: 'gato',     ptp: 'gatos',     en: 'cat', enp: 'cats' },
  /* Counted in "pieces", so kept out of the counting template.
     enPl: the English gloss is grammatically plural. */
  '衣服':   { r: 'thing buyable', mw: '件', g: 'f', pt: 'roupa', en: 'clothes',  ptMass: true, enPl: true },
  '裤子':   { r: 'thing buyable', mw: '件', g: 'f', pt: 'calça', en: 'trousers', enPl: true },
  /* Not `buyable`: 买东西 means "go shopping", not "buy a thing" */
  '东西':   { r: 'thing', mw: '个', g: 'f', pt: 'coisa', en: 'thing' },
  /* Mass / abstract nouns: never counted, never demonstrated with 这.
     足球 is the sport, not the ball, so it can't be bought. */
  '足球':   { r: 'watchable likeable', g: 'm', pt: 'futebol', en: 'football' },
  '水果':   { r: 'buyable likeable food', g: 'f', pt: 'fruta', ptp: 'frutas', en: 'fruit', enp: 'fruit',
              ptMass: true, enMass: true },
  /* Not `food`: water is 好喝, never 好吃 */
  '水':     { r: 'drinkable',         g: 'f', pt: 'água',    en: 'water', ptMass: true, enMass: true },
  '音乐':   { r: 'likeable',          g: 'f', pt: 'música',  en: 'music' },
  '中文':   { r: 'likeable language', g: 'm', pt: 'chinês',  en: 'Chinese' },

  /* ── Places ───────────────────────────────────────────────── */
  '学校':     { r: 'place work', mw: '间', g: 'f', pt: 'escola',      en: 'school' },
  '书店':     { r: 'place work', mw: '间', g: 'f', pt: 'livraria',    en: 'bookshop' },
  '餐厅':     { r: 'place work', mw: '间', g: 'm', pt: 'restaurante', en: 'restaurant' },
  '银行':     { r: 'place work', mw: '间', g: 'm', pt: 'banco',       en: 'bank' },
  '邮局':     { r: 'place work', mw: '间', g: 'm', pt: 'correio',     en: 'post office' },
  '医院':     { r: 'place work', mw: '间', g: 'm', pt: 'hospital',    en: 'hospital' },
  '商店':     { r: 'place work', mw: '间', g: 'f', pt: 'loja',        en: 'shop' },
  '公司':     { r: 'place work', mw: '间', g: 'f', pt: 'empresa',     en: 'company' },
  '办公室':   { r: 'place work', mw: '间', g: 'm', pt: 'escritório',  en: 'office' },
  '超市':     { r: 'place work', mw: '间', g: 'm', pt: 'supermercado', en: 'supermarket' },
  '厕所':     { r: 'place', mw: '间', g: 'm', pt: 'banheiro',    en: 'toilet' },
  '小学':     { r: 'place work', mw: '间', g: 'f', pt: 'escola primária',   en: 'primary school' },
  '中学':     { r: 'place work', mw: '间', g: 'f', pt: 'escola secundária', en: 'secondary school' },
  '百货公司': { r: 'place work', mw: '间', g: 'f', pt: 'loja de departamentos', en: 'department store' },
  '公园':     { r: 'place', g: 'm', pt: 'parque',           en: 'park' },
  '球场':     { r: 'place', g: 'f', pt: 'quadra',           en: 'sports court' },
  '市中心':   { r: 'place work', g: 'm', pt: 'centro da cidade', en: 'city centre' },
  /* No measure word: 一间市政府 is not something anyone says, and without
     one it can still be the landmark of 市政府附近的一间办公室. */
  '市政府':   { r: 'place work', g: 'f', pt: 'prefeitura', en: 'city hall' },

  /* ── Countries ────────────────────────────────────────────────
     nat/natEn state a nationality — 她是巴西人 is "ela é brasileira",
     which is why both Portuguese forms are here.  pt/en name the country
     itself, for 去过, and ptTo carries the preposition with it: Portuguese
     picks between ao/à/aos/a per country and no rule predicts it. */
  '巴西':         { r: 'country', cap: true, nat: ['brasileiro', 'brasileira'], natEn: 'Brazilian',
                ptTo: 'ao Brasil', pt: 'Brasil', en: 'Brazil' },
  '阿根廷':        { r: 'country', cap: true, nat: ['argentino', 'argentina'], natEn: 'Argentine',
                ptTo: 'à Argentina', pt: 'Argentina', en: 'Argentina' },
  '马来西亚':       { r: 'country', cap: true, nat: ['malaio', 'malaia'], natEn: 'Malaysian',
                ptTo: 'à Malásia', pt: 'Malásia', en: 'Malaysia' },
  '波兰':         { r: 'country', cap: true, nat: ['polonês', 'polonesa'], natEn: 'Polish',
                ptTo: 'à Polônia', pt: 'Polônia', en: 'Poland' },
  '加拿大':        { r: 'country', cap: true, nat: ['canadense', 'canadense'], natEn: 'Canadian',
                ptTo: 'ao Canadá', pt: 'Canadá', en: 'Canada' },
  '古巴':         { r: 'country', cap: true, nat: ['cubano', 'cubana'], natEn: 'Cuban',
                ptTo: 'a Cuba', pt: 'Cuba', en: 'Cuba' },
  '西班牙':        { r: 'country', cap: true, nat: ['espanhol', 'espanhola'], natEn: 'Spanish',
                ptTo: 'à Espanha', pt: 'Espanha', en: 'Spain' },
  '土耳其':        { r: 'country', cap: true, nat: ['turco', 'turca'], natEn: 'Turkish',
                ptTo: 'à Turquia', pt: 'Turquia', en: 'Turkey' },
  '意大利':        { r: 'country', cap: true, nat: ['italiano', 'italiana'], natEn: 'Italian',
                ptTo: 'à Itália', pt: 'Itália', en: 'Italy' },
  '新加坡':        { r: 'country', cap: true, nat: ['singapuriano', 'singapuriana'], natEn: 'Singaporean',
                ptTo: 'a Singapura', pt: 'Singapura', en: 'Singapore' },
  '葡萄牙':        { r: 'country', cap: true, nat: ['português', 'portuguesa'], natEn: 'Portuguese',
                ptTo: 'a Portugal', pt: 'Portugal', en: 'Portugal' },
  '澳大利亚':       { r: 'country', cap: true, nat: ['australiano', 'australiana'], natEn: 'Australian',
                ptTo: 'à Austrália', pt: 'Austrália', en: 'Australia' },
  '中国':         { r: 'country', cap: true, nat: ['chinês', 'chinesa'], natEn: 'Chinese',
                ptTo: 'à China', pt: 'China', en: 'China' },
  '英国':         { r: 'country', cap: true, nat: ['britânico', 'britânica'], natEn: 'British',
                ptTo: 'ao Reino Unido', pt: 'Reino Unido', en: 'the United Kingdom' },
  '俄罗斯':        { r: 'country', cap: true, nat: ['russo', 'russa'], natEn: 'Russian',
                ptTo: 'à Rússia', pt: 'Rússia', en: 'Russia' },
  '韩国':         { r: 'country', cap: true, nat: ['coreano', 'coreana'], natEn: 'Korean',
                ptTo: 'à Coreia', pt: 'Coreia', en: 'Korea' },
  '泰国':         { r: 'country', cap: true, nat: ['tailandês', 'tailandesa'], natEn: 'Thai',
                ptTo: 'à Tailândia', pt: 'Tailândia', en: 'Thailand' },
  '德国':         { r: 'country', cap: true, nat: ['alemão', 'alemã'], natEn: 'German',
                ptTo: 'à Alemanha', pt: 'Alemanha', en: 'Germany' },
  '美国':         { r: 'country', cap: true, nat: ['americano', 'americana'], natEn: 'American',
                ptTo: 'aos Estados Unidos', pt: 'Estados Unidos', en: 'the United States' },
  '法国':         { r: 'country', cap: true, nat: ['francês', 'francesa'], natEn: 'French',
                ptTo: 'à França', pt: 'França', en: 'France' },
  '南非':         { r: 'country', cap: true, nat: ['sul-africano', 'sul-africana'], natEn: 'South African',
                ptTo: 'à África do Sul', pt: 'África do Sul', en: 'South Africa' },
  '新西兰':        { r: 'country', cap: true, nat: ['neozelandês', 'neozelandesa'], natEn: 'New Zealander',
                ptTo: 'à Nova Zelândia', pt: 'Nova Zelândia', en: 'New Zealand' },
  '日本':         { r: 'country', cap: true, nat: ['japonês', 'japonesa'], natEn: 'Japanese',
                ptTo: 'ao Japão', pt: 'Japão', en: 'Japan' },
  '台湾':         { r: 'country', cap: true, nat: ['taiwanês', 'taiwanesa'], natEn: 'Taiwanese',
                ptTo: 'a Taiwan', pt: 'Taiwan', en: 'Taiwan' },

  /* ── Transitive verbs ─────────────────────────────────────────
     obj names the role its object must have — that pairing is what
     keeps the generator from producing 喝电脑.
     va = an *action*, so it can follow a modal or a time word.  The
     stative three (有 喜欢 爱) are deliberately left out of it: 明天
     他们爱小狗 and 他想喜欢中文 are not sentences anyone says. */
  '看':   { r: 'v va', obj: 'watchable', pt: 'ver',     en: 'watch', ptArt: '',    enArt: '' },
  '买':   { r: 'v va', obj: 'buyable',   pt: 'comprar', en: 'buy',   ptArt: 'a',   enArt: 'a' },
  '喝':   { r: 'v va', obj: 'drinkable', pt: 'beber',   en: 'drink', ptArt: '',    enArt: '' },
  '用':   { r: 'v va', obj: 'usable',    pt: 'usar',    en: 'use',   ptArt: 'the', enArt: 'the' },
  '说':   { r: 'v va', obj: 'language',  pt: 'falar',   en: 'speak', ptArt: '',    enArt: '' },
  '有':   { r: 'v', obj: 'count',    pt: 'ter',    en: 'have', ptArt: 'a',  enArt: 'a' },
  '喜欢': { r: 'v', obj: 'likeable', pt: 'gostar', en: 'like', ptArt: 'pl', enArt: 'pl', prep: 'de' },
  '爱':   { r: 'v', obj: 'likeable', pt: 'amar',   en: 'love', ptArt: 'pl', enArt: 'pl' },

  /* ── Intransitive verbs ───────────────────────────────────────
     vi2   = also makes sense after a place ("他在公司工作")
     skill = something 会 can mean "knows how to" */
  '睡觉': { r: 'vi vi2', pt: 'dormir',     en: 'sleep' },
  '开车': { r: 'vi skill', pt: 'dirigir',  en: 'drive' },
  '做饭': { r: 'vi skill', pt: 'cozinhar', en: 'cook' },
  '吃饭': { r: 'vi vi2', pt: 'comer',      en: 'eat' },
  '工作': { r: 'vi vi2', pt: 'trabalhar',  en: 'work' },
  '玩':   { r: 'vi vi2', pt: 'brincar',    en: 'play' },
  '学习': { r: 'vi vi2 v va', obj: 'language', pt: 'estudar', en: 'study', ptArt: '', enArt: '' },
  '上班': { r: 'vi', pt: 'ir',  ptTail: 'ao trabalho', en: 'go',   enTail: 'to work' },
  '上课': { r: 'vi vi2', pt: 'ter', ptTail: 'aula',    en: 'have', enTail: 'class' },

  /* ── Modal verbs ──────────────────────────────────────────────
     enMod: a true English modal — no -s, and no "to" before the verb.
     会 is not in the `modal` bucket: it means "knows how to", which
     only fits a skill, so it has templates of its own. */
  '会':   { r: '',      pt: 'saber' },
  '可以': { r: 'modal', pt: 'poder',  en: 'may',        enMod: true },
  '能':   { r: 'modal', pt: 'poder',  en: 'can',        enMod: true },
  '要':   { r: 'modal', pt: 'querer', en: 'want' },
  '想':   { r: 'modal', pt: 'querer', en: 'would like', enFix: true },

  /* ── Adjectives ───────────────────────────────────────────────
     adjT things · adjP people · adjF food.  Splitting them is what
     stops 水果很年轻.
     `op` is the adjective's opposite and `neg` marks the unflattering
     ones.  Both exist for the 但是 patterns: one clause has to contradict
     the other, so 很大但是很小 and 很好但是很新 both stay unbuilt. */
  '新':   { r: 'adjT', objOnly: true, op: '旧', pt: 'novo',  ptf: 'nova',  en: 'new' },
  '旧':   { r: 'adjT', objOnly: true, op: '新', neg: true, pt: 'velho', ptf: 'velha', en: 'old' },
  '贵':   { r: 'adjT adjF', op: '便宜', neg: true, pt: 'caro',   ptf: 'cara',   en: 'expensive' },
  '便宜': { r: 'adjT adjF', op: '贵',   pt: 'barato', ptf: 'barata', en: 'cheap' },
  '大':   { r: 'adjT', op: '小', pt: 'grande',  ptf: 'grande',  en: 'big' },
  '小':   { r: 'adjT', op: '大', neg: true, pt: 'pequeno', ptf: 'pequena', en: 'small' },
  '好看': { r: 'adjT adjP', pt: 'bonito', ptf: 'bonita', en: 'good-looking' },
  '好':   { r: 'adjT adjP adjF', op: '讨厌', pt: 'bom', ptf: 'boa', en: 'good' },
  '可爱': { r: 'adjP adjT', alive: true, op: '讨厌', pt: 'fofo', ptf: 'fofa', en: 'cute' },
  '老':   { r: 'adjP', op: '年轻', neg: true, pt: 'velho', ptf: 'velha', en: 'old' },
  '年轻': { r: 'adjP', op: '老',   pt: 'jovem', ptf: 'jovem', en: 'young' },
  '讨厌': { r: 'adjP', op: '可爱', neg: true, pt: 'chato', ptf: 'chata', en: 'annoying' },
  '好吃': { r: 'adjF', pt: 'gostoso', ptf: 'gostosa', en: 'tasty' },

  /* ── Time ─────────────────────────────────────────────────── */
  '今天': { r: 'time', pt: 'hoje',     en: 'today' },
  '明天': { r: 'time', pt: 'amanhã',   en: 'tomorrow' },
  '晚上': { r: 'time', pt: 'à noite',  en: 'in the evening' },
  '早上': { r: 'time', pt: 'de manhã', en: 'in the morning' },

  /* ── Grammar words used literally by the templates ──────────
     Listed so the scope check can see them; they carry no gloss of
     their own because the template supplies their translation. */
  '不': { r: '' }, '没': { r: '' }, '很': { r: '' }, '也': { r: '' },
  '是': { r: '' }, '在': { r: '' }, '去': { r: '' }, '这': { r: '' },
  '人': { r: '' }, '几': { r: '' }, '吗': { r: '' }, '叫': { r: '' },
  '什么': { r: '' }, '名字': { r: '' }, '怎么样': { r: '' }, '在哪里': { r: '' },
  '当': { r: '' }, '那': { r: '' }, '谁': { r: '' }, '附近': { r: '' },
  '过': { r: '' }, '但是': { r: '' }, '很多': { r: '' }, '非常': { r: '' },

  /* 的 is the one word here that is not a flashcard of its own — it only
     ever appears inside 我的, 你的.  The [NCAS] order needs it as a word,
     so it carries its own pinyin and is in scope in every deck. */
  '的': { r: '', py: 'de' },
};


/* ============================================================
   Phrase pieces bigger than one word
   ============================================================
   The two exam-2 word orders are each longer than a template can
   spell inline, and both show up in more than one sentence, so they
   are built here.  Each returns the Chinese as tokens plus the
   Portuguese and English of that fragment alone, for the template to
   drop into the sentence it is building.
   ============================================================ */

/* 我 or 我的妈妈 — either can head any of the patterns below.  Everything
   the two translations need in order to conjugate travels with it.
   `singular` drops 我们/你们/他们, for the sentences that end in a job:
   "nós trabalhamos como engenheiro" would need a plural of every
   occupation gloss, which is the same reason 是 uses pronS. */
function pickSubject(p, { singular = false } = {}) {
  const pron = p.pick(singular ? 'pronS' : 'pron');
  const ps = p.pick('poss'), pe = p.pick('person');

  const plain = pron && {
    z: [pron.z], pt: pron.pt, en: pron.en, n: pron.n, n3: pron.n3, f: !!pron.f,
  };
  const family = ps && pe && {
    z: [ps.z, pe.z], pt: ptPoss(ps, pe), en: `${ps.en} ${pe.en}`,
    n: '3sg', n3: true, f: pe.g === 'f',
  };

  if (plain && family) return listenRandom() < 0.5 ? plain : family;
  return plain || family || null;
}

/* 数 + 量 + 形容词 + 的 + 名词 — the [NCAS] order:
       两只可爱的猫 → "dois gatos fofos" · "two cute cats"
   Portuguese puts the adjective *after* the noun and agrees with it in
   gender and number, which is the whole point of drilling this one.
   Only nouns that can be counted in all three languages qualify — 衣服
   is 一件衣服 but "uma roupa" is not Portuguese, so it stays out.
   `num: false` drops the number, for 那个年轻的老师 after a demonstrative.
   `dem` marks the phrase as already following one, which is what makes
   一 disappear: 这只大的猫, never 这一只大的猫. */
function pickNcas(p, role, adjRole, { num = true, dem = false } = {}) {
  const o = p.pick(role), a = p.pick(adjRole);
  let n = num ? p.pick('num') : null;
  if (!o || !a || (num && !n) || !adjFits(a, o)) return null;
  if (!o.mw || !o.ptp || !o.enp) return null;
  const mw = p.word(o.mw), de = p.word('的');
  if (!mw || !de) return null;
  if (dem && n && n.v === 1) n = null;

  const one   = !n || n.v === 1;
  // "um/uma" and "dois/duas" agree with the noun; the rest don't
  const ptNum = n ? ((o.g === 'f' && n.ptf) ? n.ptf : n.pt) : '';
  const adj   = one ? ptAdj(a, o) : ptPlural(ptAdj(a, o));
  const head  = `${one ? o.pt : o.ptp} ${adj}`;        // "gatos fofos"
  const enHead = `${a.en} ${one ? o.en : o.enp}`;      // "cute cats"

  return {
    o, a, one, head, enHead,
    z:  n ? [n.z, mw.z, a.z, '的', o.z] : [mw.z, a.z, '的', o.z],
    pt: n ? `${ptNum} ${head}`   : head,
    en: n ? `${n.en} ${enHead}`  : enHead,
  };
}

/* The 在-phrase of [S + adv. de lugar + V + O].  Four shapes — the three
   built ones are what the listening drills actually say:

       在一间商店                   numa loja
       在一间小的商店               numa loja pequena
       在市中心的一间商店           numa loja no centro da cidade
       在市政府附近的一间办公室     num escritório perto da prefeitura

   The bare 在商店 is kept only as the fallback for a scope that cannot
   spell any of the others; otherwise it would crowd out the shapes worth
   practising, and 他在银行 already has templates of its own. */
function pickPlacePhrase(p, role = 'place') {
  const pl = p.pick(role);
  if (!pl) return null;
  const one = p.word('一'), mw = pl.mw ? p.word(pl.mw) : null, de = p.word('的');

  const shapes = [() => ({ z: [pl.z], pt: ptIn(pl), en: `at the ${pl.en}` })];

  if (one && mw) {
    shapes.push(() => ({
      z: [one.z, mw.z, pl.z], pt: ptInA(pl), en: `in ${enAn(pl.en)}`,
    }));

    if (de) {
      const a = p.pick('adjT');
      if (a && adjFits(a, pl)) shapes.push(() => ({
        z:  [one.z, mw.z, a.z, '的', pl.z],
        pt: `${ptInA(pl)} ${ptAdj(a, pl)}`,
        en: `in ${enAn(`${a.en} ${pl.en}`)}`,
      }));

      const centre = p.word('市中心');
      if (centre && centre.z !== pl.z) shapes.push(() => ({
        z:  [centre.z, '的', one.z, mw.z, pl.z],
        pt: `${ptInA(pl)} ${ptIn(centre)}`,
        en: `in ${enAn(pl.en)} in the ${centre.en}`,
      }));

      const near = p.word('附近'), landmark = p.pick('place');
      if (near && landmark && landmark.z !== pl.z) shapes.push(() => ({
        z:  [landmark.z, '附近', '的', one.z, mw.z, pl.z],
        pt: `${ptInA(pl)} ${ptNear(landmark)}`,
        en: `in ${enAn(pl.en)} near the ${landmark.en}`,
      }));
    }
  }

  const rich = shapes.slice(1);
  return pickRandom(rich.length ? rich : shapes)();
}


/* ============================================================
   The templates
   ============================================================
   needs  literal deck words the pattern itself uses; if any is out
          of scope the template is skipped
   make   returns { zh: [tokens], pt, en, q } or null when the words
          it wanted are not available in the current scope
   ============================================================ */
const LISTEN_TEMPLATES = [

  /* 我喝水 — subject · verb · object */
  { id: 'svo', needs: [], make(p) {
      const s = p.pick('pron'), v = p.pick('v');
      if (!s || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [s.z, v.z, o.z],
        pt: `${cap(s.pt)} ${ptVerb(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(s.en)} ${enVerb(v.en, s.n3)} ${enObj(v, o)}`,
      };
    } },

  /* 他不喝水 — 有 is excluded: it negates as 没有, never 不有 */
  { id: 'svo-neg', needs: ['不'], make(p) {
      const s = p.pick('pron'), v = p.pick('v');
      if (!s || !v || v.z === '有') return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [s.z, '不', v.z, o.z],
        pt: `${cap(s.pt)} não ${ptVerb(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(s.en)} ${enDo(s)} not ${v.en} ${enObj(v, o)}`,
      };
    } },

  /* 我也喜欢音乐 */
  { id: 'svo-also', needs: ['也'], make(p) {
      const s = p.pick('pron'), v = p.pick('v');
      if (!s || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [s.z, '也', v.z, o.z],
        pt: `${cap(s.pt)} também ${ptVerb(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(s.en)} also ${enVerb(v.en, s.n3)} ${enObj(v, o)}`,
      };
    } },

  /* 你喝水吗？ */
  { id: 'yesno', needs: ['吗'], make(p) {
      const s = p.pick('you'), v = p.pick('v');
      if (!s || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        q: true,
        zh: [s.z, v.z, o.z, '吗'],
        pt: `${cap(s.pt)} ${ptVerb(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}?`,
        en: `${cap(enDo(s))} ${s.en} ${v.en} ${enObj(v, o)}?`,
      };
    } },

  /* 我有三本书 */
  { id: 'have-count', needs: ['有'], make(p) {
      const s = p.pick('pron'), n = p.pick('num'), o = p.pick('count');
      if (!s || !n || !o) return null;
      const mw = p.word(o.mw);
      if (!mw) return null;
      const one = n.v === 1;
      // "um/uma" and "dois/duas" both agree with the noun; the rest don't
      const ptNum = (o.g === 'f' && n.ptf) ? n.ptf : n.pt;
      return {
        zh: [s.z, '有', n.z, mw.z, o.z],
        pt: `${cap(s.pt)} ${ptVerb('ter', s.n)} ${ptNum} ${one ? o.pt : o.ptp}`,
        en: `${cap(s.en)} ${enVerb('have', s.n3)} ${n.en} ${one ? o.en : o.enp}`,
      };
    } },

  /* 你有几本书？ */
  { id: 'how-many', needs: ['有', '几'], make(p) {
      const s = p.pick('you'), o = p.pick('count');
      if (!s || !o) return null;
      const mw = p.word(o.mw);
      if (!mw) return null;
      return {
        q: true,
        zh: [s.z, '有', '几', mw.z, o.z],
        pt: `${o.g === 'f' ? 'Quantas' : 'Quantos'} ${o.ptp} ${s.pt} ${ptVerb('ter', s.n)}?`,
        en: `How many ${o.enp} ${enDo(s)} ${s.en} have?`,
      };
    } },

  /* 我没有电脑 — countables only: "não tenho coisa" is not Portuguese */
  { id: 'have-not', needs: ['没', '有'], make(p) {
      const s = p.pick('pron'), o = p.pick('count');
      if (!s || !o) return null;
      return {
        zh: [s.z, '没', '有', o.z],
        pt: `${cap(s.pt)} não ${ptVerb('ter', s.n)} ${o.pt}`,
        en: `${cap(s.en)} ${enDo(s)} not have ${enA(o)}`,
      };
    } },

  /* ── [NCAS] número + classificador + adjetivo + 的 + substantivo ── */

  /* 我有两只可爱的猫 */
  { id: 'ncas-have', needs: ['有', '的'], make(p) {
      const s = pickSubject(p), np = pickNcas(p, 'thing', 'adjT');
      if (!s || !np) return null;
      return {
        zh: [...s.z, '有', ...np.z],
        pt: `${cap(s.pt)} ${ptVerb('ter', s.n)} ${np.pt}`,
        en: `${cap(s.en)} ${enVerb('have', s.n3)} ${np.en}`,
      };
    } },

  /* 我想买一台新的手机 */
  { id: 'ncas-buy', needs: ['买', '的'], make(p) {
      const s = p.pick('pron'), m = p.pick('modal'), np = pickNcas(p, 'buyable', 'adjT');
      if (!s || !m || !np) return null;
      return {
        zh: [s.z, m.z, '买', ...np.z],
        pt: `${cap(s.pt)} ${ptVerb(m.pt, s.n)} comprar ${np.pt}`,
        en: `${cap(s.en)} ${m.enMod || m.enFix ? m.en : enVerb(m.en, s.n3)} `
          + `${m.enMod ? '' : 'to '}buy ${np.en}`,
      };
    } },

  /* 医院有三个好的医生 — jobs only: a place has workers, not daughters,
     and only a place someone could work at */
  { id: 'ncas-place-has', needs: ['有', '的'], make(p) {
      const pl = p.pick('work'), np = pickNcas(p, 'job', 'adjP');
      if (!pl || !np) return null;
      return {
        zh: [pl.z, '有', ...np.z],
        pt: `${cap(ptThe(pl))} tem ${np.pt}`,
        en: `The ${pl.en} has ${np.en}`,
      };
    } },

  /* 那个年轻的老师是谁？ — the same order, counted by a demonstrative */
  { id: 'ncas-who', needs: ['那', '是', '谁', '的'], make(p) {
      const np = pickNcas(p, 'job', 'adjP', { num: false, dem: true });
      if (!np) return null;
      return {
        q: true,
        zh: ['那', ...np.z, '是', '谁'],
        pt: `Quem é ${np.o.g === 'f' ? 'aquela' : 'aquele'} ${np.head}?`,
        en: `Who is that ${np.enHead}?`,
      };
    } },

  /* 这三只可爱的猫叫什么名字？ — only animals get asked their name */
  { id: 'ncas-name', needs: ['这', '叫', '什么', '名字', '的'], make(p) {
      const np = pickNcas(p, 'likeable', 'adjT', { dem: true });
      if (!np || !np.o.animal) return null;
      const f = np.o.g === 'f';
      return {
        q: true,
        zh: ['这', ...np.z, '叫', '什么', '名字'],
        pt: np.one ? `Qual é o nome dest${f ? 'a' : 'e'} ${np.head}?`
                   : `Quais são os nomes dest${f ? 'as' : 'es'} ${np.pt}?`,
        en: np.one ? `What is this ${np.enHead}'s name?`
                   : `What are the names of these ${np.en}?`,
      };
    } },

  /* 这台电脑很贵 */
  { id: 'this-adj', needs: ['这', '很'], make(p) {
      const o = p.pick('thing'), a = p.pick('adjT');
      if (!o || !a || !adjFits(a, o)) return null;
      const mw = p.word(o.mw);
      if (!mw) return null;
      return {
        zh: ['这', mw.z, o.z, '很', a.z],
        pt: `${o.g === 'f' ? 'Esta' : 'Este'} ${o.pt} é muito ${ptAdj(a, o)}`,
        en: `${cap(enThis(o))} ${o.en} ${enIs(o)} very ${a.en}`,
      };
    } },

  /* 这台电脑怎么样？ */
  { id: 'how-about', needs: ['这', '怎么样'], make(p) {
      const o = p.pick('thing');
      if (!o) return null;
      const mw = p.word(o.mw);
      if (!mw) return null;
      return {
        q: true,
        zh: ['这', mw.z, o.z, '怎么样'],
        pt: `O que você acha ${o.g === 'f' ? 'desta' : 'deste'} ${o.pt}?`,
        en: `What do you think of ${enThis(o)} ${o.en}?`,
      };
    } },

  /* 我的手机很新 */
  { id: 'poss-thing-adj', needs: ['很'], make(p) {
      const ps = p.pick('poss'), o = p.pick('thing'), a = p.pick('adjT');
      if (!ps || !o || !a || !adjFits(a, o)) return null;
      return {
        zh: [ps.z, o.z, '很', a.z],
        pt: `${cap(ptPoss(ps, o))} é muito ${ptAdj(a, o)}`,
        en: `${cap(ps.en)} ${o.en} ${enIs(o)} very ${a.en}`,
      };
    } },

  /* 我的妈妈很年轻 */
  { id: 'poss-person-adj', needs: ['很'], make(p) {
      const ps = p.pick('poss'), o = p.pick('person'), a = p.pick('adjP');
      if (!ps || !o || !a) return null;
      return {
        zh: [ps.z, o.z, '很', a.z],
        pt: `${cap(ptPoss(ps, o))} é muito ${ptAdj(a, o)}`,
        en: `${cap(ps.en)} ${o.en} is very ${a.en}`,
      };
    } },

  /* 这个学生很好 */
  { id: 'this-person-adj', needs: ['这', '个', '很'], make(p) {
      const o = p.pick('person'), a = p.pick('adjP');
      if (!o || !a) return null;
      return {
        zh: ['这', '个', o.z, '很', a.z],
        pt: `${o.g === 'f' ? 'Esta' : 'Este'} ${o.pt} é muito ${ptAdj(a, o)}`,
        en: `This ${o.en} is very ${a.en}`,
      };
    } },

  /* 水果很好吃 */
  { id: 'food-adj', needs: ['很'], make(p) {
      const o = p.pick('food'), a = p.pick('adjF');
      if (!o || !a) return null;
      return {
        zh: [o.z, '很', a.z],
        pt: `${cap(ptThe(o))} é muito ${ptAdj(a, o)}`,
        en: `${cap(o.en)} is very ${a.en}`,
      };
    } },

  /* 我会开车 */
  { id: 'modal-vi', needs: [], make(p) {
      const s = p.pick('pron'), m = p.pick('modal'), v = p.pick('vi');
      if (!s || !m || !v) return null;
      return {
        zh: [s.z, m.z, v.z],
        pt: `${cap(s.pt)} ${ptVerb(m.pt, s.n)} ${v.pt}${ptTail(v)}`,
        en: `${cap(s.en)} ${m.enMod || m.enFix ? m.en : enVerb(m.en, s.n3)} `
          + `${m.enMod ? '' : 'to '}${v.en}${enTail(v)}`,
      };
    } },

  /* 我会开车 — 会 is "knows how to", so it only takes a skill */
  { id: 'can-skill', needs: ['会'], make(p) {
      const s = p.pick('pron'), v = p.pick('skill');
      if (!s || !v) return null;
      return {
        zh: [s.z, '会', v.z],
        pt: `${cap(s.pt)} ${ptVerb('saber', s.n)} ${v.pt}${ptTail(v)}`,
        en: `${cap(s.en)} can ${v.en}${enTail(v)}`,
      };
    } },

  /* 我会说中文 */
  { id: 'can-speak', needs: ['会', '说'], make(p) {
      const s = p.pick('pron'), l = p.pick('language');
      if (!s || !l) return null;
      return {
        zh: [s.z, '会', '说', l.z],
        pt: `${cap(s.pt)} ${ptVerb('saber', s.n)} falar ${l.pt}`,
        en: `${cap(s.en)} can speak ${l.en}`,
      };
    } },

  /* 我想买手机 */
  { id: 'modal-svo', needs: [], make(p) {
      const s = p.pick('pron'), m = p.pick('modal'), v = p.pick('va');
      if (!s || !m || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [s.z, m.z, v.z, o.z],
        pt: `${cap(s.pt)} ${ptVerb(m.pt, s.n)} ${v.pt}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(s.en)} ${m.enMod || m.enFix ? m.en : enVerb(m.en, s.n3)} `
          + `${m.enMod ? '' : 'to '}${v.en} ${enObj(v, o)}`,
      };
    } },

  /* 明天我工作 */
  { id: 'time-vi', needs: [], make(p) {
      const t = p.pick('time'), s = p.pick('pron'), v = p.pick('vi');
      if (!t || !s || !v) return null;
      return {
        zh: [t.z, s.z, v.z],
        pt: `${cap(t.pt)} ${s.pt} ${ptVerb(v.pt, s.n)}${ptTail(v)}`,
        en: `${cap(t.en)} ${s.en} ${enVerb(v.en, s.n3)}${enTail(v)}`,
      };
    } },

  /* 今天我看电视 */
  { id: 'time-svo', needs: [], make(p) {
      const t = p.pick('time'), s = p.pick('pron'), v = p.pick('va');
      if (!t || !s || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [t.z, s.z, v.z, o.z],
        pt: `${cap(t.pt)} ${s.pt} ${ptVerb(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(t.en)} ${s.en} ${enVerb(v.en, s.n3)} ${enObj(v, o)}`,
      };
    } },

  /* 我去学校 */
  { id: 'go-place', needs: ['去'], make(p) {
      const s = p.pick('pron'), pl = p.pick('place');
      if (!s || !pl) return null;
      return {
        zh: [s.z, '去', pl.z],
        pt: `${cap(s.pt)} ${ptVerb('ir', s.n)} ${ptTo(pl)}`,
        en: `${cap(s.en)} ${enVerb('go', s.n3)} to the ${pl.en}`,
      };
    } },

  /* 我要去学校 */
  { id: 'modal-go', needs: ['去'], make(p) {
      const s = p.pick('pron'), m = p.pick('modal'), pl = p.pick('place');
      if (!s || !m || !pl) return null;
      return {
        zh: [s.z, m.z, '去', pl.z],
        pt: `${cap(s.pt)} ${ptVerb(m.pt, s.n)} ir ${ptTo(pl)}`,
        en: `${cap(s.en)} ${m.enMod || m.enFix ? m.en : enVerb(m.en, s.n3)} `
          + `${m.enMod ? '' : 'to '}go to the ${pl.en}`,
      };
    } },

  /* ── 过: done at least once ──────────────────────────────────
     Chinese hangs one particle off the verb; Portuguese has to reach for
     "já" and the pretérito, English for the present perfect. */

  /* 我去过日本 */
  { id: 'been-to', needs: ['去', '过'], make(p) {
      const s = p.pick('pron'), c = p.pick('country');
      if (!s || !c) return null;
      return {
        zh: [s.z, '去', '过', c.z],
        pt: `${cap(s.pt)} já ${ptPast('ir', s.n)} ${c.ptTo}`,
        en: `${cap(s.en)} ${enHave(s)} been to ${c.en}`,
      };
    } },

  /* 我没去过日本 — 过 negates with 没, never 不 */
  { id: 'not-been-to', needs: ['没', '去', '过'], make(p) {
      const s = p.pick('pron'), c = p.pick('country');
      if (!s || !c) return null;
      return {
        zh: [s.z, '没', '去', '过', c.z],
        pt: `${cap(s.pt)} nunca ${ptPast('ir', s.n)} ${c.ptTo}`,
        en: `${cap(s.en)} ${enHave(s)} never been to ${c.en}`,
      };
    } },

  /* 你去过日本吗？ */
  { id: 'been-to-q', needs: ['去', '过', '吗'], make(p) {
      const s = p.pick('you'), c = p.pick('country');
      if (!s || !c) return null;
      return {
        q: true,
        zh: [s.z, '去', '过', c.z, '吗'],
        pt: `${cap(s.pt)} já ${ptPast('ir', s.n)} ${c.ptTo}?`,
        en: `${cap(enHave(s))} ${s.en} been to ${c.en}?`,
      };
    } },

  /* 我买过手机 */
  { id: 'done-before', needs: ['过'], make(p) {
      const s = p.pick('pron'), v = p.pick('va');
      if (!s || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [s.z, v.z, '过', o.z],
        pt: `${cap(s.pt)} já ${ptPast(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(s.en)} ${enHave(s)} ${enPart(v.en)} ${enObj(v, o)}`,
      };
    } },

  /* 我没喝过中国茶 — 没 + V + 过 */
  { id: 'not-done-before', needs: ['没', '过'], make(p) {
      const s = p.pick('pron'), v = p.pick('va');
      if (!s || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [s.z, '没', v.z, '过', o.z],
        pt: `${cap(s.pt)} nunca ${ptPast(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} ${ptObj(v, o)}`,
        en: `${cap(s.en)} ${enHave(s)} never ${enPart(v.en)} ${enObj(v, o)}`,
      };
    } },

  /* ── 很多 · 非常 ─────────────────────────────────────────────
     很多 counts without a measure word, and 非常 is the step above 很:
     "muito" for 很, "extremamente" for 非常, so the two are told apart
     in the translation the way they are told apart in the audio. */

  /* 爷爷有很多书 */
  { id: 'many-have', needs: ['有', '很多'], make(p) {
      const s = pickSubject(p), o = p.pick('count');
      if (!s || !o || !o.ptp || !o.enp) return null;
      return {
        zh: [...s.z, '有', '很多', o.z],
        pt: `${cap(s.pt)} ${ptVerb('ter', s.n)} muit${o.g === 'f' ? 'as' : 'os'} ${o.ptp}`,
        en: `${cap(s.en)} ${enVerb('have', s.n3)} many ${o.enp}`,
      };
    } },

  /* 医院有很多医生 */
  { id: 'many-place', needs: ['有', '很多'], make(p) {
      const pl = p.pick('work'), j = p.pick('job');
      if (!pl || !j || !j.ptp) return null;
      return {
        zh: [pl.z, '有', '很多', j.z],
        pt: `${cap(ptThe(pl))} tem muitos ${j.ptp}`,
        en: `The ${pl.en} has many ${j.enp}`,
      };
    } },

  /* 这台电脑非常贵 */
  { id: 'very-adj', needs: ['这', '非常'], make(p) {
      const o = p.pick('thing'), a = p.pick('adjT');
      if (!o || !a || !adjFits(a, o)) return null;
      const mw = p.word(o.mw);
      if (!mw) return null;
      return {
        zh: ['这', mw.z, o.z, '非常', a.z],
        pt: `${o.g === 'f' ? 'Esta' : 'Este'} ${o.pt} é extremamente ${ptAdj(a, o)}`,
        en: `${cap(enThis(o))} ${o.en} ${enIs(o)} extremely ${a.en}`,
      };
    } },

  /* 这间医院有很多非常好的医生 — both, in the order the recording says them */
  { id: 'many-very-job', needs: ['这', '有', '很多', '非常', '的'], make(p) {
      const pl = p.pick('work'), j = p.pick('job'), a = p.pick('adjP');
      if (!pl || !j || !a || !j.ptp || !pl.mw) return null;
      const mw = p.word(pl.mw);
      if (!mw) return null;
      return {
        zh: ['这', mw.z, pl.z, '有', '很多', '非常', a.z, '的', j.z],
        pt: `${pl.g === 'f' ? 'Esta' : 'Este'} ${pl.pt} tem muitos ${j.ptp} `
          + `extremamente ${ptPlural(ptAdj(a, j))}`,
        en: `${cap(enThis(pl))} ${pl.en} has many extremely ${a.en} ${j.enp}`,
      };
    } },

  /* ── 但是: two clauses ───────────────────────────────────────
     Kept to the short pairings — a second clause doubles the tiles, and
     the bank has to stay tappable on a phone. */

  /* 这件裤子很好看但是很贵 — 但是 wants a contrast, so one of the two has
     to be the unflattering one */
  { id: 'but-adj', needs: ['这', '很', '但是'], make(p) {
      const o = p.pick('thing'), a = p.pick('adjT'), b = p.pick('adjT');
      if (!o || !a || !b || a.z === b.z || a.op === b.z) return null;
      if (!a.neg === !b.neg) return null;
      if (!adjFits(a, o) || !adjFits(b, o)) return null;
      const mw = p.word(o.mw);
      if (!mw) return null;
      return {
        zh: ['这', mw.z, o.z, '很', a.z, '但是', '很', b.z],
        pt: `${o.g === 'f' ? 'Esta' : 'Este'} ${o.pt} é muito ${ptAdj(a, o)}, `
          + `mas é muito ${ptAdj(b, o)}`,
        en: `${cap(enThis(o))} ${o.en} ${enIs(o)} very ${a.en}, but very ${b.en}`,
      };
    } },

  /* 我去过中国但是没去过日本 */
  { id: 'but-been-to', needs: ['去', '过', '但是', '没'], make(p) {
      const s = p.pick('pron'), c1 = p.pick('country'), c2 = p.pick('country');
      if (!s || !c1 || !c2 || c1.z === c2.z) return null;
      return {
        zh: [s.z, '去', '过', c1.z, '但是', '没', '去', '过', c2.z],
        pt: `${cap(s.pt)} já ${ptPast('ir', s.n)} ${c1.ptTo}, `
          + `mas nunca ${ptPast('ir', s.n)} ${c2.ptTo}`,
        en: `${cap(s.en)} ${enHave(s)} been to ${c1.en}, `
          + `but ${enHave(s)} never been to ${c2.en}`,
      };
    } },

  /* 我有电脑但是没有手机 — things, not people: 有弟弟但是没有老师 pairs
     two nouns that were never a choice between each other */
  { id: 'but-have', needs: ['有', '没', '但是'], make(p) {
      const s = p.pick('pron'), o1 = p.pick('thing'), o2 = p.pick('thing');
      if (!s || !o1 || !o2 || o1.z === o2.z) return null;
      return {
        zh: [s.z, '有', o1.z, '但是', '没', '有', o2.z],
        pt: `${cap(s.pt)} ${ptVerb('ter', s.n)} ${ptA(o1)}, `
          + `mas não ${ptVerb('ter', s.n)} ${ptA(o2)}`,
        en: `${cap(s.en)} ${enVerb('have', s.n3)} ${enA(o1)}, `
          + `but ${enDo(s)} not have ${enA(o2)}`,
      };
    } },

  /* 他在银行 */
  { id: 'at-place', needs: ['在'], make(p) {
      const s = p.pick('pron'), pl = p.pick('place');
      if (!s || !pl) return null;
      return {
        zh: [s.z, '在', pl.z],
        pt: `${cap(s.pt)} ${ptVerb('estar', s.n)} ${ptIn(pl)}`,
        en: `${cap(s.en)} ${enBe(s)} at the ${pl.en}`,
      };
    } },

  /* 他在公司工作 */
  { id: 'at-place-vi', needs: ['在'], make(p) {
      const s = p.pick('pron'), pl = p.pick('place'), v = p.pick('vi2');
      if (!s || !pl || !v) return null;
      return {
        zh: [s.z, '在', pl.z, v.z],
        pt: `${cap(s.pt)} ${ptVerb(v.pt, s.n)}${ptTail(v)} ${ptIn(pl)}`,
        en: `${cap(s.en)} ${enVerb(v.en, s.n3)}${enTail(v)} at the ${pl.en}`,
      };
    } },

  /* ── [S + adv. de lugar + V + O] ─────────────────────────────
     Chinese settles the place before the verb; Portuguese and English
     put it at the end.  That swap is the pattern being drilled. */

  /* 我的妈妈在一间小的商店买她的衣服 */
  { id: 'place-svo', needs: ['在'], make(p) {
      const s = pickSubject(p), where = pickPlacePhrase(p, 'work'), v = p.pick('va');
      if (!s || !where || !v) return null;
      const o = p.pick(v.obj);
      if (!o) return null;
      return {
        zh: [...s.z, '在', ...where.z, v.z, o.z],
        pt: `${cap(s.pt)} ${ptVerb(v.pt, s.n)}${v.prep ? ' ' + v.prep : ''} `
          + `${ptObj(v, o)} ${where.pt}`,
        en: `${cap(s.en)} ${enVerb(v.en, s.n3)} ${enObj(v, o)} ${where.en}`,
      };
    } },

  /* 我的妈妈在市中心的一间商店工作 */
  { id: 'place-vi', needs: ['在'], make(p) {
      const s = pickSubject(p), where = pickPlacePhrase(p, 'work'), v = p.pick('vi2');
      if (!s || !where || !v) return null;
      return {
        zh: [...s.z, '在', ...where.z, v.z],
        pt: `${cap(s.pt)} ${ptVerb(v.pt, s.n)}${ptTail(v)} ${where.pt}`,
        en: `${cap(s.en)} ${enVerb(v.en, s.n3)}${enTail(v)} ${where.en}`,
      };
    } },

  /* 她在一间学校当老师 */
  { id: 'place-as-job', needs: ['在', '当'], make(p) {
      const s = pickSubject(p, { singular: true }),
            where = pickPlacePhrase(p, 'work'), j = p.pick('job');
      if (!s || !where || !j) return null;
      return {
        zh: [...s.z, '在', ...where.z, '当', j.z],
        pt: `${cap(s.pt)} ${ptVerb('trabalhar', s.n)} como ${s.f ? j.ptf : j.pt} ${where.pt}`,
        en: `${cap(s.en)} ${enVerb('work', s.n3)} as ${enA(j)} ${where.en}`,
      };
    } },

  /* 你的妈妈在哪里工作？ */
  { id: 'where-work', needs: ['在哪里'], make(p) {
      const ps = p.pick('poss2'), pe = p.pick('person'), v = p.pick('vi2');
      if (!ps || !pe || !v) return null;
      return {
        q: true,
        zh: [ps.z, pe.z, '在哪里', v.z],
        pt: `Onde ${ptPoss(ps, pe)} ${ptVerb(v.pt, '3sg')}${ptTail(v)}?`,
        en: `Where does ${ps.en} ${pe.en} ${v.en}${enTail(v)}?`,
      };
    } },

  /* 银行在哪里？ */
  { id: 'where', needs: ['在哪里'], make(p) {
      const pl = p.pick('place');
      if (!pl) return null;
      return {
        q: true,
        zh: [pl.z, '在哪里'],
        pt: `Onde fica ${ptThe(pl)}?`,
        en: `Where is the ${pl.en}?`,
      };
    } },

  /* 她是巴西人 */
  { id: 'nationality', needs: ['是', '人'], make(p) {
      const s = p.pick('pronS'), c = p.pick('country');
      if (!s || !c) return null;
      return {
        zh: [s.z, '是', c.z, '人'],
        pt: `${cap(s.pt)} ${ptVerb('ser', s.n)} ${c.nat[s.f ? 1 : 0]}`,
        en: `${cap(s.en)} ${enBe(s)} ${c.natEn}`,
      };
    } },

  /* 他是医生 — Portuguese takes no article after ser, English does */
  { id: 'job-is', needs: ['是'], make(p) {
      const s = p.pick('pronS'), j = p.pick('job');
      if (!s || !j) return null;
      return {
        zh: [s.z, '是', j.z],
        pt: `${cap(s.pt)} ${ptVerb('ser', s.n)} ${s.f ? j.ptf : j.pt}`,
        en: `${cap(s.en)} ${enBe(s)} ${enA(j)}`,
      };
    } },

  /* 我的妈妈是医生 — the occupation agrees with the person, not the owner */
  { id: 'job-poss', needs: ['是'], make(p) {
      const ps = p.pick('poss'), pe = p.pick('person'), j = p.pick('job');
      if (!ps || !pe || !j || pe.z === j.z) return null;   // not 我的老师是老师
      return {
        zh: [ps.z, pe.z, '是', j.z],
        pt: `${cap(ptPoss(ps, pe))} é ${pe.g === 'f' ? j.ptf : j.pt}`,
        en: `${cap(ps.en)} ${pe.en} is ${enA(j)}`,
      };
    } },

  /* 我想当医生 — 当 is "to work as" */
  { id: 'want-job', needs: ['想', '当'], make(p) {
      const s = p.pick('pronS'), j = p.pick('job');
      if (!s || !j) return null;
      return {
        zh: [s.z, '想', '当', j.z],
        pt: `${cap(s.pt)} ${ptVerb('querer', s.n)} ser ${s.f ? j.ptf : j.pt}`,
        en: `${cap(s.en)} would like to be ${enA(j)}`,
      };
    } },

  /* 医生在医院工作 — `work` places only, so nobody works in a 厕所 */
  { id: 'job-works', needs: ['在', '工作'], make(p) {
      const j = p.pick('job'), pl = p.pick('work');
      if (!j || !pl) return null;
      return {
        zh: [j.z, '在', pl.z, '工作'],
        pt: `${cap(ptThe(j))} ${ptVerb('trabalhar', '3sg')} ${ptIn(pl)}`,
        en: `The ${j.en} works at the ${pl.en}`,
      };
    } },

  /* 你的爸爸叫什么名字？ */
  { id: 'name', needs: ['叫', '什么', '名字'], make(p) {
      const ps = p.pick('poss2'), pe = p.pick('person');
      if (!ps || !pe) return null;
      return {
        q: true,
        zh: [ps.z, pe.z, '叫', '什么', '名字'],
        pt: `Como se chama ${ptPoss(ps, pe)}?`,
        en: `What is ${ps.en} ${pe.en}'s name?`,
      };
    } },
];


/* ============================================================
   Generator
   ============================================================ */

/* hanzi → { decks: Set, pinyin } , read straight from vocab.js so the
   scope filter and the pinyin never need maintaining here. */
let listenDeckIndex = null;

function listenIndex() {
  if (!listenDeckIndex) {
    listenDeckIndex = new Map();
    for (const [deck, cards] of Object.entries(FLASHCARD_DECKS)) {
      for (const card of cards) {
        const hit = listenDeckIndex.get(card.hanzi);
        if (hit) hit.decks.add(deck);
        else listenDeckIndex.set(card.hanzi, { decks: new Set([deck]), pinyin: card.pinyin });
      }
    }
  }
  return listenDeckIndex;
}

/* Which decks a scope may draw on, and which one it is *about*.

   Exam 1 stands alone.  Exam 2 does not: it is a list of countries,
   places, adjectives and appliances with no pronouns and barely a verb
   in it, so on its own it cannot make a sentence at all.  Its scope
   therefore borrows exam 1 for the grammar and then insists that every
   phrase contain at least one exam 2 word — which is what "practise
   exam 2" actually means. */
function listenScope(scope) {
  const all = Object.keys(FLASHCARD_DECKS);
  if (scope === 'both')   return { decks: all, focus: null };
  if (scope === 'prova1') return { decks: ['prova1'], focus: null };
  return { decks: all, focus: scope };
}

/* All the generator's randomness goes through here, so it can be pinned to
   a fixed sequence when the app measures the layout — see withSeededPhrases. */
let listenRandom = Math.random;

const pickRandom = arr => arr[Math.floor(listenRandom() * arr.length)];

/* Run `fn` with the phrase generator drawing from a fixed sequence.  The
   listening view sizes its slots by sampling real phrases, and that reserve
   has to come out the same on every load rather than being a few pixels
   different each time the page opens. */
function withSeededPhrases(seed, fn) {
  const previous = listenRandom;
  let s = seed >>> 0 || 1;
  listenRandom = () => {            // xorshift32 — small, fast, repeatable
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return (s % 100000) / 100000;
  };
  try { return fn(); } finally { listenRandom = previous; }
}

/* The words available in a given scope, bucketed by role.  Cached: the
   student changes scope rarely and generates phrases constantly. */
const listenPoolCache = new Map();

function listenPool(scope) {
  if (!listenPoolCache.has(scope)) {
    const { decks, focus } = listenScope(scope);
    const index = listenIndex();
    const words = new Map();   // hanzi → entry, decorated with z + pinyin
    const roles = new Map();   // role  → entry[]

    for (const [hanzi, spec] of Object.entries(LISTEN_WORDS)) {
      const found = index.get(hanzi);
      // Not in vocab.js, and no pinyin of its own to fall back on (的)
      if (!found && !spec.py) continue;
      if (found && !decks.some(d => found.decks.has(d))) continue;   // out of scope

      const word = { ...spec, z: hanzi, py: found ? found.pinyin : spec.py };
      words.set(hanzi, word);
      for (const role of spec.r.split(' ').filter(Boolean)) {
        if (!roles.has(role)) roles.set(role, []);
        roles.get(role).push(word);
      }
    }

    listenPoolCache.set(scope, {
      word: h => words.get(h) || null,
      pick: role => {
        const bucket = roles.get(role);
        return bucket && bucket.length ? pickRandom(bucket) : null;
      },
      all: [...words.values()],
      /* No focus deck ⇒ every phrase counts */
      onTopic: tokens => !focus || tokens.some(t => index.get(t)?.decks.has(focus)),
    });
  }
  return listenPoolCache.get(scope);
}

/* Pinyin for the whole phrase, stitched from the decks' own pinyin so it
   is there offline — pinyin-pro comes from a CDN and may not be. */
function listenPinyin(tokens, pool) {
  const parts = tokens.map(t => {
    const w  = pool.word(t);
    const py = (w?.py || t).trim();
    return w?.cap ? py : py.toLowerCase();
  });
  const joined = parts.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/* What a word sounds like, from the deck's own pinyin — no CDN needed.
   Tones are kept: 是 (shì) and 十 (shí) are different sounds and a
   listener can tell them apart. */
const soundOf = (word, hanzi) => (word?.py || hanzi).toLowerCase().replace(/\s+/g, '');

/* What a whole answer sounds like */
function listenSoundOf(tokens, scope) {
  const pool = listenPool(scope);
  return tokens.map(t => soundOf(pool.word(t), t)).join(' ');
}

/* A few plausible wrong words to sit alongside the right ones, so the
   tiles cannot be assembled by elimination alone.

   Homophones of the phrase's own words are excluded: 他 and 她 are both
   "tā", so offering both turns the drill into a coin toss that no amount
   of listening can win.

   `budget` is what is left of the tile row's width; decoys that would
   push it past its slot are passed over.  Two decoys are worth more than
   a tidy row, so if nothing fits, the shortest words are taken anyway. */
function listenDecoys(tokens, pool, count, budget) {
  const used   = new Set(tokens);
  const sounds = new Set(tokens.map(t => soundOf(pool.word(t), t)));
  const spare  = pool.all.filter(w =>
    !used.has(w.z) && w.r && !sounds.has(soundOf(w, w.z)));   // skip bare grammar words
  const out = [];
  let left = budget;

  while (out.length < count && spare.length) {
    let fits = spare.filter(w => w.z.length + 1 <= left);
    if (!fits.length) {
      if (out.length >= 2) break;
      const shortest = Math.min(...spare.map(w => w.z.length));
      fits = spare.filter(w => w.z.length === shortest);
    }
    const w = fits[Math.floor(listenRandom() * fits.length)];
    spare.splice(spare.indexOf(w), 1);
    out.push(w.z);
    left -= w.z.length + 1;
  }
  return out;
}

/* Two ceilings, both on the size of the tile row.

   The first is the drill's: the place adverbial can stack up — 你的朋友 ·
   在 · 百货公司 · 附近 · 的 · 一 · 间 · 餐厅 · 买 · 洗衣机 — and past about
   nine tiles it stops testing what was heard and starts testing how much
   of it can be held in mind while hunting through the bank.

   The second is the layout's.  The listening view reserves the tile rows
   a fixed height, found by sampling what this function produces (see
   lsWorstCase in app.js), and a sample can only discover a ceiling that
   phrases actually reach.  So the generator states one, in the width a
   wrapped row of tiles costs — one per hanzi plus one per tile.  Without
   it the occasional long phrase overflowed the slot it was given and the
   tiles below the fold were clipped: invisible, and untappable.

   Re-rolling costs nothing, so anything over either ceiling is simply
   built again. */
const LISTEN_MAX_TOKENS = 9;
const LISTEN_MAX_WIDTH  = 24;   // the phrase itself
const LISTEN_ROW_WIDTH  = 30;   // the phrase and its decoys together

const rowWidth = words => words.reduce((n, w) => n + w.length + 1, 0);

/* Build one phrase for the given scope.  `avoid` is the previous
   template id, so the same pattern doesn't come up twice in a row.
   Returns null only if the scope can't satisfy any template at all. */
function buildListeningPhrase(scope, avoid = null) {
  const pool = listenPool(scope);
  const usable = LISTEN_TEMPLATES.filter(t => t.needs.every(w => pool.word(w)));
  if (!usable.length) return null;

  const preferred = usable.length > 1 ? usable.filter(t => t.id !== avoid) : usable;

  for (let tries = 0; tries < 80; tries++) {
    const template = pickRandom(tries < 50 ? preferred : usable);
    const built = template.make(pool);
    if (!built) continue;

    const tokens = built.zh;
    const width  = rowWidth(tokens);
    if ((tokens.length > LISTEN_MAX_TOKENS || width > LISTEN_MAX_WIDTH) && tries < 70) continue;
    // A focused scope keeps re-rolling until the phrase is about its deck
    if (!pool.onTopic(tokens) && tries < 70) continue;
    return {
      id:      template.id,
      tokens,
      text:    tokens.join('') + (built.q ? '？' : '。'),
      pinyin:  listenPinyin(tokens, pool),
      pt:      built.pt,
      en:      built.en,
      decoys:  listenDecoys(tokens, pool, Math.min(3, Math.max(2, 8 - tokens.length)),
                            LISTEN_ROW_WIDTH - width),
    };
  }
  return null;
}
