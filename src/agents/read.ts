import { NUMBER_WORDS } from '../engine/docs.js';
import type { OpenedDoc } from '../engine/research.js';
import { EVENT_NAMES } from '../engine/world.js';

// A clerk's reading of documents: what each one says, parsed from its text
// alone. Keys are lower-case names; every note remembers its document.

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

export const key = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const NAME = "[A-Z][a-z]+ [A-Z][a-z]+";

export const emptyNotes = (): Notes => ({ eventYear: new Map(), ledger: new Map(), born: new Map(), mother: new Map(), married: new Map() });

function eventByWords(text: string): string | null {
  const k = key(text);
  const exact = EVENT_NAMES.find(([, name]) => k.includes(key(name)));
  if (exact) return exact[1];
  return null;
}

export function readDoc(d: OpenedDoc, notes: Notes = emptyNotes()): Notes {
  const set = <T>(m: Map<string, Note<T>>, k: string, value: T) => {
    if (!m.has(key(k))) m.set(key(k), { value, doc: d.id });
  };
  const lines = d.text.split('\n');
  const dated = d.title.match(/, (\d{4})$/);
  const docYear = dated ? Number(dated[1]) : null;

  if (d.title.startsWith('Wending Gazette') && docYear) {
    const heading = lines[0].toLowerCase();
    const ev = EVENT_NAMES.find(([id]) => heading.includes(id));
    if (ev) set(notes.eventYear, ev[1], docYear);
  }
  if (d.title.startsWith('Ledger of ')) {
    const prop = d.title.slice('Ledger of '.length);
    const entries: LedgerEntry[] = [];
    for (const line of lines) {
      let m = line.match(new RegExp(`^(\\d{4})\\. Entered in this ledger as held by (${NAME})\\.`));
      if (m) entries.push({ year: Number(m[1]), to: m[2] });
      m = line.match(new RegExp(`^(\\d{4})\\. Sold by ${NAME} to (${NAME}) for`));
      if (m) entries.push({ year: Number(m[1]), to: m[2] });
      m = line.match(new RegExp(`^(\\d{4})\\. Passed to (${NAME}) by inheritance`));
      if (m) entries.push({ year: Number(m[1]), to: m[2] });
    }
    set(notes.ledger, prop, entries);
  }
  for (const line of lines) {
    let m = line.match(new RegExp(`^(\\d{4})\\. (${NAME}), (?:daughter|son) of (${NAME}) and (${NAME})\\.`));
    if (m) {
      set(notes.born, m[2], Number(m[1]));
      set(notes.mother, m[2], m[4]);
      continue;
    }
    m = line.match(new RegExp(`^(\\d{4})\\. (${NAME}), aged (\\d+)\\.`));
    if (m) {
      set(notes.born, m[2], Number(m[1]) - Number(m[3]));
      continue;
    }
    m = line.match(new RegExp(`^(\\d{4})\\. (${NAME}) and (${NAME})\\.`));
    if (m) {
      set(notes.married, m[2], Number(m[1]));
      set(notes.married, m[3], Number(m[1]));
      continue;
    }
    if (docYear === null || !d.title.startsWith('Letter')) continue;
    m = line.match(new RegExp(`^(${NAME}) has had a (?:girl|boy), to be called (${NAME})\\.`));
    if (m) {
      set(notes.born, m[2], docYear);
      set(notes.mother, m[2], m[1]);
      continue;
    }
    m = line.match(new RegExp(`^(${NAME}) was wed to (${NAME}) this summer`));
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

/** "It is three years since the great flood" in a letter of 1861 means 1858. */
export function relativeYear(line: string, docYear: number): { event: string; year: number } | null {
  const tries: [RegExp, (m: RegExpMatchArray) => number][] = [
    [/^(.+) came this year/i, () => 0],
    [/^It is a year now since (.+?),/i, () => 1],
    [/^(.+) was the year before last/i, () => 2],
    [/^It is (\w+) years since (.+?),/i, (m) => NUMBER_WORDS.indexOf(m[1].toLowerCase())],
  ];
  for (const [re, ago] of tries) {
    const m = line.match(re);
    if (!m) continue;
    const k = ago(m);
    const event = eventByWords(m[m.length - 1]);
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
