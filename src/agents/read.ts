import { EN, NUMBER_WORDS, NUMBER_WORDS_ZH, ZH } from '../engine/lexicon.js';
import type { OpenedDoc } from '../engine/research.js';

// A clerk's reading of documents: what each one says, parsed from its text
// alone, in English or in Chinese. Keys are lower-case names; every note
// remembers its document.

export interface Note<T> {
  value: T;
  doc: string;
}

export interface LedgerEntry {
  year: number;
  to: string;
}

export interface Notes {
  eventYear: Map<string, Note<number>>;
  ledger: Map<string, Note<LedgerEntry[]>>;
  born: Map<string, Note<number>>;
  mother: Map<string, Note<string>>;
  married: Map<string, Note<number>>;
}

/** A name or a phrase as a lookup key: lower case, Latin letters and Chinese characters only. */
export const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\u4e00-\u9fff ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const NAME = '[A-Z][a-z]+ [A-Z][a-z]+';

export const emptyNotes = (): Notes => ({ eventYear: new Map(), ledger: new Map(), born: new Map(), mother: new Map(), married: new Map() });

/** The kinds of document, told from their titles. */
export const isGazette = (title: string) => title.startsWith('Wending Gazette') || title.startsWith('Wending 公报');
export const isLetter = (title: string) => title.startsWith('Letter') || / 来信，/.test(title);
export const isLedger = (title: string) => title.startsWith('Ledger of ') || title.endsWith('产业簿');
export const isBaptisms = (title: string) => title.includes('baptisms') || title.includes('洗礼');
export const isBurials = (title: string) => title.includes('burials') || title.includes('下葬');
export const isMarriages = (title: string) => title.includes('marriages') || title.includes('婚配');

/** The year a letter or clipping was written, from its title: "…, 1861" or "…，1861 年". */
export const titleYear = (title: string): number | null => {
  const m = title.match(/(?:, |，)(\d{4})(?: ?年)?$/);
  return m ? Number(m[1]) : null;
};

const EVENT_IDS = Object.keys(EN.event);

/** The event a phrase names, in the words the archive uses for it. */
function eventByWords(text: string): string | null {
  const k = key(text);
  for (const L of [EN, ZH]) {
    const id = EVENT_IDS.find((e) => k.includes(key(L.event[e])));
    if (id) return L.event[id];
  }
  return null;
}

export function readDoc(d: OpenedDoc, notes: Notes = emptyNotes()): Notes {
  const set = <T>(m: Map<string, Note<T>>, k: string, value: T) => {
    if (!m.has(key(k))) m.set(key(k), { value, doc: d.id });
  };
  const lines = d.text.split('\n');
  const docYear = titleYear(d.title);

  if (isGazette(d.title) && docYear) {
    const heading = lines[0].toLowerCase();
    const en = EVENT_IDS.find((id) => heading.includes(id));
    const zh = EVENT_IDS.find((id) => heading.includes(ZH.event[id]));
    if (en) set(notes.eventYear, EN.event[en], docYear);
    else if (zh) set(notes.eventYear, ZH.event[zh], docYear);
  }
  if (isLedger(d.title)) {
    const prop = d.title.startsWith('Ledger of ') ? d.title.slice('Ledger of '.length) : d.title.slice(0, -'产业簿'.length);
    const entries: LedgerEntry[] = [];
    const forms = [
      new RegExp(`^(\\d{4})\\. Entered in this ledger as held by (${NAME})\\.`),
      new RegExp(`^(\\d{4})\\. Sold by ${NAME} to (${NAME}) for`),
      new RegExp(`^(\\d{4})\\. Passed to (${NAME}) by inheritance`),
      new RegExp(`^(\\d{4}) ?年。立簿，时为 ?(${NAME}) ?所有`),
      new RegExp(`^(\\d{4}) ?年。${NAME} ?以 ?\\d+ ?镑售予 ?(${NAME})`),
      new RegExp(`^(\\d{4}) ?年。${NAME} ?名下产业由 ?(${NAME}) ?继承`),
    ];
    for (const line of lines) {
      for (const re of forms) {
        const m = line.match(re);
        if (m) entries.push({ year: Number(m[1]), to: m[2] });
      }
    }
    set(notes.ledger, prop, entries);
  }
  for (const line of lines) {
    let m =
      line.match(new RegExp(`^(\\d{4})\\. (${NAME}), (?:daughter|son) of (${NAME}) and (${NAME})\\.`)) ??
      line.match(new RegExp(`^(\\d{4}) ?年。(${NAME})，系 ?(${NAME}) ?与 ?(${NAME}) ?之[女子]。`));
    if (m) {
      set(notes.born, m[2], Number(m[1]));
      set(notes.mother, m[2], m[4]);
      continue;
    }
    m = line.match(new RegExp(`^(\\d{4})\\. (${NAME}), aged (\\d+)\\.`)) ?? line.match(new RegExp(`^(\\d{4}) ?年。(${NAME})，享年 ?(\\d+) ?岁。`));
    if (m) {
      set(notes.born, m[2], Number(m[1]) - Number(m[3]));
      continue;
    }
    m = line.match(new RegExp(`^(\\d{4})\\. (${NAME}) and (${NAME})\\.`)) ?? line.match(new RegExp(`^(\\d{4}) ?年。(${NAME}) ?与 ?(${NAME}) ?成婚。`));
    if (m) {
      set(notes.married, m[2], Number(m[1]));
      set(notes.married, m[3], Number(m[1]));
      continue;
    }
    if (docYear === null || !isLetter(d.title)) continue;
    m = line.match(new RegExp(`^(${NAME}) has had a (?:girl|boy), to be called (${NAME})\\.`)) ?? line.match(new RegExp(`^(${NAME}) ?生了个(?:女儿|儿子)，取名 ?(${NAME})。`));
    if (m) {
      set(notes.born, m[2], docYear);
      set(notes.mother, m[2], m[1]);
      continue;
    }
    m = line.match(new RegExp(`^(${NAME}) was wed to (${NAME}) this summer`)) ?? line.match(new RegExp(`^(${NAME}) ?今夏嫁给了 ?(${NAME})`));
    if (m) {
      set(notes.married, m[1], docYear);
      set(notes.married, m[2], docYear);
      continue;
    }
    const rel = relativeYear(line, docYear);
    if (rel) set(notes.eventYear, rel.event, rel.year);
  }
  return notes;
}

/**
 * "It is three years since the great flood" in a letter of 1861 means 1858;
 * so does "大水已经过去三年了".
 */
export function relativeYear(line: string, docYear: number): { event: string; year: number } | null {
  // Each form: the pattern, how many years ago it means, and which group names the event.
  const tries: [RegExp, (m: RegExpMatchArray) => number, number][] = [
    [/^(.+) came this year/i, () => 0, 1],
    [/^It is a year now since (.+?),/i, () => 1, 1],
    [/^(.+) was the year before last/i, () => 2, 1],
    [/^It is (\w+) years since (.+?),/i, (m) => NUMBER_WORDS.indexOf(m[1].toLowerCase()), 2],
    [/^(.+?)就出在今年/, () => 0, 1],
    [/^(.+?)是前年的事/, () => 2, 1],
    [/^(.+?)已经过去([一两三四五六七八九])年了/, (m) => NUMBER_WORDS_ZH.indexOf(m[2]), 1],
  ];
  for (const [re, ago, group] of tries) {
    const m = line.match(re);
    if (!m) continue;
    const k = ago(m);
    const event = eventByWords(m[group]);
    if (k >= 0 && event) return { event, year: docYear - k };
  }
  return null;
}

export function readAll(docs: OpenedDoc[]): Notes {
  const notes = emptyNotes();
  for (const d of docs) readDoc(d, notes);
  return notes;
}

/** Who a ledger says held the property at the end of a year. */
export function holderFrom(entries: LedgerEntry[], year: number): string | null {
  let who: string | null = null;
  for (const e of entries) if (e.year <= year) who = e.to;
  return who;
}
