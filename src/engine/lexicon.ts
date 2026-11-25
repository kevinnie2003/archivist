import type { Lang } from '../i18n/lang.js';
import { spaceMixed } from '../i18n/spacing.js';

// Every word the archive writes, in English and in Simplified Chinese. The
// generator draws the same facts whatever the language; only the wording
// comes from here. People and the village keep their Latin names in both.

export type RegisterKind = 'bap' | 'mar' | 'bur';
export type Sex = 'f' | 'm';

/** Someone a letter is addressed to, and whether they are older than the writer. */
export interface Addressee {
  given: string;
  sex: Sex;
  older: boolean;
}

export interface Lexicon {
  lang: Lang;
  property: Record<string, string>;
  event: Record<string, string>;
  registerTitle(kind: RegisterKind, decade: number): string;
  baptism(year: number, child: string, sex: Sex, father: string, mother: string): string;
  burial(year: number, who: string, age: number): string;
  marriage(year: number, groom: string, bride: string): string;
  ledgerTitle(property: string): string;
  ledgerFirst(year: number, to: string): string;
  ledgerSold(year: number, from: string, to: string, price: number): string;
  ledgerInherited(year: number, from: string, to: string): string;
  gazetteTitle(year: number): string;
  /** A property as the gazette names it, with whoever held it that year. */
  place(property: string, holder: string | null): string;
  gazette: Record<string, (place: (propertyId: string) => string) => string[]>;
  letterTitle(writer: string, year: number): string;
  letterHead(year: number): string;
  greeting(to: Addressee | null): string;
  signOff(writer: { given: string; sex: Sex }, to: Addressee | null): string;
  /** A letter's line that dates an event from the letter's own year: k years ago. */
  relative(k: number, event: string): string;
  /** Talk of an event already past, with no date. The same number in every language. */
  mentions: ((event: string) => string)[];
  noNews: string;
  birthNews(mother: string, sex: Sex, child: string): string;
  wedNews(bride: string, groom: string): string;
  burialNews(who: string): string;
  question: {
    eventYear(event: string): string;
    holderAtEvent(property: string, event: string): string;
    ageAtEvent(person: string, event: string): string;
    holderAtWedding(property: string, bride: string, groom: string): string;
    motherOfHolder(property: string, event: string): string;
  };
  fact: {
    event(event: string): string;
    ledger(property: string): string;
    born(who: string): string;
    mother(who: string): string;
    married(who: string): string;
    died(who: string): string;
  };
}

export const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const NUMBER_WORDS_ZH = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const EN: Lexicon = {
  lang: 'en',
  property: { mill: 'the mill', bell: 'the Bell inn', forge: 'the forge', acre: 'Long Acre', ferry: 'the ferry' },
  event: {
    flood: 'the great flood',
    fire: 'the chapel fire',
    cholera: 'the cholera summer',
    bridge: 'the opening of the new bridge',
    winter: 'the hard winter',
  },
  registerTitle: (kind, d) => `Parish register: ${{ bap: 'baptisms', mar: 'marriages', bur: 'burials' }[kind]}, ${d} to ${d + 9}`,
  baptism: (y, child, sex, father, mother) => `${y}. ${child}, ${sex === 'f' ? 'daughter' : 'son'} of ${father} and ${mother}.`,
  burial: (y, who, age) => `${y}. ${who}, aged ${age}.`,
  marriage: (y, a, b) => `${y}. ${a} and ${b}.`,
  ledgerTitle: (p) => `Ledger of ${p}`,
  ledgerFirst: (y, to) => `${y}. Entered in this ledger as held by ${to}.`,
  ledgerSold: (y, from, to, price) => `${y}. Sold by ${from} to ${to} for £${price}.`,
  ledgerInherited: (y, from, to) => `${y}. Passed to ${to} by inheritance from ${from}.`,
  gazetteTitle: (y) => `Wending Gazette, ${y}`,
  place: (p, holder) => (holder ? `${p} (then held by ${holder})` : p),
  gazette: {
    flood: (place) => [
      'THE GREAT FLOOD.',
      `The river broke its banks in the night and stood four feet deep in the lane by ${place('mill')}.`,
      'The lower fields were under water for nine days and the church bells were rung to wake the low houses.',
    ],
    fire: (place) => [
      'THE CHAPEL FIRE.',
      'Fire took the chapel roof on Sunday evening after the lamps were lit.',
      `The men of the village carried water from the pump at ${place('bell')} until the walls stood bare.`,
    ],
    cholera: (place) => [
      'THE CHOLERA SUMMER.',
      'The fever came up the river with the barges and the doctor from town would not stay the night.',
      `Water is now carried from the hill spring, and ${place('ferry')} has stopped taking strangers across.`,
    ],
    bridge: (place) => [
      'THE NEW BRIDGE OPENED.',
      'The new stone bridge was opened this week with a band and a cart of children across it first.',
      `It is said the trade at ${place('ferry')} will not survive it.`,
    ],
    winter: (place) => [
      'THE HARD WINTER.',
      'The frost held from Martinmas to March and the river froze from bank to bank.',
      `Flour was sold at the door of ${place('mill')} at twice the price of the autumn.`,
    ],
  },
  letterTitle: (w, y) => `Letter from ${w}, ${y}`,
  letterHead: (y) => `Wending, ${y}.`,
  greeting: (to) => (to ? `Dear ${to.sex === 'f' ? 'sister' : 'brother'} ${to.given},` : 'Dear cousin,'),
  signOff: (w) => `Your loving ${w.given}.`,
  relative: (k, event) => {
    if (k === 0) return `${cap(event)} came this year and we are not over it yet.`;
    if (k === 1) return `It is a year now since ${event}, and the talk of it has not stopped.`;
    if (k === 2) return `${cap(event)} was the year before last, and still people date everything by it.`;
    return `It is ${NUMBER_WORDS[k]} years since ${event}, though it feels nearer.`;
  },
  mentions: [
    (e) => `People still speak of ${e} as if it were last week.`,
    (e) => `Old folk here say nothing has been the same since ${e}.`,
    (e) => `Since ${e} the lane has never been mended properly.`,
  ],
  noNews: 'There is no news here worth the paper, only the weather and the price of coal.',
  birthNews: (mother, sex, child) => `${mother} has had a ${sex === 'f' ? 'girl' : 'boy'}, to be called ${child}.`,
  wedNews: (bride, groom) => `${bride} was wed to ${groom} this summer.`,
  burialNews: (who) => `We buried ${who} at Michaelmas.`,
  question: {
    eventYear: (e) => `In what year was ${e}?`,
    holderAtEvent: (p, e) => `Who held ${p} in the year of ${e}?`,
    ageAtEvent: (who, e) => `How old was ${who} in the year of ${e}? Count by years: that year minus the year of birth.`,
    holderAtWedding: (p, bride, groom) => `Who held ${p} in the year ${bride} married ${groom}?`,
    motherOfHolder: (p, e) => `Who was the mother of whoever held ${p} in the year of ${e}?`,
  },
  fact: {
    event: (e) => `the year of ${e}`,
    ledger: (p) => `who held ${p} and when`,
    born: (who) => `when ${who} was born`,
    mother: (who) => `who ${who}'s mother was`,
    married: (who) => `when ${who} married`,
    died: (who) => `when ${who} died`,
  },
};

const sibling = (sex: Sex, older: boolean) => (sex === 'f' ? (older ? '姐姐' : '妹妹') : older ? '哥哥' : '弟弟');
const selfAs = (sex: Sex, older: boolean) => (sex === 'f' ? (older ? '姐' : '妹') : older ? '兄' : '弟');

const ZH_RAW: Lexicon = {
  lang: 'zh',
  property: { mill: '磨坊', bell: '钟铃客栈', forge: '铁匠铺', acre: '长亩地', ferry: '渡口' },
  event: { flood: '大水', fire: '礼拜堂大火', cholera: '霍乱之夏', bridge: '新桥落成', winter: '严冬' },
  registerTitle: (kind, d) => `教区登记簿：${{ bap: '洗礼', mar: '婚配', bur: '下葬' }[kind]}，${d} 年至 ${d + 9} 年`,
  baptism: (y, child, sex, father, mother) => `${y} 年。${child}，系 ${father} 与 ${mother} 之${sex === 'f' ? '女' : '子'}。`,
  burial: (y, who, age) => `${y} 年。${who}，享年 ${age} 岁。`,
  marriage: (y, a, b) => `${y} 年。${a} 与 ${b} 成婚。`,
  ledgerTitle: (p) => `${p}产业簿`,
  ledgerFirst: (y, to) => `${y} 年。立簿，时为 ${to} 所有。`,
  ledgerSold: (y, from, to, price) => `${y} 年。${from} 以 ${price} 镑售予 ${to}。`,
  ledgerInherited: (y, from, to) => `${y} 年。${from} 名下产业由 ${to} 继承。`,
  gazetteTitle: (y) => `Wending 公报，${y} 年`,
  place: (p, holder) => (holder ? `${p}（时为 ${holder} 所有）` : p),
  gazette: {
    flood: (place) => [
      '本村遭大水。',
      `夜里河水决堤，${place('mill')}旁的小巷积水深达四尺。`,
      '低处的田地泡在水里整整九天，教堂敲钟，把地势低的人家叫醒。',
    ],
    fire: (place) => [
      '礼拜堂大火。',
      '礼拜日傍晚，刚点上灯，礼拜堂的屋顶便烧了起来。',
      `村里的男人从${place('bell')}的水泵处一桶桶提水，直到只剩下四面光墙。`,
    ],
    cholera: (place) => [
      '霍乱之夏。',
      '时疫随驳船沿河而上，城里来的医生不肯留下过夜。',
      `如今饮水改从山泉挑来，${place('ferry')}也不再渡外乡人过河。`,
    ],
    bridge: (place) => [
      '新桥落成。',
      '新石桥于本周启用，乐队奏乐，一车孩童头一个过了桥。',
      `据说${place('ferry')}的生意怕是撑不下去了。`,
    ],
    winter: (place) => [
      '严冬酷寒。',
      '霜冻从圣马丁节一直持续到三月，河面从这岸冻到那岸。',
      `${place('mill')}门口的面粉，卖到了秋天时的两倍价钱。`,
    ],
  },
  letterTitle: (w, y) => `${w} 来信，${y} 年`,
  letterHead: (y) => `Wending，${y} 年。`,
  greeting: (to) => (to ? `亲爱的${sibling(to.sex, to.older)} ${to.given}：` : '亲爱的表亲：'),
  signOff: (w, to) => (to ? `${selfAs(w.sex, !to.older)} ${w.given} 手书。` : `${w.given} 手书。`),
  relative: (k, event) => {
    if (k === 0) return `${event}就出在今年，大家至今还没缓过来。`;
    if (k === 1) return `${event}已经过去一年了，人们还在议论。`;
    if (k === 2) return `${event}是前年的事，如今大家记事还拿它作准。`;
    return `${event}已经过去${NUMBER_WORDS_ZH[k]}年了，却像是不久前的事。`;
  },
  mentions: [
    (e) => `人们说起${e}，还像是上礼拜的事。`,
    (e) => `村里的老人都说，自${e}以后，一切都变了样。`,
    (e) => `自${e}以来，那条小巷就再没好好修过。`,
  ],
  noNews: '此间无甚可写，不过天气与煤价而已。',
  birthNews: (mother, sex, child) => `${mother} 生了个${sex === 'f' ? '女儿' : '儿子'}，取名 ${child}。`,
  wedNews: (bride, groom) => `${bride} 今夏嫁给了 ${groom}。`,
  burialNews: (who) => `米迦勒节时，我们安葬了 ${who}。`,
  question: {
    eventYear: (e) => `${e}是在哪一年？`,
    holderAtEvent: (p, e) => `${e}那一年，${p}归谁所有？`,
    ageAtEvent: (who, e) => `${e}那一年，${who} 多少岁？按年份算：那一年减去出生那一年。`,
    holderAtWedding: (p, bride, groom) => `${bride} 与 ${groom} 成婚那一年，${p}归谁所有？`,
    motherOfHolder: (p, e) => `${e}那一年持有${p}的人，母亲是谁？`,
  },
  fact: {
    event: (e) => `${e}的年份`,
    ledger: (p) => `${p}的历任主人及年份`,
    born: (who) => `${who} 的出生年份`,
    mother: (who) => `${who} 的母亲是谁`,
    married: (who) => `${who} 的成婚年份`,
    died: (who) => `${who} 的下葬年份`,
  },
};

/** Applies Chinese spacing to every string the lexicon writes. */
function spaced<T>(v: T): T {
  if (typeof v === 'string') return spaceMixed(v) as T;
  if (typeof v === 'function') {
    const f = v as (...a: unknown[]) => unknown;
    return ((...args: unknown[]) => {
      const out = f(...args);
      return typeof out === 'string' ? spaceMixed(out) : Array.isArray(out) ? out.map((x) => (typeof x === 'string' ? spaceMixed(x) : x)) : out;
    }) as T;
  }
  if (Array.isArray(v)) return v.map(spaced) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, spaced(x)])) as T;
  return v;
}

export const ZH: Lexicon = { ...spaced(ZH_RAW), lang: 'zh' };

export const lexicon = (lang: Lang): Lexicon => (lang === 'zh' ? ZH : EN);
