import { describe, expect, it } from 'vitest';
import { makeArchive } from '../src/engine/docs.js';
import { BUDGET, grade, isRight, makeQuestions } from '../src/engine/questions.js';
import { actionProblem, newInquiry, perform, viewOf } from '../src/engine/research.js';
import { Catalogue } from '../src/engine/search.js';
import { fullName, holderIn, makeWorld } from '../src/engine/world.js';

describe('the village', () => {
  it('is the same from the same seed and different from another', () => {
    expect(makeWorld(7)).toEqual(makeWorld(7));
    expect(makeWorld(7)).not.toEqual(makeWorld(8));
  });

  it('keeps names unique and families consistent', () => {
    for (let s = 1; s <= 60; s++) {
      const w = makeWorld(s);
      expect(new Set(w.people.map(fullName)).size).toBe(w.people.length);
      for (const p of w.people) {
        if (p.spouse) expect(w.people[p.spouse - 1].spouse).toBe(p.id);
        if (p.father) expect(w.people[p.father - 1].born).toBeLessThan(p.born - 15);
        if (p.mother) expect(w.people[p.mother - 1].sex).toBe('f');
        if (p.died !== null) expect(p.died).toBeGreaterThan(p.born);
      }
      for (const prop of w.properties) {
        prop.chain.forEach((t, i) => i && expect(t.year).toBeGreaterThanOrEqual(prop.chain[i - 1].year));
        expect(holderIn(prop, 1839)).toBeNull();
        expect(holderIn(prop, 1840)).toBe(prop.chain[0].to);
      }
    }
  });
});

describe('the archive', () => {
  it('writes every event year down exactly once', () => {
    for (let s = 1; s <= 60; s++) {
      const a = makeArchive(makeWorld(s));
      for (const e of a.world.events) expect(a.docs.filter((d) => d.facts.includes(`event:${e.id}`)).length).toBe(1);
      expect(new Set(a.docs.map((d) => d.id)).size).toBe(a.docs.length);
    }
  });

  it('says what the world says: burials give the right age, letters date events from their own year', () => {
    const a = makeArchive(makeWorld(3));
    for (const p of a.world.people.filter((x) => x.died !== null)) {
      const page = a.docs.find((d) => d.facts.includes(`died:${p.id}`) && d.kind === 'register')!;
      expect(page.text).toContain(`${p.died}. ${fullName(p)}, aged ${p.died! - p.born}.`);
    }
    const letters = a.docs.filter((d) => d.kind === 'letter');
    expect(letters.map((d) => d.year)).toEqual([...letters.map((d) => d.year)].sort((x, y) => x! - y!));
  });

  it('finds documents by name and event, with the matching line as the snippet', () => {
    const a = makeArchive(makeWorld(11));
    const cat = new Catalogue(a);
    const hits = cat.search('Jem Hale baptisms');
    expect(hits[0].snippet).toContain('Jem Hale, son of');
    expect(cat.search('ledger of the mill')[0].id).toBe('ledger-mill');
    expect(cat.search('the the of')).toEqual([]);
    expect(cat.search('married').length).toBeGreaterThan(0);
  });
});

describe('questions and grading', () => {
  it('asks six different questions, each answerable from the archive', () => {
    for (let s = 1; s <= 60; s++) {
      const a = makeArchive(makeWorld(s));
      const qs = makeQuestions(a);
      expect(qs.length).toBe(6);
      expect(new Set(qs.map((q) => q.text)).size).toBe(6);
      for (const q of qs) for (const k of q.needs) expect(a.docs.some((d) => d.facts.includes(k))).toBe(true);
    }
  });

  it('accepts a name with a title or a number in words around it', () => {
    const q = { id: 1, kind: 'holderAtEvent' as const, text: '', answer: 'Ada Hale', answerType: 'name' as const, needs: [] };
    expect(isRight(q, 'Mrs Ada Hale')).toBe(true);
    expect(isRight(q, 'ada hale.')).toBe(true);
    expect(isRight(q, 'Ada Marsh')).toBe(false);
    expect(isRight({ ...q, answer: '42', answerType: 'number' }, 'She was 42')).toBe(true);
    expect(isRight({ ...q, answer: '42', answerType: 'number' }, '43')).toBe(false);
  });

  it('scores right, cited and spare actions, and only cited facts count', () => {
    const a = makeArchive(makeWorld(5));
    const q = makeQuestions(a).find((x) => x.kind === 'holderAtEvent')!;
    const sources = q.needs.map((k) => a.docs.find((d) => d.facts.includes(k))!.id);
    expect(grade(a, q, q.answer, sources, 3)).toMatchObject({ right: true, cited: true, spare: BUDGET - 3, points: 10 + 5 + BUDGET - 3 });
    expect(grade(a, q, q.answer, sources.slice(1), 3)).toMatchObject({ right: true, cited: false, points: 10 + BUDGET - 3 });
    expect(grade(a, q, 'Nobody Atall', sources, 3)).toMatchObject({ right: false, points: -3 });
  });

  it('spends actions on searches and pages, closes the room at the budget, and hides the answer from the view', () => {
    const a = makeArchive(makeWorld(2));
    const cat = new Catalogue(a);
    const q = makeQuestions(a)[0];
    const inq = newInquiry(q);
    expect(perform(a, cat, inq, { kind: 'open', doc: 'nope' }).error).toMatch(/no document/);
    for (let i = 0; i < BUDGET; i++) perform(a, cat, inq, { kind: 'search', query: `mill ${i}` });
    expect(actionProblem(cat, inq, { kind: 'search', query: 'more' })).toMatch(/answer now/);
    const v = viewOf(inq);
    expect(JSON.stringify(v)).not.toContain('"needs"');
    expect(Object.keys(v.question)).toEqual(['id', 'text', 'answerType']);
    perform(a, cat, inq, { kind: 'answer', answer: 'x', cite: [] });
    expect(inq.result?.right).toBe(false);
    expect(actionProblem(cat, inq, { kind: 'answer', answer: 'y', cite: [] })).toMatch(/already answered/);
  });
});
