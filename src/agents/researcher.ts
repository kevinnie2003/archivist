import { hasCjk } from '../i18n/lang.js';
import type { Action, InquiryView, OpenedDoc } from '../engine/research.js';
import type { Hit } from '../engine/search.js';
import { holderFrom, isBaptisms, isBurials, isGazette, isLedger, isLetter, isMarriages, key, readAll, relativeYear, titleYear, type Notes } from './read.js';

// The built-in researchers. Neither sees the answer: they read the question,
// search, open documents and parse them, as a visitor would.

export type ResearcherKind = 'skimmer' | 'clerk';

export const RESEARCHERS: { kind: ResearcherKind; label: string; about: string }[] = [
  { kind: 'skimmer', label: 'Skimmer', about: 'One search, answers from the snippets, never opens a page' },
  { kind: 'clerk', label: 'Clerk', about: 'Plans what the answer needs, opens the right pages, does the sums' },
];

type Need =
  | { kind: 'event'; name: string }
  | { kind: 'ledger'; name: string }
  | { kind: 'born'; name: string }
  | { kind: 'married'; name: string; other: string }
  | { kind: 'mother'; name: string };

export type Plan =
  | { kind: 'eventYear'; event: string }
  | { kind: 'holderAtEvent'; property: string; event: string }
  | { kind: 'ageAtEvent'; person: string; event: string }
  | { kind: 'holderAtWedding'; property: string; bride: string; groom: string }
  | { kind: 'motherOfHolder'; property: string; event: string }
  | { kind: 'unknown' };

export function planFor(raw: string): Plan {
  const text = raw.trim();
  if (hasCjk(text)) return planForZh(text);
  let m = text.match(/^In what year was (.+)\?$/);
  if (m) return { kind: 'eventYear', event: m[1] };
  m = text.match(/^How old was (.+) in the year of (.+?)\?/);
  if (m) return { kind: 'ageAtEvent', person: m[1], event: m[2] };
  m = text.match(/^Who was the mother of whoever held (.+) in the year of (.+)\?$/);
  if (m) return { kind: 'motherOfHolder', property: m[1], event: m[2] };
  m = text.match(/^Who held (.+) in the year of (.+)\?$/);
  if (m) return { kind: 'holderAtEvent', property: m[1], event: m[2] };
  m = text.match(/^Who held (.+) in the year (.+) married (.+)\?$/);
  if (m) return { kind: 'holderAtWedding', property: m[1], bride: m[2], groom: m[3] };
  return { kind: 'unknown' };
}

/** The same questions as the archive asks them in Chinese. */
function planForZh(text: string): Plan {
  const t = (s: string) => s.trim();
  let m = text.match(/^(.+?)是在哪一年？$/);
  if (m) return { kind: 'eventYear', event: t(m[1]) };
  m = text.match(/^(.+?)那一年持有(.+?)的人，母亲是谁？$/);
  if (m) return { kind: 'motherOfHolder', property: t(m[2]), event: t(m[1]) };
  m = text.match(/^(.+) 与 (.+) 成婚那一年，(.+?)归谁所有？$/);
  if (m) return { kind: 'holderAtWedding', property: t(m[3]), bride: t(m[1]), groom: t(m[2]) };
  m = text.match(/^(.+?)那一年，(.+?)多少岁？/);
  if (m) return { kind: 'ageAtEvent', person: t(m[2]), event: t(m[1]) };
  m = text.match(/^(.+?)那一年，(.+?)归谁所有？$/);
  if (m) return { kind: 'holderAtEvent', property: t(m[2]), event: t(m[1]) };
  return { kind: 'unknown' };
}

const opened = (v: InquiryView): OpenedDoc[] => v.steps.filter((s) => s.doc).map((s) => s.doc!);

interface Working {
  missing: Need | null;
  answer: string | null;
  cite: string[];
}

/** What the plan still needs, or the answer and the documents it rests on. */
export function work(plan: Plan, notes: Notes): Working {
  const cite: string[] = [];
  const need = <T>(map: Map<string, { value: T; doc: string }>, name: string): T | null => {
    const n = map.get(key(name));
    if (!n) return null;
    cite.push(n.doc);
    return n.value;
  };
  const stop = (missing: Need): Working => ({ missing, answer: null, cite });
  const done = (answer: string): Working => ({ missing: null, answer, cite: [...new Set(cite)] });

  if (plan.kind === 'unknown') return { missing: null, answer: 'unknown', cite };
  if (plan.kind === 'holderAtWedding') {
    const year = need(notes.married, plan.bride) ?? need(notes.married, plan.groom);
    if (year === null) return stop({ kind: 'married', name: plan.bride, other: plan.groom });
    const ledger = need(notes.ledger, plan.property);
    if (!ledger) return stop({ kind: 'ledger', name: plan.property });
    return done(holderFrom(ledger, year) ?? 'nobody');
  }
  const year = need(notes.eventYear, plan.event);
  if (year === null) return stop({ kind: 'event', name: plan.event });
  if (plan.kind === 'eventYear') return done(String(year));
  if (plan.kind === 'ageAtEvent') {
    const born = need(notes.born, plan.person);
    if (born === null) return stop({ kind: 'born', name: plan.person });
    return done(String(year - born));
  }
  const ledger = need(notes.ledger, plan.property);
  if (!ledger) return stop({ kind: 'ledger', name: plan.property });
  const holder = holderFrom(ledger, year);
  if (!holder) return done('nobody');
  if (plan.kind === 'holderAtEvent') return done(holder);
  const mother = need(notes.mother, holder);
  if (mother === null) return stop({ kind: 'mother', name: holder });
  return done(mother);
}

const queries = (n: Need, zh: boolean): string[] => {
  if (zh) {
    if (n.kind === 'event') return [n.name, `${n.name} 公报 来信`];
    if (n.kind === 'ledger') return [`${n.name}产业簿`];
    if (n.kind === 'born') return [`${n.name} 洗礼`, `${n.name} 享年 下葬`, `${n.name} 取名`];
    if (n.kind === 'married') return [`${n.name} ${n.other} 成婚`, `${n.name} ${n.other} 婚配 来信`];
    return [`${n.name} 之子 之女 洗礼`, `${n.name} 取名`];
  }
  if (n.kind === 'event') return [n.name, `${n.name} gazette letter`];
  if (n.kind === 'ledger') return [`ledger of ${n.name}`];
  if (n.kind === 'born') return [`${n.name} baptisms`, `${n.name} aged burials`, `${n.name} to be called`];
  if (n.kind === 'married') return [`${n.name} ${n.other} marriages`, `${n.name} wed ${n.other}`];
  return [`${n.name} son daughter of baptisms`, `${n.name} to be called`];
};

/** Is this search hit worth opening for the need? */
function promising(n: Need, h: Hit): boolean {
  const s = key(`${h.title} ${h.snippet}`);
  const name = key(n.name);
  if (n.kind === 'event') return (isGazette(h.title) || isLetter(h.title)) && s.includes(name.split(' ').pop()!);
  if (n.kind === 'ledger') return isLedger(h.title);
  if (n.kind === 'married') return s.includes(name) && (isMarriages(h.title) || isLetter(h.title));
  return s.includes(name) && (isBaptisms(h.title) || isBurials(h.title) || isLetter(h.title));
}

/** Prefer pages whose snippet already reads like the fact wanted. */
function rank(n: Need, h: Hit): number {
  if (n.kind !== 'event') {
    const snip = key(h.snippet).replace(/^年 /, '');
    // A register line that begins with the name is about that person, not their child.
    if ((n.kind === 'born' || n.kind === 'mother') && snip.startsWith(key(n.name))) return 2;
    return snip.includes(key(n.name)) ? 1 : 0;
  }
  if (isGazette(h.title)) return 3;
  const year = titleYear(h.title);
  return year && relativeYear(h.snippet, year) ? 2 : 0;
}

/** A careful researcher: works out what the answer needs and fetches it. */
export function clerkAction(v: InquiryView): Action {
  const plan = planFor(v.question.text);
  const docs = opened(v);
  const w = work(plan, readAll(docs));
  if (!w.missing) return { kind: 'answer', answer: w.answer!, cite: w.cite };
  const guess = (): Action => ({ kind: 'answer', answer: v.question.answerType === 'number' ? '0' : 'unknown', cite: w.cite });
  if (v.used >= v.budget) return guess();
  const seen = new Set(docs.map((d) => d.id));
  const asked = new Set(v.steps.filter((s) => s.action.kind === 'search').map((s) => (s.action as { query: string }).query));
  const qs = queries(w.missing, hasCjk(v.question.text));
  // Open the most promising unread hit from searches made for this need.
  const hits = v.steps.flatMap((s) => (s.hits && s.action.kind === 'search' && qs.includes(s.action.query) ? s.hits : []));
  const fresh = hits.filter((h) => !seen.has(h.id) && promising(w.missing!, h));
  const hit = fresh.sort((a, b) => rank(w.missing!, b) - rank(w.missing!, a))[0];
  if (hit) return { kind: 'open', doc: hit.id };
  const next = qs.find((q) => !asked.has(q));
  return next ? { kind: 'search', query: next } : guess();
}

const NAME_RE = /[A-Z][a-z]+ (?:Hale|Marsh|Penrose|Quill|Rook|Tallow|Vane|Wren)\b/;

/** A hurried researcher: one search on the question, then an answer from the snippets. */
export function skimmerAction(v: InquiryView): Action {
  const first = v.steps.find((s) => s.hits);
  if (!first) return { kind: 'search', query: v.question.text };
  const hits = first.hits!;
  const top = hits.slice(0, 2).map((h) => h.id);
  for (const h of hits) {
    if (v.question.answerType === 'number') {
      const plan = planFor(v.question.text);
      const m = plan.kind === 'ageAtEvent' ? h.snippet.match(/(?:aged|享年) ?(\d+)/) : h.snippet.match(/\b(1[89]\d\d)\b/) ?? h.title.match(/\b(1[89]\d\d)\b/);
      if (m) return { kind: 'answer', answer: m[1], cite: top };
    } else {
      const ask = planFor(v.question.text);
      const exclude = ask.kind === 'holderAtWedding' ? [ask.bride, ask.groom] : [];
      const names = [...h.snippet.matchAll(new RegExp(NAME_RE, 'g'))].map((x) => x[0]).filter((n) => !exclude.includes(n));
      if (names.length) return { kind: 'answer', answer: names[names.length - 1], cite: top };
    }
  }
  return { kind: 'answer', answer: v.question.answerType === 'number' ? '40' : 'unknown', cite: top };
}

export function researcherAction(kind: ResearcherKind, v: InquiryView): Action {
  return kind === 'clerk' ? clerkAction(v) : skimmerAction(v);
}
