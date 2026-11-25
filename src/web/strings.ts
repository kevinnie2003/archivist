import type { Lang } from '../i18n/lang.js';
import { spaceMixed } from '../i18n/spacing.js';
import type { ProblemCode } from '../engine/research.js';

/** Every word the interface shows, in English and Simplified Chinese. */
const EN = {
  docTitle: 'Archivist · the parish archive of Wending',
  brand: 'Archivist',
  brandSub: 'The parish archive of Wending, 1820 to 1895',
  langLabel: 'Language',
  langName: { en: 'English', zh: 'Chinese' } as Record<Lang, string>,

  gaugeQuestion: 'Question',
  gaugeActions: 'Actions left',
  gaugePoints: 'Points',
  qOf: (n: number, m: number) => `${n} of ${m}`,

  // The start page
  setupLabel: 'Reading room · open to visitors',
  setupTitle: 'Bring a question to the archive.',
  pitch:
    'Visitors bring the archivist questions about the village of Wending: who held the mill the year of the flood, how old someone was when the chapel burned. The answers are in the parish registers, the property ledgers, old letters and the gazette, but rarely in one place. A letter may only say "it is three years since the great flood". Search the catalogue, open what you need, and answer with your sources.',
  rulesTitle: 'How the archive works',
  rules: [
    'Each question gets 8 actions. A search or opening a document costs one. Answering is free.',
    'A search shows up to six documents with the line that matched best. A snippet is a clue, not a source: open the page to read and cite it.',
    'Right answer +10. Citing every fact the answer rests on +5 more. Each action left over +1. A wrong answer −3.',
    'A holder in a year is the last person the ledger names in or before that year. An age is that year minus the year of birth; for older folk, the burial year minus the age at burial.',
    'Document ids such as `ledger-mill` or `bap-1850` can be opened directly once you know them.',
  ],
  ticketTitle: "Reader's ticket",
  seedLabel: 'Archive no.',
  seedPh: 'any number, or leave blank',
  modeLegend: 'Purpose of visit',
  modePlay: 'Do the research',
  modePlaySub: 'Six questions, eight actions each. Cite what you read.',
  modeWatch: 'Watch the researcher',
  modeWatchSub: 'A researcher works the same questions, with its reasoning in the trail.',
  researcherLabel: 'Researcher',
  clerkBuiltIn: 'the clerk (built in)',
  continue: 'Continue the last visit',
  ticketFine: 'The archive is written in the language chosen at the top of the page, and stays in it for the whole visit.',

  // The reading room
  ledgerHead: 'Question ledger',
  pending: 'not yet asked',
  questionHead: 'Enquiry',
  answerLabel: 'Answer',
  answerPh: 'a name, or a number',
  citeLegend: 'Cite what the answer rests on',
  citeNone: 'Open a page to cite it.',
  answerBtn: 'Hand in the answer',
  step: 'Next step',
  auto: 'Research this question',
  nextQ: 'Next question',
  seeResults: 'See the results',
  quit: 'Leave the archive',
  notebook: 'Notebook',
  notesPh: 'Years, names, sums. Your notes stay across questions.',
  catalogueHead: 'Catalogue',
  queryPh: 'Search names, places, events…',
  searchBtn: 'Search',
  openPh: 'or open by id, e.g. ledger-mill',
  openBtn: 'Open',
  readerEmptyTitle: 'Reading desk',
  pageEmpty: 'Open a document to read it here.',
  searched: 'Searched',
  nothingFound: 'Nothing found.',
  hitOpen: 'Open',
  hitRead: 'Read',
  opened: 'Opened',
  trailEmptyPlay: 'Nothing searched yet. Start with the names and events in the question.',
  trailEmptyWatch: 'The researcher has not started.',
  busy: 'The researcher is reading…',
  meta: { series: 'Series', date: 'Date', call: 'Call no.', id: 'Id' },
  series: {
    bap: 'Parish register · baptisms',
    mar: 'Parish register · marriages',
    bur: 'Parish register · burials',
    ledger: 'Property ledger',
    letter: 'Letter',
    gazette: 'Gazette clipping',
  } as Record<string, string>,
  decade: (d: number) => `${d}–${d + 9}`,
  ledgerSpan: 'kept from 1840',
  stamp: { cited: 'Correct · cited', right: 'Correct · uncited', wrong: 'Incorrect' },
  verdictRight: 'Right',
  verdictWrong: 'Wrong',
  verdictLine: (right: boolean, answer: string, truth: string, points: number, cited: boolean, spare: number) =>
    `${answer}${right ? '' : `. The answer is ${truth}`}. ${points >= 0 ? '+' : ''}${points} points${cited ? ', sources cited' : ''}${spare ? `, ${spare} spare ${spare === 1 ? 'action' : 'actions'}` : ''}.`,
  notCited: (list: string) => `Not cited: ${list}.`,
  restsOn: (answer: string, list: string, clerkPoints: number, clerkUsed: number) => `${answer} rests on ${list}. The clerk scored ${clerkPoints} with ${clerkUsed} actions.`,
  citedLabel: 'Cited',
  listJoin: '; ',
  think: {
    search: (q: string) => `Search the catalogue for "${q}".`,
    open: (doc: string) => `Open ${doc} and read it through.`,
    answer: (a: string, cites: string) => `Answer ${a}, from ${cites}.`,
    out: (a: string) => `Out of leads: answer ${a}.`,
  },
  byClerk: 'clerk',
  byArchive: 'archive',
  byFallback: 'clerk (the model reply could not be used)',
  unreachable: (m: string) => `The model researcher is unreachable (${m}); the clerk takes over.`,

  // The results
  resultLabel: 'Visit closed',
  verdictTitle: (seed: number, you: boolean, right: number, n: number, total: number) =>
    `Archive ${seed}: ${you ? 'you' : 'the researcher'} answered ${right} of ${n} right, for ${total} points.`,
  finalStamp: (right: number, n: number) => `${right} of ${n} verified`,
  tally: { question: 'Question', you: 'You', researcher: 'The researcher', clerk: 'Clerk', skimmer: 'Skimmer', total: 'Total' },
  answerIs: (a: string) => `Answer: ${a}`,
  cell: (right: boolean, cited: boolean, used: number) => `${right ? 'right' : 'wrong'}${cited ? ', cited' : ''}, ${used} ${used === 1 ? 'action' : 'actions'}`,
  compare: (you: number, clerk: number) =>
    you > clerk ? 'You beat the clerk.' : you === clerk ? 'You tied with the clerk.' : `The clerk scores ${clerk - you} more. It never skips a source, but it searches for things you might open by id.`,
  again: 'Same archive again',
  next: 'A new archive',
  back: 'Back to the start',

  problem: {
    answered: () => 'this question is already answered',
    emptyAnswer: () => 'the answer is empty',
    closing: () => 'the reading room is closing: answer now',
    emptySearch: () => 'the search is empty',
    noDoc: (id: string) => `there is no document "${id}"`,
  } as Record<ProblemCode, (id: string) => string>,
  noVisit: 'no visit under way',
  watching: 'the researcher is at the desk',
  archiveIn: (archive: Lang, next: Lang) =>
    `This archive is written in ${archive === 'zh' ? 'Chinese' : 'English'} and stays that way for this visit. The next archive you open will be written in ${next === 'zh' ? 'Chinese' : 'English'}.`,
};

export type Strings = typeof EN;

const ZH: Strings = {
  docTitle: '档案员 · Wending 教区档案',
  brand: '档案员',
  brandSub: 'Wending 教区档案，1820 至 1895 年',
  langLabel: '语言',
  langName: { en: '英文', zh: '中文' },

  gaugeQuestion: '问题',
  gaugeActions: '剩余行动',
  gaugePoints: '得分',
  qOf: (n, m) => `${n} / ${m}`,

  setupLabel: '阅览室 · 对外开放',
  setupTitle: '带着问题来查档。',
  pitch:
    '来访者会向档案员打听 Wending 村的旧事：大水那年磨坊归谁，礼拜堂失火时某人几岁。答案都在教区登记簿、产业簿、旧信和公报里，却很少集中在一处。一封信也许只写着“大水已经过去三年了”。检索目录，调阅所需的文件，再附上出处作答。',
  rulesTitle: '档案馆的规矩',
  rules: [
    '每道题有 8 次行动。检索一次或调阅一份文件各算一次，作答不算。',
    '检索最多列出六份文件，并附上最贴合的一行。摘录只是线索，不算出处：要引用，须先调阅原件。',
    '答对 +10。答案所依据的事实全部有出处，再加 5 分。每剩一次行动 +1。答错 −3。',
    '某一年的产业持有人，是产业簿上那一年或之前最后登记的人。年龄是那一年减去出生年份；年长的村民没有洗礼记录，就用下葬年份减去享年。',
    '`ledger-mill`、`bap-1850` 这样的文件编号，知道以后可以直接调阅，省下一次检索。',
  ],
  ticketTitle: '阅览证',
  seedLabel: '档案编号',
  seedPh: '任意数字，留空则随机',
  modeLegend: '来访目的',
  modePlay: '亲自查档',
  modePlaySub: '六道题，每题八次行动。读过的才能引用。',
  modeWatch: '看研究员查档',
  modeWatchSub: '研究员做同样的题，每一步的考虑都记在查档记录里。',
  researcherLabel: '研究员',
  clerkBuiltIn: '书记员（内置）',
  continue: '继续上次的查档',
  ticketFine: '档案以页首选定的语言写成，整次查档期间不变。',

  ledgerHead: '问题登记',
  pending: '尚未提出',
  questionHead: '查询',
  answerLabel: '答案',
  answerPh: '人名或数字',
  citeLegend: '引用答案所依据的文件',
  citeNone: '调阅文件后才能引用。',
  answerBtn: '交上答案',
  step: '下一步',
  auto: '研究这道题',
  nextQ: '下一题',
  seeResults: '查看结果',
  quit: '离开档案馆',
  notebook: '笔记',
  notesPh: '年份、人名、算式。笔记在各题之间一直保留。',
  catalogueHead: '目录',
  queryPh: '检索人名、地点、事件……',
  searchBtn: '检索',
  openPh: '或按编号调阅，如 ledger-mill',
  openBtn: '调阅',
  readerEmptyTitle: '阅览桌',
  pageEmpty: '调阅的文件会摊开在这里。',
  searched: '检索',
  nothingFound: '没有找到。',
  hitOpen: '调阅',
  hitRead: '已读',
  opened: '已调阅',
  trailEmptyPlay: '还没有检索。先从题目里的人名和事件入手。',
  trailEmptyWatch: '研究员还没有开始。',
  busy: '研究员正在翻阅……',
  meta: { series: '类别', date: '年代', call: '索书号', id: '编号' },
  series: {
    bap: '教区登记簿 · 洗礼',
    mar: '教区登记簿 · 婚配',
    bur: '教区登记簿 · 下葬',
    ledger: '产业簿',
    letter: '信件',
    gazette: '公报剪报',
  },
  decade: (d) => `${d} 至 ${d + 9} 年`,
  ledgerSpan: '1840 年立簿',
  stamp: { cited: '已核实 · 有据', right: '已核实 · 缺出处', wrong: '有误' },
  verdictRight: '答对',
  verdictWrong: '答错',
  verdictLine: (right, answer, truth, points, cited, spare) =>
    `${answer}。${right ? '' : `正确答案是 ${truth}。`}${points >= 0 ? '+' : ''}${points} 分${cited ? '，出处齐全' : ''}${spare ? `，剩余 ${spare} 次行动` : ''}。`,
  notCited: (list) => `未引用：${list}。`,
  restsOn: (answer, list, clerkPoints, clerkUsed) => `${answer} 依据的是：${list}。书记员用 ${clerkUsed} 次行动得了 ${clerkPoints} 分。`,
  citedLabel: '所引',
  listJoin: '；',
  think: {
    search: (q) => `在目录里检索“${q}”。`,
    open: (doc) => `调阅 ${doc}，从头读一遍。`,
    answer: (a, cites) => `答 ${a}，依据 ${cites}。`,
    out: (a) => `线索用尽，只好答 ${a}。`,
  },
  byClerk: '书记员',
  byArchive: '档案馆',
  byFallback: '书记员（模型的回复无法采用）',
  unreachable: (m) => `连不上模型研究员（${m}），由书记员接手。`,

  resultLabel: '查档结束',
  verdictTitle: (seed, you, right, n, total) => `第 ${seed} 号档案：${you ? '你' : '研究员'}答对了 ${n} 题中的 ${right} 题，共得 ${total} 分。`,
  finalStamp: (right, n) => `核实 ${right} / ${n}`,
  tally: { question: '问题', you: '你', researcher: '研究员', clerk: '书记员', skimmer: '浏览者', total: '合计' },
  answerIs: (a) => `答案：${a}`,
  cell: (right, cited, used) => `${right ? '对' : '错'}${cited ? '，有据' : ''}，${used} 次行动`,
  compare: (you, clerk) =>
    you > clerk ? '你胜过了书记员。' : you === clerk ? '你和书记员打成平手。' : `书记员多得 ${clerk - you} 分。它从不漏掉出处，可有些文件你按编号就能直接调阅，它却还要去检索。`,
  again: '同一份档案再来一次',
  next: '换一份新档案',
  back: '回到开头',

  problem: {
    answered: () => '这道题已经答过了',
    emptyAnswer: () => '答案是空的',
    closing: () => '阅览室要关门了：请现在作答',
    emptySearch: () => '检索内容是空的',
    noDoc: (id) => `没有编号为“${id}”的文件`,
  },
  noVisit: '还没有开始查档',
  watching: '研究员正在用这张桌子',
  archiveIn: (archive, next) => `本档案以${archive === 'zh' ? '中文' : '英文'}写成，本次查档期间不变。下一份档案将以${next === 'zh' ? '中文' : '英文'}生成。`,
};

/** Applies Chinese spacing to every worded string, including the ones built from names. */
function spaced<T>(v: T): T {
  if (typeof v === 'string') return spaceMixed(v) as T;
  if (typeof v === 'function') return ((...args: unknown[]) => spaceMixed(String((v as (...a: unknown[]) => unknown)(...args)))) as T;
  if (Array.isArray(v)) return v.map(spaced) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, spaced(x)])) as T;
  return v;
}

const TABLE: Record<Lang, Strings> = { en: EN, zh: spaced(ZH) };

let current: Lang = 'en';

export function setUiLang(lang: Lang): void {
  current = lang;
}

export function uiLang(): Lang {
  return current;
}

/** The strings for the interface's current language. */
export function S(): Strings {
  return TABLE[current];
}

export function stringsFor(lang: Lang): Strings {
  return TABLE[lang];
}
