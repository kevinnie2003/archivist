import { describe, expect, it } from 'vitest';
import { readDoc, relativeYear } from '../src/agents/read.js';
import { planFor, researcherAction } from '../src/agents/researcher.js';
import { runVisitSync } from '../src/agents/run.js';
import { makeArchive } from '../src/engine/docs.js';
import { makeQuestions } from '../src/engine/questions.js';
import { Catalogue } from '../src/engine/search.js';
import { makeWorld } from '../src/engine/world.js';

describe('reading documents', () => {
  it('works out an event year from a letter that dates it from its own year', () => {
    expect(relativeYear('It is three years since the great flood, though it feels nearer.', 1861)).toEqual({ event: 'the great flood', year: 1858 });
    expect(relativeYear('The chapel fire came this year and we are not over it yet.', 1850)).toEqual({ event: 'the chapel fire', year: 1850 });
    expect(relativeYear('The hard winter was the year before last, and still people date everything by it.', 1870)).toEqual({ event: 'the hard winter', year: 1868 });
    expect(relativeYear('People still speak of the great flood as if it were last week.', 1870)).toBeNull();
  });

  it('reads registers and ledgers from their text alone', () => {
    const n = readDoc({ id: 'x', title: 'Parish register: burials, 1860 to 1869', text: '1863. Hugh Rook, aged 59.\n1869. Ezra Penrose, aged 70.' });
    expect(n.born.get('hugh rook')).toEqual({ value: 1804, doc: 'x' });
    const l = readDoc({ id: 'ledger-mill', title: 'Ledger of the mill', text: '1840. Entered in this ledger as held by Hugh Wren.\n1881. Passed to Amos Wren by inheritance from Hugh Wren.\n1892. Sold by Amos Wren to Lettice Vane for £240.' });
    expect(l.ledger.get('the mill')!.value).toEqual([
      { year: 1840, to: 'Hugh Wren' },
      { year: 1881, to: 'Amos Wren' },
      { year: 1892, to: 'Lettice Vane' },
    ]);
  });

  it('knows each kind of question', () => {
    const a = makeArchive(makeWorld(9));
    for (const q of makeQuestions(a)) expect(planFor(q.text).kind).toBe(q.kind);
  });
});

describe('the built-in researchers', () => {
  it('the clerk answers nearly everything, cited, within the budget; the skimmer mostly misses', () => {
    let clerk = 0;
    let cited = 0;
    let skim = 0;
    let n = 0;
    for (let s = 1; s <= 40; s++) {
      const a = makeArchive(makeWorld(s));
      const cat = new Catalogue(a);
      for (const q of makeQuestions(a)) {
        n++;
        const c = runVisitSync(a, cat, q, (v) => researcherAction('clerk', v));
        clerk += +c.result!.right;
        cited += +c.result!.cited;
        expect(c.used).toBeLessThanOrEqual(8);
        skim += +runVisitSync(a, cat, q, (v) => researcherAction('skimmer', v)).result!.right;
      }
    }
    expect(clerk / n).toBeGreaterThan(0.97);
    expect(cited / n).toBeGreaterThan(0.97);
    expect(skim / n).toBeLessThan(0.4);
  });
});
