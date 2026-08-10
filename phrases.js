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

/* ── English: only the third person singular inflects ────────── */
const EN_3SG = { have: 'has', be: 'is', do: 'does', go: 'goes', study: 'studies' };

function enVerb(base, n3) {
  if (!n3) return base;
  if (EN_3SG[base]) return EN_3SG[base];
  if (/(s|sh|ch|x|z|o)$/.test(base)) return base + 'es';
  if (/[^aeiou]y$/.test(base))       return base.slice(0, -1) + 'ies';
  return base + 's';
}

const enBe = s => (s.n === '1sg' ? 'am' : s.n3 ? 'is' : 'are');
const enDo = s => (s.n3 ? 'does' : 'do');

/* ── Article helpers ───────────────────────────────────────── */
const cap   = s => s.charAt(0).toUpperCase() + s.slice(1);
const ptThe = w => (w.g === 'f' ? 'a '   : 'o '  ) + w.pt;   // o / a
const ptTo  = w => (w.g === 'f' ? 'à '   : 'ao ' ) + w.pt;   // a + o/a
const ptIn  = w => (w.g === 'f' ? 'na '  : 'no ' ) + w.pt;   // em + o/a

/* Mass nouns take no indefinite article: "compro roupa", not
   "compro uma roupa"; "buy fruit", not "buy a fruit". */
const ptA = w => (w.ptMass ? w.pt : (w.g === 'f' ? 'uma ' : 'um ') + w.pt);
const enA = w => (w.enMass || w.enPl ? w.en
                : (/^[aeiou]/i.test(w.en) ? 'an ' : 'a ') + w.en);   // an older brother

/* A few English glosses are grammatically plural ("clothes",
   "trousers") and drag the verb and the demonstrative with them. */
const enIs   = w => (w.enPl ? 'are'   : 'is');
const enThis = w => (w.enPl ? 'these' : 'this');

/* Adjectives agree with the noun they describe */
const ptAdj = (a, noun) => (noun.g === 'f' ? a.ptf : a.pt);

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
     médico") but agrees with the subject's gender — hence ptf. */
  '医生':   { r: 'job', g: 'm', pt: 'médico',   ptf: 'médica',   en: 'doctor' },
  '商人':   { r: 'job', g: 'm', pt: 'vendedor', ptf: 'vendedora', en: 'merchant' },
  '职员':   { r: 'job', g: 'm', pt: 'trabalhador de escritório', ptf: 'trabalhadora de escritório', en: 'office worker' },
  '律师':   { r: 'job', g: 'm', pt: 'advogado', ptf: 'advogada', en: 'lawyer' },
  '司机':   { r: 'job', g: 'm', pt: 'motorista', ptf: 'motorista', en: 'driver' },
  '工人':   { r: 'job', g: 'm', pt: 'trabalhador', ptf: 'trabalhadora', en: 'worker' },
  '工程师': { r: 'job', g: 'm', pt: 'engenheiro', ptf: 'engenheira', en: 'engineer' },

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

  /* ── Countries ────────────────────────────────────────────────
     Only ever used to state a nationality, which is why each carries
     both Portuguese forms — 她是巴西人 is "ela é brasileira". */
  '巴西':     { r: 'country', cap: true, nat: ['brasileiro', 'brasileira'],       natEn: 'Brazilian' },
  '阿根廷':   { r: 'country', cap: true, nat: ['argentino', 'argentina'],         natEn: 'Argentine' },
  '马来西亚': { r: 'country', cap: true, nat: ['malaio', 'malaia'],               natEn: 'Malaysian' },
  '波兰':     { r: 'country', cap: true, nat: ['polonês', 'polonesa'],            natEn: 'Polish' },
  '加拿大':   { r: 'country', cap: true, nat: ['canadense', 'canadense'],         natEn: 'Canadian' },
  '古巴':     { r: 'country', cap: true, nat: ['cubano', 'cubana'],               natEn: 'Cuban' },
  '西班牙':   { r: 'country', cap: true, nat: ['espanhol', 'espanhola'],          natEn: 'Spanish' },
  '土耳其':   { r: 'country', cap: true, nat: ['turco', 'turca'],                 natEn: 'Turkish' },
  '意大利':   { r: 'country', cap: true, nat: ['italiano', 'italiana'],           natEn: 'Italian' },
  '新加坡':   { r: 'country', cap: true, nat: ['singapuriano', 'singapuriana'],   natEn: 'Singaporean' },
  '葡萄牙':   { r: 'country', cap: true, nat: ['português', 'portuguesa'],        natEn: 'Portuguese' },
  '澳大利亚': { r: 'country', cap: true, nat: ['australiano', 'australiana'],     natEn: 'Australian' },
  '中国':     { r: 'country', cap: true, nat: ['chinês', 'chinesa'],              natEn: 'Chinese' },
  '英国':     { r: 'country', cap: true, nat: ['britânico', 'britânica'],         natEn: 'British' },
  '俄罗斯':   { r: 'country', cap: true, nat: ['russo', 'russa'],                 natEn: 'Russian' },
  '韩国':     { r: 'country', cap: true, nat: ['coreano', 'coreana'],             natEn: 'Korean' },
  '泰国':     { r: 'country', cap: true, nat: ['tailandês', 'tailandesa'],        natEn: 'Thai' },
  '德国':     { r: 'country', cap: true, nat: ['alemão', 'alemã'],                natEn: 'German' },
  '美国':     { r: 'country', cap: true, nat: ['americano', 'americana'],         natEn: 'American' },
  '法国':     { r: 'country', cap: true, nat: ['francês', 'francesa'],            natEn: 'French' },
  '南非':     { r: 'country', cap: true, nat: ['sul-africano', 'sul-africana'],   natEn: 'South African' },
  '新西兰':   { r: 'country', cap: true, nat: ['neozelandês', 'neozelandesa'],    natEn: 'New Zealander' },
  '日本':     { r: 'country', cap: true, nat: ['japonês', 'japonesa'],            natEn: 'Japanese' },
  '台湾':     { r: 'country', cap: true, nat: ['taiwanês', 'taiwanesa'],          natEn: 'Taiwanese' },

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
     stops 水果很年轻. */
  '新':   { r: 'adjT', objOnly: true, pt: 'novo',  ptf: 'nova',  en: 'new' },
  '旧':   { r: 'adjT', objOnly: true, pt: 'velho', ptf: 'velha', en: 'old' },
  '贵':   { r: 'adjT adjF', pt: 'caro',   ptf: 'cara',   en: 'expensive' },
  '便宜': { r: 'adjT adjF', pt: 'barato', ptf: 'barata', en: 'cheap' },
  '大':   { r: 'adjT', pt: 'grande',  ptf: 'grande',  en: 'big' },
  '小':   { r: 'adjT', pt: 'pequeno', ptf: 'pequena', en: 'small' },
  '好看': { r: 'adjT adjP', pt: 'bonito', ptf: 'bonita', en: 'good-looking' },
  '好':   { r: 'adjT adjP adjF', pt: 'bom', ptf: 'boa', en: 'good' },
  '可爱': { r: 'adjP adjT', alive: true, pt: 'fofo', ptf: 'fofa', en: 'cute' },
  '老':   { r: 'adjP', pt: 'velho',   ptf: 'velha',   en: 'old' },
  '年轻': { r: 'adjP', pt: 'jovem',   ptf: 'jovem',   en: 'young' },
  '讨厌': { r: 'adjP', pt: 'chato',   ptf: 'chata',   en: 'annoying' },
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
  '当': { r: '' },
};


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
      if (!found) continue;                                   // not in vocab.js
      if (!decks.some(d => found.decks.has(d))) continue;      // out of scope

      const word = { ...spec, z: hanzi, py: found.pinyin };
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
   of listening can win. */
function listenDecoys(tokens, pool, count) {
  const used   = new Set(tokens);
  const sounds = new Set(tokens.map(t => soundOf(pool.word(t), t)));
  const spare  = pool.all.filter(w =>
    !used.has(w.z) && w.r && !sounds.has(soundOf(w, w.z)));   // skip bare grammar words
  const out = [];
  while (out.length < count && spare.length) {
    const [w] = spare.splice(Math.floor(listenRandom() * spare.length), 1);
    out.push(w.z);
  }
  return out;
}

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
    // A focused scope keeps re-rolling until the phrase is about its deck
    if (!pool.onTopic(tokens) && tries < 70) continue;
    return {
      id:      template.id,
      tokens,
      text:    tokens.join('') + (built.q ? '？' : '。'),
      pinyin:  listenPinyin(tokens, pool),
      pt:      built.pt,
      en:      built.en,
      decoys:  listenDecoys(tokens, pool, Math.min(3, Math.max(2, 8 - tokens.length))),
    };
  }
  return null;
}
