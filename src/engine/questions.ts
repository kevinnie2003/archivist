import type { Lang } from '../i18n/lang.js';
import type { Archive, Doc } from './docs.js';
import { lexicon } from './lexicon.js';
import { Rng } from './rng.js';
import { fullName, holderIn, type Person } from './world.js';

// Questions a visitor brings to the archive. Each has one answer, worked out
// from the world, and the facts that answer rests on; a citation is good when
// it covers every one of those facts.

export type QuestionKind = 'eventYear' | 'holderAtEvent' | 'ageAtEvent' | 'holderAtWedding' | 'motherOfHolder';

export interface Question {
  id: number;
  kind: QuestionKind;
  text: string;
  answer: string;
  answerType: 'name' | 'number';
  /** Fact keys (see Doc.facts) the answer needs. */
  needs: string[];
  /** The language the question is written in, the archive's. */
  lang?: Lang;
}

export const BUDGET = 8;
export const POINTS = { right: 10, cited: 5, wrong: -3, sparePerAction: 1 };

export function makeQuestions(archive: Archive, count = 6, seed = archive.world.seed): Question[] {
  const w = archive.world;
  const rng = new Rng(seed * 69069 + 3);
  const P = (id: number) => w.people[id - 1];
  const alive = (p: Person, y: number) => p.born < y && (p.died === null || p.died >= y);
  const known = (key: string) => archive.docs.some((d) => d.facts.includes(key));
  const L = lexicon(archive.lang ?? 'en');
  const ev = (id: string) => L.event[id];
  const pr = (id: string) => L.property[id];

  // Each question also carries a key that names what it asks, whatever the
  // language, so the same seed asks the same questions in every language.
  type Made = Omit<Question, 'id'> & { key: string };
  const make: Record<QuestionKind, () => Made | null> = {
    eventYear: () => {
      const e = rng.pick(w.events);
      return { key: `eventYear:${e.id}`, kind: 'eventYear', text: L.question.eventYear(ev(e.id)), answer: String(e.year), answerType: 'number', needs: [`event:${e.id}`] };
    },
    holderAtEvent: () => {
      const e = rng.pick(w.events);
      const prop = rng.pick(w.properties);
      const who = holderIn(prop, e.year);
      if (!who || !alive(P(who), e.year)) return null;
      return { key: `holderAtEvent:${prop.id}:${e.id}`, kind: 'holderAtEvent', text: L.question.holderAtEvent(pr(prop.id), ev(e.id)), answer: fullName(P(who)), answerType: 'name', needs: [`event:${e.id}`, `ledger:${prop.id}`] };
    },
    ageAtEvent: () => {
      const e = rng.pick(w.events);
      const pool = w.people.filter((x) => alive(x, e.year) && known(`born:${x.id}`));
      if (!pool.length) return null;
      const p = rng.pick(pool);
      return {
        key: `ageAtEvent:${p.id}:${e.id}`,
        kind: 'ageAtEvent',
        text: L.question.ageAtEvent(fullName(p), ev(e.id)),
        answer: String(e.year - p.born),
        answerType: 'number',
        needs: [`event:${e.id}`, `born:${p.id}`],
      };
    },
    holderAtWedding: () => {
      const brides = w.people.filter((x) => x.sex === 'f' && x.married !== null && x.married >= 1840 && known(`married:${x.id}`));
      if (!brides.length) return null;
      const bride = rng.pick(brides);
      const prop = rng.pick(w.properties);
      const who = holderIn(prop, bride.married!);
      if (!who || !alive(P(who), bride.married!)) return null;
      return {
        key: `holderAtWedding:${prop.id}:${bride.id}`,
        kind: 'holderAtWedding',
        text: L.question.holderAtWedding(pr(prop.id), fullName(bride), fullName(P(bride.spouse!))),
        answer: fullName(P(who)),
        answerType: 'name',
        needs: [`married:${bride.id}`, `ledger:${prop.id}`],
      };
    },
    motherOfHolder: () => {
      const e = rng.pick(w.events);
      const prop = rng.pick(w.properties);
      const who = holderIn(prop, e.year);
      if (!who || !alive(P(who), e.year) || P(who).mother === null) return null;
      return {
        key: `motherOfHolder:${prop.id}:${e.id}`,
        kind: 'motherOfHolder',
        text: L.question.motherOfHolder(pr(prop.id), ev(e.id)),
        answer: fullName(P(P(who).mother!)),
        answerType: 'name',
        needs: [`event:${e.id}`, `ledger:${prop.id}`, `mother:${who}`],
      };
    },
  };

  const order: QuestionKind[] = ['eventYear', 'holderAtEvent', 'ageAtEvent', 'holderAtWedding', 'motherOfHolder'];
  const plan = [...order, ...Array.from({ length: Math.max(0, count - order.length) }, () => rng.pick(order.slice(1)))].slice(0, count);
  const out: Question[] = [];
  const seen = new Set<string>();
  const tryKind = (kind: QuestionKind): boolean => {
    for (let tries = 0; tries < 60; tries++) {
      const made = make[kind]();
      if (!made || seen.has(made.key) || seen.has(`${made.kind}:${made.answer}`)) continue;
      const { key, ...q } = made;
      seen.add(key);
      seen.add(`${q.kind}:${q.answer}`);
      out.push({ id: out.length + 1, ...q, lang: archive.lang ?? 'en' });
      return true;
    }
    return false;
  };
  for (const kind of plan) tryKind(kind);
  // A village that can't pose one kind of question gets another kind instead.
  for (let spare = 0; out.length < count && spare < 20; spare++) tryKind(rng.pick(order));
  // Ask the simple one last, so it does not give away a year the others need.
  return out.sort((a, b) => (a.kind === 'eventYear' ? 1 : 0) - (b.kind === 'eventYear' ? 1 : 0)).map((q, i) => ({ ...q, id: i + 1 }));
}

export const normaliseName = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\b(the|mrs|mr|miss|old|young)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function isRight(q: Question, answer: string): boolean {
  if (q.answerType === 'number') {
    // Digits in any width, with or without a unit: "1851", "1851年", "４２岁".
    const m = answer.normalize('NFKC').match(/-?\d+/);
    return !!m && Number(m[0]) === Number(q.answer);
  }
  const a = normaliseName(answer);
  const want = normaliseName(q.answer);
  return a === want || (a.includes(want) && a.split(' ').length <= want.split(' ').length + 2);
}

/** Which of the question's facts the cited documents cover. */
export function coverage(q: Question, cited: Doc[]): { covered: string[]; missing: string[] } {
  const covered = q.needs.filter((k) => cited.some((d) => d.facts.includes(k)));
  return { covered, missing: q.needs.filter((k) => !covered.includes(k)) };
}

export interface Grade {
  right: boolean;
  cited: boolean;
  missing: string[];
  spare: number;
  points: number;
}

export function grade(archive: Archive, q: Question, answer: string, cite: string[], actionsUsed: number): Grade {
  const right = isRight(q, answer);
  const docs = cite.map((id) => archive.docs.find((d) => d.id === id)).filter((d): d is Doc => !!d);
  const { missing } = coverage(q, docs);
  const cited = right && missing.length === 0;
  const spare = right ? Math.max(0, BUDGET - actionsUsed) : 0;
  const points = right ? POINTS.right + (cited ? POINTS.cited : 0) + spare * POINTS.sparePerAction : POINTS.wrong;
  return { right, cited, missing, spare, points };
}

/** A fact key in words, for result cards, in the archive's language unless asked for another. */
export function factWords(archive: Archive, key: string, lang: Lang = archive.lang ?? 'en'): string {
  const [kind, ref] = key.split(':');
  const L = lexicon(lang);
  const who = () => fullName(archive.world.people[Number(ref) - 1]);
  if (kind === 'event') return L.fact.event(L.event[ref]);
  if (kind === 'ledger') return L.fact.ledger(L.property[ref]);
  if (kind === 'born') return L.fact.born(who());
  if (kind === 'mother') return L.fact.mother(who());
  if (kind === 'married') return L.fact.married(who());
  return L.fact.died(who());
}
