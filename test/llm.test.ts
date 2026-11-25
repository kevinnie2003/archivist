import { describe, expect, it } from 'vitest';
import { runVisit } from '../src/agents/run.js';
import { makeArchive } from '../src/engine/docs.js';
import { makeQuestions } from '../src/engine/questions.js';
import { newInquiry, perform, viewOf } from '../src/engine/research.js';
import { Catalogue } from '../src/engine/search.js';
import { makeWorld } from '../src/engine/world.js';
import { MockLLMProvider } from '../src/llm/mock.js';
import { extractJson } from '../src/llm/parse.js';
import type { CompletionRequest, LLMProvider } from '../src/llm/provider.js';
import { UsageMeter } from '../src/llm/provider.js';
import { checkAction, LLMResearcher, readReply, visitText } from '../src/llm/researcher.js';

const setup = (seed = 4) => {
  const a = makeArchive(makeWorld(seed));
  return { a, cat: new Catalogue(a), qs: makeQuestions(a) };
};

class Scripted implements LLMProvider {
  readonly name = 'scripted';
  seen: CompletionRequest[] = [];
  constructor(private replies: string[]) {}
  async complete(req: CompletionRequest) {
    this.seen.push(req);
    return { text: this.replies.shift() ?? '{}' };
  }
}

describe('the model researcher', () => {
  it('parses replies and refuses bad tools', () => {
    expect(readReply(extractJson('Sure: ```json\n{"tool":"search","args":{"query":"flood"}}\n```'))).toMatchObject({ action: { kind: 'search', query: 'flood' } });
    expect(readReply({ tool: 'answer', args: { answer: 42, cite: ['x'] } })).toMatchObject({ action: { kind: 'answer', answer: '42', cite: ['x'] } });
    expect(readReply({ tool: 'browse' })).toHaveProperty('problem');
    expect(readReply({ tool: 'search', args: { query: ' ' } })).toHaveProperty('problem');
  });

  it('checks citations and names against what it actually opened', () => {
    const { a, cat, qs } = setup();
    const q = qs.find((x) => x.answerType === 'name')!;
    const inq = newInquiry(q);
    const exists = (id: string) => !!cat.open(id);
    expect(checkAction(viewOf(inq), { kind: 'open', doc: 'register-of-all' }, exists)).toMatch(/no document/);
    expect(checkAction(viewOf(inq), { kind: 'answer', answer: q.answer, cite: ['ledger-mill'] }, exists)).toMatch(/without opening/);
    perform(a, cat, inq, { kind: 'open', doc: 'ledger-mill' });
    expect(checkAction(viewOf(inq), { kind: 'open', doc: 'ledger-mill' }, exists)).toMatch(/already opened/);
    expect(checkAction(viewOf(inq), { kind: 'answer', answer: 'Zebedee Nobody', cite: ['ledger-mill'] }, exists)).toMatch(/does not appear/);
  });

  it('never sees the answer or the facts it needs', async () => {
    const { a, cat, qs } = setup();
    for (const q of qs) {
      const p = new Scripted([]);
      const r = new LLMResearcher(p);
      const inq = newInquiry(q);
      perform(a, cat, inq, { kind: 'search', query: 'ledger' });
      await r.step(viewOf(inq), (id) => !!cat.open(id));
      const sent = JSON.stringify(p.seen.map((s) => [s.system, s.messages]));
      expect(sent).not.toContain('"needs"');
      for (const k of q.needs) expect(sent).not.toContain(k);
      expect(p.seen[0].messages[0].content).toContain(q.text);
    }
  });

  it('repairs a bad reply once, then lets the clerk take the step', async () => {
    const { cat, qs } = setup();
    const inq = newInquiry(qs[0]);
    const fixed = new LLMResearcher(new Scripted(['no idea', '{"tool":"search","args":{"query":"ledger of the mill"}}']));
    const r1 = await fixed.step(viewOf(inq), (id) => !!cat.open(id));
    expect(r1).toMatchObject({ repaired: true, fallback: false, action: { kind: 'search', query: 'ledger of the mill' } });
    const meter = new UsageMeter();
    const broken = new LLMResearcher(new Scripted(['no idea', '{"tool":"open","args":{"doc":"nowhere"}}']), meter);
    const r2 = await broken.step(viewOf(inq), (id) => !!cat.open(id));
    expect(r2.fallback).toBe(true);
    expect(r2.problem).toMatch(/no document/);
    expect(meter.failures).toBe(1);
  });

  it('with a clean mock, does as well as the clerk; with noise, the checks catch most slips', async () => {
    const { a, cat, qs } = setup(12);
    const clean = new LLMResearcher(new MockLLMProvider(0, 1));
    for (const q of qs) {
      const inq = await runVisit(a, cat, q, async (v) => (await clean.step(v, (id) => !!cat.open(id))).action);
      expect(inq.result!.right).toBe(true);
    }
    const noisy = new LLMResearcher(new MockLLMProvider(0.3, 2));
    let repaired = 0;
    for (let s = 1; s <= 5; s++) {
      const x = setup(s);
      for (const q of x.qs) await runVisit(x.a, x.cat, q, async (v) => {
        const r = await noisy.step(v, (id) => !!x.cat.open(id));
        repaired += +r.repaired;
        return r.action;
      });
    }
    expect(repaired).toBeGreaterThan(5);
  });

  it('writes the visit out with snippets and whole pages', () => {
    const { a, cat, qs } = setup();
    const inq = newInquiry(qs[0]);
    perform(a, cat, inq, { kind: 'search', query: 'ledger of the mill' });
    perform(a, cat, inq, { kind: 'open', doc: 'ledger-mill' });
    const t = visitText(viewOf(inq));
    expect(t).toContain('[ledger-mill] Ledger of the mill');
    expect(t).toContain('You opened [ledger-mill]');
    expect(t).toContain('Actions used: 2 of 8.');
  });
});
