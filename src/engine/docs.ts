import { Rng } from './rng.js';
import { fullName, holderIn, type Person, type World } from './world.js';

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
}

export const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const GAZETTE: Record<string, (w: World, year: number) => string[]> = {
  flood: (w, y) => [
    'THE GREAT FLOOD.',
    `The river broke its banks in the night and stood four feet deep in the lane by ${place(w, 'mill', y)}.`,
    'The lower fields were under water for nine days and the church bells were rung to wake the low houses.',
  ],
  fire: (w, y) => [
    'THE CHAPEL FIRE.',
    'Fire took the chapel roof on Sunday evening after the lamps were lit.',
    `The men of the village carried water from the pump at ${place(w, 'bell', y)} until the walls stood bare.`,
  ],
  cholera: (w, y) => [
    'THE CHOLERA SUMMER.',
    'The fever came up the river with the barges and the doctor from town would not stay the night.',
    `Water is now carried from the hill spring, and ${place(w, 'ferry', y)} has stopped taking strangers across.`,
  ],
  bridge: (w, y) => [
    'THE NEW BRIDGE OPENED.',
    'The new stone bridge was opened this week with a band and a cart of children across it first.',
    `It is said the trade at ${place(w, 'ferry', y)} will not survive it.`,
  ],
  winter: (w, y) => [
    'THE HARD WINTER.',
    'The frost held from Martinmas to March and the river froze from bank to bank.',
    `Flour was sold at the door of ${place(w, 'mill', y)} at twice the price of the autumn.`,
  ],
};

function place(w: World, id: string, year: number): string {
  const p = w.properties.find((x) => x.id === id)!;
  const who = holderIn(p, year);
  return who ? `${p.name} (then held by ${fullName(w.people[who - 1])})` : p.name;
}

const relative = (k: number, event: string): string => {
  if (k === 0) return `${cap(event)} came this year and we are not over it yet.`;
  if (k === 1) return `It is a year now since ${event}, and the talk of it has not stopped.`;
  if (k === 2) return `${cap(event)} was the year before last, and still people date everything by it.`;
  return `It is ${NUMBER_WORDS[k]} years since ${event}, though it feels nearer.`;
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const decade = (y: number) => Math.floor(y / 10) * 10;

export function makeArchive(world: World): Archive {
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
      pg.lines.push([p.born, `${p.born}. ${fullName(p)}, ${p.sex === 'f' ? 'daughter' : 'son'} of ${name(p.father)} and ${name(p.mother)}.`]);
      pg.facts.push(`born:${p.id}`, `mother:${p.id}`);
    }
    if (p.died !== null) {
      const pg = page('bur', p.died);
      pg.lines.push([p.died, `${p.died}. ${fullName(p)}, aged ${p.died - p.born}.`]);
      pg.facts.push(`died:${p.id}`, `born:${p.id}`);
    }
    if (p.spouse !== null && p.married !== null && p.married >= 1820 && p.sex === 'm') {
      const pg = page('mar', p.married);
      pg.lines.push([p.married, `${p.married}. ${fullName(p)} and ${name(p.spouse)}.`]);
      pg.facts.push(`married:${p.id}`, `married:${p.spouse}`);
    }
  }
  const KIND_TITLE = { bap: 'baptisms', mar: 'marriages', bur: 'burials' } as const;
  for (const [key, pg] of [...pages].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [kind, d] = key.split('-');
    pg.lines.sort((a, b) => a[0] - b[0]);
    docs.push({
      id: key,
      kind: 'register',
      title: `Parish register: ${KIND_TITLE[kind as 'bap']}, ${d} to ${Number(d) + 9}`,
      year: null,
      text: pg.lines.map(([, l]) => l).join('\n'),
      facts: [...new Set(pg.facts)],
    });
  }

  // A ledger for each property.
  for (const prop of world.properties) {
    const lines = prop.chain.map((t) => {
      if (t.how === 'first') return `${t.year}. Entered in this ledger as held by ${name(t.to)}.`;
      if (t.how === 'sold') return `${t.year}. Sold by ${name(t.from!)} to ${name(t.to)} for £${t.price}.`;
      return `${t.year}. Passed to ${name(t.to)} by inheritance from ${name(t.from!)}.`;
    });
    docs.push({ id: `ledger-${prop.id}`, kind: 'ledger', title: `Ledger of ${prop.name}`, year: null, text: lines.join('\n'), facts: [`ledger:${prop.id}`] });
  }

  // Each event's year is written down once: in the gazette, or in a letter that dates it from its own year.
  const adults = (y: number) => world.people.filter((p) => p.born + 18 <= y && (p.died === null || p.died > y));
  let letters = 0;
  const letter = (writer: Person, year: number, body: string[], facts: string[]) => {
    const to = siblingOf(world, writer, year);
    docs.push({
      id: `letter-${++letters}`,
      kind: 'letter',
      title: `Letter from ${fullName(writer)}, ${year}`,
      year,
      text: [`Wending, ${year}.`, to ? `Dear ${to.sex === 'f' ? 'sister' : 'brother'} ${to.given},` : 'Dear cousin,', ...body, `Your loving ${writer.given}.`].join('\n'),
      facts,
    });
  };
  for (const e of world.events) {
    const k = rng.int(5);
    if (rng.chance(0.5) || e.year + k > 1895 || !adults(e.year + k).length) {
      docs.push({ id: `gazette-${e.id}`, kind: 'gazette', title: `Wending Gazette, ${e.year}`, year: e.year, text: GAZETTE[e.id](world, e.year).join('\n'), facts: [`event:${e.id}`] });
    } else {
      const y = e.year + k;
      const writer = rng.pick(adults(y));
      const { lines, facts } = news(world, rng, y, writer);
      letter(writer, y, [relative(k, e.name), ...lines], [`event:${e.id}`, ...facts]);
    }
  }
  // More letters: family news, and undated talk of events already past.
  const busy = [...new Set(world.people.flatMap((p) => [p.born, p.married ?? 0, p.died ?? 0]))].filter((y) => y >= 1842 && y <= 1895);
  for (let i = 0; i < 10; i++) {
    const y = busy.length && rng.chance(0.75) ? rng.pick(busy) : 1842 + rng.int(53);
    const pool = adults(y);
    if (!pool.length) continue;
    const writer = rng.pick(pool);
    const { lines, facts } = news(world, rng, y, writer);
    const past = world.events.filter((e) => e.year < y);
    if (past.length && rng.chance(0.7)) lines.unshift(rng.pick(MENTIONS)(rng.pick(past).name));
    if (!lines.length) lines.push('There is no news here worth the paper, only the weather and the price of coal.');
    letter(writer, y, lines, facts);
  }
  // Letters sit in the archive by date, not by when they were written up.
  const letterDocs = docs.filter((d) => d.kind === 'letter').sort((a, b) => a.year! - b.year!);
  letterDocs.forEach((d, i) => (d.id = `letter-${i + 1}`));
  return { world, docs: [...docs.filter((d) => d.kind !== 'letter'), ...letterDocs] };
}

const MENTIONS: ((e: string) => string)[] = [
  (e) => `People still speak of ${e} as if it were last week.`,
  (e) => `Old folk here say nothing has been the same since ${e}.`,
  (e) => `Since ${e} the lane has never been mended properly.`,
];

/** Family news a writer could give in a given year, with the facts it establishes. */
function news(w: World, rng: Rng, year: number, writer: Person): { lines: string[]; facts: string[] } {
  const lines: string[] = [];
  const facts: string[] = [];
  const name = (id: number) => fullName(w.people[id - 1]);
  const born = w.people.filter((p) => p.born === year && p.mother !== null && p.id !== writer.id);
  const wed = w.people.filter((p) => p.married === year && p.sex === 'f' && p.spouse !== null && p.id !== writer.id);
  const buried = w.people.filter((p) => p.died === year && p.id !== writer.id);
  if (born.length && rng.chance(0.6)) {
    const b = rng.pick(born);
    lines.push(`${name(b.mother!)} has had a ${b.sex === 'f' ? 'girl' : 'boy'}, to be called ${fullName(b)}.`);
    facts.push(`born:${b.id}`, `mother:${b.id}`);
  }
  if (wed.length && rng.chance(0.7)) {
    const b = rng.pick(wed);
    lines.push(`${fullName(b)} was wed to ${name(b.spouse!)} this summer.`);
    facts.push(`married:${b.id}`, `married:${b.spouse}`);
  }
  if (buried.length && rng.chance(0.6)) {
    const b = rng.pick(buried);
    lines.push(`We buried ${fullName(b)} at Michaelmas.`);
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
