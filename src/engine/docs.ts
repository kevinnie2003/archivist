import type { Lang } from '../i18n/lang.js';
import { lexicon, NUMBER_WORDS, type Lexicon } from './lexicon.js';
import { Rng } from './rng.js';
import { fullName, holderIn, type Person, type World } from './world.js';

export { NUMBER_WORDS };

// The archive: everything the village wrote down, rendered from the world.
// Each document records which facts it establishes, so a citation can be
// checked against the facts an answer rests on.

export type DocKind = 'register' | 'ledger' | 'letter' | 'gazette';

export interface Doc {
  id: string;
  kind: DocKind;
  title: string;
  /** The year written on the document, if it has one. */
  year: number | null;
  text: string;
  /**
   * Fact keys this document establishes:
   *   event:<id>  the year of an event      ledger:<property>  its full chain
   *   born:<id>   a person's birth year      mother:<id>        their mother
   *   married:<id> the year they married     died:<id>          the year they died
   */
  facts: string[];
}

export interface Archive {
  world: World;
  docs: Doc[];
  /** The language the archive is written in, fixed when it is made. */
  lang: Lang;
}

const decade = (y: number) => Math.floor(y / 10) * 10;

/** A property as the gazette names it in a year, with its holder then. */
function place(w: World, L: Lexicon, id: string, year: number): string {
  const p = w.properties.find((x) => x.id === id)!;
  const who = holderIn(p, year);
  return L.place(L.property[id], who ? fullName(w.people[who - 1]) : null);
}

/**
 * Writes the archive in a language. Every random draw is the same whatever
 * the language, so one seed gives the same documents, facts and answers in
 * English and in Chinese.
 */
export function makeArchive(world: World, lang: Lang = 'en'): Archive {
  const L = lexicon(lang);
  const rng = new Rng(world.seed * 40503 + 7);
  const docs: Doc[] = [];
  const P = (id: number) => world.people[id - 1];
  const name = (id: number) => fullName(P(id));

  // Parish registers, one page per decade for each kind of entry.
  const pages = new Map<string, { lines: [number, string][]; facts: string[] }>();
  const page = (kind: 'bap' | 'mar' | 'bur', year: number) => {
    const key = `${kind}-${decade(year)}`;
    if (!pages.has(key)) pages.set(key, { lines: [], facts: [] });
    return pages.get(key)!;
  };
  for (const p of world.people) {
    if (p.father !== null && p.mother !== null) {
      const pg = page('bap', p.born);
      pg.lines.push([p.born, L.baptism(p.born, fullName(p), p.sex, name(p.father), name(p.mother))]);
      pg.facts.push(`born:${p.id}`, `mother:${p.id}`);
    }
    if (p.died !== null) {
      const pg = page('bur', p.died);
      pg.lines.push([p.died, L.burial(p.died, fullName(p), p.died - p.born)]);
      pg.facts.push(`died:${p.id}`, `born:${p.id}`);
    }
    if (p.spouse !== null && p.married !== null && p.married >= 1820 && p.sex === 'm') {
      const pg = page('mar', p.married);
      pg.lines.push([p.married, L.marriage(p.married, fullName(p), name(p.spouse))]);
      pg.facts.push(`married:${p.id}`, `married:${p.spouse}`);
    }
  }
  for (const [key, pg] of [...pages].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [kind, d] = key.split('-');
    pg.lines.sort((a, b) => a[0] - b[0]);
    docs.push({
      id: key,
      kind: 'register',
      title: L.registerTitle(kind as 'bap', Number(d)),
      year: null,
      text: pg.lines.map(([, l]) => l).join('\n'),
      facts: [...new Set(pg.facts)],
    });
  }

  // A ledger for each property.
  for (const prop of world.properties) {
    const lines = prop.chain.map((t) => {
      if (t.how === 'first') return L.ledgerFirst(t.year, name(t.to));
      if (t.how === 'sold') return L.ledgerSold(t.year, name(t.from!), name(t.to), t.price!);
      return L.ledgerInherited(t.year, name(t.from!), name(t.to));
    });
    docs.push({ id: `ledger-${prop.id}`, kind: 'ledger', title: L.ledgerTitle(L.property[prop.id]), year: null, text: lines.join('\n'), facts: [`ledger:${prop.id}`] });
  }

  // Each event's year is written down once: in the gazette, or in a letter that dates it from its own year.
  const adults = (y: number) => world.people.filter((p) => p.born + 18 <= y && (p.died === null || p.died > y));
  let letters = 0;
  const letter = (writer: Person, year: number, body: string[], facts: string[]) => {
    const sib = siblingOf(world, writer, year);
    const to = sib ? { given: sib.given, sex: sib.sex, older: sib.born < writer.born } : null;
    docs.push({
      id: `letter-${++letters}`,
      kind: 'letter',
      title: L.letterTitle(fullName(writer), year),
      year,
      text: [L.letterHead(year), L.greeting(to), ...body, L.signOff(writer, to)].join('\n'),
      facts,
    });
  };
  for (const e of world.events) {
    const k = rng.int(5);
    if (rng.chance(0.5) || e.year + k > 1895 || !adults(e.year + k).length) {
      docs.push({ id: `gazette-${e.id}`, kind: 'gazette', title: L.gazetteTitle(e.year), year: e.year, text: L.gazette[e.id]((id) => place(world, L, id, e.year)).join('\n'), facts: [`event:${e.id}`] });
    } else {
      const y = e.year + k;
      const writer = rng.pick(adults(y));
      const { lines, facts } = news(world, L, rng, y, writer);
      letter(writer, y, [L.relative(k, L.event[e.id]), ...lines], [`event:${e.id}`, ...facts]);
    }
  }
  // More letters: family news, and undated talk of events already past.
  const busy = [...new Set(world.people.flatMap((p) => [p.born, p.married ?? 0, p.died ?? 0]))].filter((y) => y >= 1842 && y <= 1895);
  for (let i = 0; i < 10; i++) {
    const y = busy.length && rng.chance(0.75) ? rng.pick(busy) : 1842 + rng.int(53);
    const pool = adults(y);
    if (!pool.length) continue;
    const writer = rng.pick(pool);
    const { lines, facts } = news(world, L, rng, y, writer);
    const past = world.events.filter((e) => e.year < y);
    if (past.length && rng.chance(0.7)) lines.unshift(rng.pick(L.mentions)(L.event[rng.pick(past).id]));
    if (!lines.length) lines.push(L.noNews);
    letter(writer, y, lines, facts);
  }
  // Letters sit in the archive by date, not by when they were written up.
  const letterDocs = docs.filter((d) => d.kind === 'letter').sort((a, b) => a.year! - b.year!);
  letterDocs.forEach((d, i) => (d.id = `letter-${i + 1}`));
  return { world, docs: [...docs.filter((d) => d.kind !== 'letter'), ...letterDocs], lang };
}

/** Family news a writer could give in a given year, with the facts it establishes. */
function news(w: World, L: Lexicon, rng: Rng, year: number, writer: Person): { lines: string[]; facts: string[] } {
  const lines: string[] = [];
  const facts: string[] = [];
  const name = (id: number) => fullName(w.people[id - 1]);
  const born = w.people.filter((p) => p.born === year && p.mother !== null && p.id !== writer.id);
  const wed = w.people.filter((p) => p.married === year && p.sex === 'f' && p.spouse !== null && p.id !== writer.id);
  const buried = w.people.filter((p) => p.died === year && p.id !== writer.id);
  if (born.length && rng.chance(0.6)) {
    const b = rng.pick(born);
    lines.push(L.birthNews(name(b.mother!), b.sex, fullName(b)));
    facts.push(`born:${b.id}`, `mother:${b.id}`);
  }
  if (wed.length && rng.chance(0.7)) {
    const b = rng.pick(wed);
    lines.push(L.wedNews(fullName(b), name(b.spouse!)));
    facts.push(`married:${b.id}`, `married:${b.spouse}`);
  }
  if (buried.length && rng.chance(0.6)) {
    const b = rng.pick(buried);
    lines.push(L.burialNews(fullName(b)));
    facts.push(`died:${b.id}`);
  }
  return { lines, facts };
}

function siblingOf(w: World, p: Person, year: number): Person | undefined {
  if (p.father === null) return undefined;
  return w.people.find((q) => q.id !== p.id && q.father === p.father && (q.died === null || q.died > year));
}

export function docById(a: Archive, id: string): Doc | undefined {
  return a.docs.find((d) => d.id === id);
}
