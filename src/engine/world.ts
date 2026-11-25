import { Rng } from './rng.js';

// The village of Wending, 1840 to 1895: families, marriages, property and
// the events people dated things by. Everything is generated from a seed, and
// every document and question is written from these facts.

export interface Person {
  id: number;
  given: string;
  /** Wending folk keep their family name for life, married or not. */
  surname: string;
  sex: 'f' | 'm';
  born: number;
  died: number | null;
  father: number | null;
  mother: number | null;
  spouse: number | null;
  married: number | null;
}

export interface Transfer {
  year: number;
  /** Who held the property after this year. */
  to: number;
  how: 'first' | 'sold' | 'inherited';
  from: number | null;
  price?: number;
}

export interface Property {
  id: string;
  name: string;
  chain: Transfer[];
}

export interface Happening {
  id: string;
  name: string;
  year: number;
}

export interface World {
  seed: number;
  people: Person[];
  properties: Property[];
  events: Happening[];
}

export const SURNAMES = ['Hale', 'Marsh', 'Penrose', 'Quill', 'Rook', 'Tallow', 'Vane', 'Wren'];
export const GIVEN = {
  f: ['Ada', 'Bess', 'Clara', 'Dorcas', 'Edith', 'Hester', 'Ivy', 'Jane', 'Lettice', 'Maud', 'Nell', 'Ruth', 'Sarah', 'Tess'],
  m: ['Abel', 'Amos', 'Cyril', 'Ezra', 'Gideon', 'Hugh', 'Isaac', 'Jem', 'Lionel', 'Noah', 'Otto', 'Silas', 'Tobias', 'Walter'],
};
export const PROPERTY_NAMES: [string, string][] = [
  ['mill', 'the mill'],
  ['bell', 'the Bell inn'],
  ['forge', 'the forge'],
  ['acre', 'Long Acre'],
  ['ferry', 'the ferry'],
];
export const EVENT_NAMES: [string, string][] = [
  ['flood', 'the great flood'],
  ['fire', 'the chapel fire'],
  ['cholera', 'the cholera summer'],
  ['bridge', 'the opening of the new bridge'],
  ['winter', 'the hard winter'],
];

export const fullName = (p: Person) => `${p.given} ${p.surname}`;

export function makeWorld(seed: number): World {
  const rng = new Rng(seed * 2654435761 + 17);
  const people: Person[] = [];
  const used = new Set<string>();
  const person = (sex: 'f' | 'm', surname: string, born: number, father: number | null, mother: number | null): Person => {
    let given = rng.pick(GIVEN[sex]);
    for (let i = 0; used.has(`${given} ${surname}`) && i < 30; i++) given = rng.pick(GIVEN[sex]);
    used.add(`${given} ${surname}`);
    const p: Person = { id: people.length + 1, given, surname, sex, born, died: null, father, mother, spouse: null, married: null };
    people.push(p);
    return p;
  };
  const wed = (a: Person, b: Person, year: number) => {
    a.spouse = b.id;
    b.spouse = a.id;
    a.married = b.married = year;
  };

  // The elders: six couples, each husband the head of one family.
  const families = rng.shuffle(SURNAMES).slice(0, 6);
  const elders: [Person, Person][] = [];
  families.forEach((s, i) => {
    const h = person('m', s, 1798 + rng.int(16), null, null);
    const wifeName = families[(i + 1 + rng.int(families.length - 1)) % families.length];
    const w = person('f', wifeName === s ? families[(i + 1) % families.length] : wifeName, h.born + rng.int(6) - 1, null, null);
    wed(h, w, Math.max(h.born, w.born) + 21 + rng.int(5));
    elders.push([h, w]);
  });
  // Their children.
  const children: Person[] = [];
  for (const [h, w] of elders) {
    const n = 2 + rng.int(2);
    let year = h.married! + 1 + rng.int(2);
    for (let k = 0; k < n; k++) {
      children.push(person(rng.chance(0.5) ? 'f' : 'm', h.surname, year, h.id, w.id));
      year += 2 + rng.int(3);
    }
  }
  // Children marry across families.
  const single = rng.shuffle(children);
  for (const a of single) {
    if (a.spouse) continue;
    const b = single.find((x) => !x.spouse && x !== a && x.sex !== a.sex && x.surname !== a.surname && Math.abs(x.born - a.born) <= 6);
    if (!b || rng.chance(0.15)) continue;
    wed(a, b, Math.max(a.born, b.born) + 20 + rng.int(6));
  }
  // Grandchildren for the younger couples.
  for (const a of children) {
    if (!a.spouse || a.sex !== 'm') continue;
    const b = people[a.spouse - 1];
    const n = 1 + rng.int(3);
    let year = a.married! + 1 + rng.int(2);
    for (let k = 0; k < n && year < 1880; k++) {
      person(rng.chance(0.5) ? 'f' : 'm', a.surname, year, a.id, b.id);
      year += 2 + rng.int(3);
    }
  }
  // Deaths: most elders die between 1850 and 1885, a few of the next generation too.
  for (const p of people) {
    const elder = p.father === null;
    if (elder) p.died = Math.min(1888, Math.max(p.born + 45, 1848 + rng.int(36)));
    else if (rng.chance(0.15) && p.born < 1845) p.died = p.born + 30 + rng.int(20);
    if (p.died !== null && p.died > 1894) p.died = null;
  }

  // Property: each held first by an elder, then sold or left to a child, once or twice.
  const properties: Property[] = PROPERTY_NAMES.map(([id, name], i) => {
    const first = elders[i % elders.length][0];
    const chain: Transfer[] = [{ year: 1840, to: first.id, how: 'first', from: null }];
    let holder = first;
    let year = 1840;
    for (let step = 0; step < 2 + rng.int(2); step++) {
      const kids = people.filter((c) => c.father === holder.id && c.born + 21 <= 1893);
      if (holder.died !== null && holder.died > year && kids.length && rng.chance(0.65)) {
        const heir = rng.pick(kids);
        year = Math.max(holder.died, heir.born + 21);
        if (year > 1893) break;
        chain.push({ year, to: heir.id, how: 'inherited', from: holder.id });
        holder = heir;
      } else {
        year += 6 + rng.int(12);
        const alive = people.filter((b) => b.id !== holder.id && b.born + 21 <= year && (b.died === null || b.died > year) && b.surname !== holder.surname);
        if (year > 1893 || !alive.length || (holder.died !== null && holder.died <= year)) break;
        const buyer = rng.pick(alive);
        chain.push({ year, to: buyer.id, how: 'sold', from: holder.id, price: 40 + rng.int(46) * 10 });
        holder = buyer;
      }
    }
    return { id, name, chain };
  });

  const years = rng.shuffle(Array.from({ length: 45 }, (_, i) => 1845 + i)).slice(0, EVENT_NAMES.length);
  const events: Happening[] = EVENT_NAMES.map(([id, name], i) => ({ id, name, year: years[i] }));
  return { seed, people, properties, events };
}

/** Who held a property at the end of a year. */
export function holderIn(p: Property, year: number): number | null {
  let who: number | null = null;
  for (const t of p.chain) if (t.year <= year) who = t.to;
  return who;
}
