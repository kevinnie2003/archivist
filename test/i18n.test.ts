import { describe, expect, it } from 'vitest';
import { readDoc, relativeYear } from '../src/agents/read.js';
import { planFor, researcherAction } from '../src/agents/researcher.js';
import { runVisit, runVisitSync } from '../src/agents/run.js';
import { makeArchive } from '../src/engine/docs.js';
import { factWords, isRight, makeQuestions } from '../src/engine/questions.js';
import { Catalogue, tokens } from '../src/engine/search.js';
import { makeWorld } from '../src/engine/world.js';
import { spaceMixed } from '../src/i18n/spacing.js';
import { MockLLMProvider } from '../src/llm/mock.js';
import type { CompletionRequest, LLMProvider } from '../src/llm/provider.js';
import { LLMResearcher, researcherSystem } from '../src/llm/researcher.js';
import { newInquiry, perform, viewOf } from '../src/engine/research.js';
import { visitFrom } from '../src/server/server.js';

const both = (seed: number) => {
  const w = makeWorld(seed);
  return { en: makeArchive(w, 'en'), zh: makeArchive(w, 'zh') };
};
const UNSPACED = /[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/;

describe('an archive in two languages', () => {
  it('has the same documents, facts, questions and answers from the same seed', () => {
    for (let s = 1; s <= 40; s++) {
      const { en, zh } = both(s);
      expect(zh.lang).toBe('zh');
      const shape = (a: typeof en) => a.docs.map((d) => ({ id: d.id, kind: d.kind, year: d.year, facts: d.facts }));
      expect(shape(zh)).toEqual(shape(en));
      const qa = (a: typeof en) => makeQuestions(a).map((q) => ({ kind: q.kind, answer: q.answer, answerType: q.answerType, needs: q.needs }));
      expect(qa(zh)).toEqual(qa(en));
      const qs = makeQuestions(zh);
      for (const q of qs) expect(q.text).toMatch(/[\u4e00-\u9fff]/);
      expect(qs.every((q) => q.lang === 'zh')).toBe(true);
    }
  });

  it('writes Chinese around the Latin names, spaced the way Chinese typesetting sets them', () => {
    const { en, zh } = both(4);
    for (const d of zh.docs) {
      expect(`${d.title}\n${d.text}`).toMatch(/[\u4e00-\u9fff]/);
      expect(UNSPACED.test(`${d.title}\n${d.text}`)).toBe(false);
      expect(d.text).not.toMatch(/\b(?:daughter|son of|aged|Ledger|Dear|Sold by|Entered|wed to|buried)\b/);
    }
    for (const q of makeQuestions(zh)) expect(UNSPACED.test(q.text)).toBe(false);
    const p = en.world.people.find((x) => x.died !== null)!;
    const bur = zh.docs.find((d) => d.kind === 'register' && d.facts.includes(`died:${p.id}`))!;
    expect(bur.text).toContain(`${p.died} 年。${p.given} ${p.surname}，享年 ${p.died! - p.born} 岁。`);
    expect(factWords(zh, 'event:flood')).toBe('大水的年份');
    expect(factWords(zh, 'event:flood', 'en')).toBe('the year of the great flood');
    expect(spaceMixed('大水那一年Ada Hale多少岁')).toBe('大水那一年 Ada Hale 多少岁');
  });

  it('dates events in letters with natural relative phrases the clerk can read', () => {
    expect(relativeYear('大水已经过去三年了，却像是不久前的事。', 1861)).toEqual({ event: '大水', year: 1858 });
    expect(relativeYear('礼拜堂大火就出在今年，大家至今还没缓过来。', 1850)).toEqual({ event: '礼拜堂大火', year: 1850 });
    expect(relativeYear('严冬是前年的事，如今大家记事还拿它作准。', 1870)).toEqual({ event: '严冬', year: 1868 });
    expect(relativeYear('新桥落成已经过去一年了，人们还在议论。', 1870)).toEqual({ event: '新桥落成', year: 1869 });
    expect(relativeYear('人们说起大水，还像是上礼拜的事。', 1870)).toBeNull();
    const n = readDoc({ id: 'x', title: '教区登记簿：下葬，1860 年至 1869 年', text: '1863 年。Hugh Rook，享年 59 岁。' });
    expect(n.born.get('hugh rook')).toEqual({ value: 1804, doc: 'x' });
    const l = readDoc({
      id: 'ledger-mill',
      title: '磨坊产业簿',
      text: '1840 年。立簿，时为 Hugh Wren 所有。\n1881 年。Hugh Wren 名下产业由 Amos Wren 继承。\n1892 年。Amos Wren 以 240 镑售予 Lettice Vane。',
    });
    expect(l.ledger.get('磨坊')!.value).toEqual([
      { year: 1840, to: 'Hugh Wren' },
      { year: 1881, to: 'Amos Wren' },
      { year: 1892, to: 'Lettice Vane' },
    ]);
    const zh = both(9).zh;
    for (const q of makeQuestions(zh)) expect(planFor(q.text).kind).toBe(q.kind);
  });
});

describe('searching in Chinese', () => {
  it('reads Chinese in pairs of characters, and a single character on its own', () => {
    expect(tokens('磨坊产业簿')).toEqual(['磨坊', '坊产', '产业', '业簿']);
    expect(tokens('磨')).toEqual(['磨']);
    expect(tokens('Ada Hale 洗礼')).toEqual(['ada', 'hale', '洗礼']);
    expect(tokens('洪水')).toEqual(tokens('大水'));
  });

  it('finds the document that establishes a property, an event, a birth or a wedding', () => {
    for (let s = 1; s <= 20; s++) {
      const { zh } = both(s);
      const cat = new Catalogue(zh);
      expect(cat.search('磨坊产业簿')[0].id).toBe('ledger-mill');
      expect(cat.search('渡口的产业簿')[0].id).toBe('ledger-ferry');
      for (const e of zh.world.events) {
        const name = { flood: '大水', fire: '礼拜堂大火', cholera: '霍乱之夏', bridge: '新桥落成', winter: '严冬' }[e.id]!;
        const source = zh.docs.find((d) => d.facts.includes(`event:${e.id}`))!;
        expect(cat.search(name).map((h) => h.id)).toContain(source.id);
      }
      const child = zh.world.people.find((p) => p.mother !== null)!;
      const bap = zh.docs.find((d) => d.kind === 'register' && d.facts.includes(`born:${child.id}`))!;
      // A person may also be on a later page as a parent; their own baptism is among the first hits.
      const hit = cat.search(`${child.given} ${child.surname} 洗礼`).find((h) => h.id === bap.id)!;
      expect(hit).toBeDefined();
      expect(hit.snippet).toContain(`${child.given} ${child.surname}，系`);
      const bride = zh.world.people.find((p) => p.sex === 'f' && p.married !== null && p.married >= 1840 && zh.docs.some((d) => d.facts.includes(`married:${p.id}`)));
      if (bride) {
        const hits = cat.search(`${bride.given} ${bride.surname} 结婚`).map((h) => h.id);
        const sources = zh.docs.filter((d) => d.facts.includes(`married:${bride.id}`)).map((d) => d.id);
        expect(hits.some((id) => sources.includes(id))).toBe(true);
      }
    }
    expect(new Catalogue(both(3).zh).search('磨').length).toBeGreaterThan(0);
  });
});

describe('answering in Chinese', () => {
  it('accepts years written with 年, full-width digits, and names inside a Chinese sentence', () => {
    const year = { id: 1, kind: 'eventYear' as const, text: '', answer: '1851', answerType: 'number' as const, needs: [] };
    expect(isRight(year, '1851年')).toBe(true);
    expect(isRight(year, '1851 年')).toBe(true);
    expect(isRight(year, '１８５１')).toBe(true);
    expect(isRight(year, '是1852年')).toBe(false);
    const age = { ...year, answer: '42' };
    expect(isRight(age, '42岁')).toBe(true);
    const name = { ...year, kind: 'holderAtEvent' as const, answer: 'Ada Hale', answerType: 'name' as const };
    expect(isRight(name, '是 Ada Hale')).toBe(true);
    expect(isRight(name, 'Ada·Hale')).toBe(true);
    expect(isRight(name, 'Ada Hale 夫人')).toBe(true);
    expect(isRight(name, 'Ada Marsh')).toBe(false);
  });
});

describe('researchers in a Chinese archive', () => {
  it('the clerk scores as it does in English, searching in Chinese', () => {
    const score = { en: { right: 0, points: 0 }, zh: { right: 0, points: 0 } };
    let n = 0;
    const queries: string[] = [];
    for (let s = 1; s <= 40; s++) {
      const a = both(s);
      const qsEn = makeQuestions(a.en);
      const qsZh = makeQuestions(a.zh);
      for (let i = 0; i < qsEn.length; i++) {
        n++;
        for (const [lang, archive, q] of [
          ['en', a.en, qsEn[i]],
          ['zh', a.zh, qsZh[i]],
        ] as const) {
          const r = runVisitSync(archive, new Catalogue(archive), q, (v) => researcherAction('clerk', v));
          score[lang].right += +r.result!.right;
          score[lang].points += r.result!.points;
          if (lang === 'zh') for (const st of r.steps) if (st.action.kind === 'search') queries.push(st.action.query);
        }
      }
    }
    expect(score.zh.right / n).toBeGreaterThan(0.97);
    expect(Math.abs(score.zh.points - score.en.points) / n).toBeLessThan(1);
    expect(queries.every((q) => /[\u4e00-\u9fff]/.test(q))).toBe(true);
  });

  it('tells a model to work in Chinese, and the mock researcher still gets it right', async () => {
    expect(researcherSystem('en')).not.toContain('LANGUAGE');
    expect(researcherSystem('zh')).toContain('LANGUAGE: ');
    expect(researcherSystem('zh')).toContain('Simplified Chinese');
    const seen: CompletionRequest[] = [];
    const spy: LLMProvider = {
      name: 'spy',
      complete: async (req) => {
        seen.push(req);
        return new MockLLMProvider(0, 1).complete(req);
      },
    };
    const zh = both(12).zh;
    const cat = new Catalogue(zh);
    const model = new LLMResearcher(spy);
    const thoughts: string[] = [];
    for (const q of makeQuestions(zh)) {
      const inq = await runVisit(zh, cat, q, async (v) => {
        const r = await model.step(v, (id) => !!cat.open(id));
        thoughts.push(r.thought);
        return r.action;
      });
      expect(inq.result!.right).toBe(true);
    }
    expect(seen[0].system).toContain('LANGUAGE');
    expect(thoughts.every((t) => /[\u4e00-\u9fff]/.test(t))).toBe(true);
  });

  it('the server rebuilds a Chinese archive when asked, and refuses an unknown language', () => {
    const { inquiry, cat } = visitFrom({ seed: 4, question: 1, actions: [{ kind: 'search', query: '磨坊产业簿' }], lang: 'zh' });
    expect(inquiry.question.text).toMatch(/[\u4e00-\u9fff]/);
    expect(viewOf(inquiry).lang).toBe('zh');
    expect(inquiry.steps[0].hits![0].id).toBe('ledger-mill');
    expect(cat.archive.lang).toBe('zh');
    expect(visitFrom({ seed: 4, question: 1, actions: [] }).inquiry.question.text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(() => visitFrom({ seed: 4, question: 1, actions: [], lang: 'fr' })).toThrow(/bad lang/);
    const inq = newInquiry(makeQuestions(both(4).zh)[0]);
    perform(both(4).zh, new Catalogue(both(4).zh), inq, { kind: 'open', doc: 'ledger-mill' });
    expect(inq.steps[0].doc!.title).toBe('磨坊产业簿');
  });
});
