import { clerkAction } from '../agents/researcher.js';
import { normaliseName } from '../engine/questions.js';
import { openedIds, type Action, type InquiryView } from '../engine/research.js';
import { extractJson } from './parse.js';
import type { LLMProvider, UsageMeter } from './provider.js';

// A model as the researcher. Each step it sees the question and everything it
// has found so far, and replies with one tool call as JSON. Replies are
// checked (the tool, the document, the citations, the name in the answer);
// a bad reply gets one repair round, and then the clerk takes that step.

export const RESEARCHER_SYSTEM = `You are a researcher in the archive of Wending, a small village, working through one question at a time.

The archive holds parish registers (baptisms with both parents, marriages, burials with the age at death), a ledger for each property (who held it, sales and inheritances, by year), letters and gazette clippings. Each document has an id such as "bap-1850", "ledger-mill", "letter-4" or "gazette-flood".

You have three tools. Searching or opening costs one action; you have a fixed number of actions per question.
- search {"query": "..."}: keyword search; returns up to six documents with the line that matched best.
- open {"doc": "<id>"}: read a whole document.
- answer {"answer": "...", "cite": ["<id>", ...]}: give the answer and cite the documents it rests on.

How to work:
- Work out which facts the answer needs before you search. A year of an event may be given only relative to a letter's date ("it is three years since...", "the year before last", "came this year").
- A property's holder in a year is the last person the ledger names in or before that year.
- An age is that year minus the year of birth. Someone baptised has their birth year in the baptism line; for older people, take the burial year minus the age at burial.
- Cite every document your answer rests on, and only documents you have opened. Snippets alone are not a source.
- Names are first name and family name, exactly as the documents write them.
- Fewer actions score better, but a wrong or uncited answer scores far worse.

Reply with one JSON object and nothing else:
{"thought": "<one short sentence>", "tool": "search" | "open" | "answer", "args": {...}}`;

export interface ResearchMeta {
  kind: 'research';
  hint: Action;
}

export interface StepResult {
  action: Action;
  thought: string;
  repaired: boolean;
  fallback: boolean;
  problem?: string;
}

/** The question and the visit so far, written out for the model. */
export function visitText(v: InquiryView): string {
  const out = [`Question ${v.question.id}: ${v.question.text}`, `Answer type: ${v.question.answerType === 'number' ? 'a number' : 'a person\'s name'}.`, `Actions used: ${v.used} of ${v.budget}.`];
  if (v.used >= v.budget) out.push('You have no actions left: answer now.');
  if (!v.steps.length) out.push('', 'Nothing searched or opened yet.');
  for (const s of v.steps) {
    out.push('');
    if (s.action.kind === 'search') {
      out.push(`You searched: ${JSON.stringify(s.action.query)}`);
      if (!s.hits?.length) out.push('  (nothing found)');
      for (const h of s.hits ?? []) out.push(`  [${h.id}] ${h.title}: ${h.snippet}`);
    } else if (s.action.kind === 'open' && s.doc) {
      out.push(`You opened [${s.doc.id}] ${s.doc.title}:`, ...s.doc.text.split('\n').map((l) => `  ${l}`));
    }
  }
  out.push('', 'Your next tool call, as JSON:');
  return out.join('\n');
}

/** Turn a parsed reply into an action, or say what is wrong with it. */
export function readReply(raw: unknown): { action: Action; thought: string } | { problem: string } {
  if (!raw || typeof raw !== 'object') return { problem: 'reply with one JSON object' };
  const r = raw as { thought?: unknown; tool?: unknown; args?: Record<string, unknown> };
  const thought = typeof r.thought === 'string' ? r.thought.slice(0, 200) : '';
  const args = r.args && typeof r.args === 'object' ? r.args : {};
  if (r.tool === 'search') {
    if (typeof args.query !== 'string' || !args.query.trim()) return { problem: 'search needs a non-empty "query"' };
    return { action: { kind: 'search', query: args.query.slice(0, 120) }, thought };
  }
  if (r.tool === 'open') {
    if (typeof args.doc !== 'string') return { problem: 'open needs a "doc" id' };
    return { action: { kind: 'open', doc: args.doc.trim() }, thought };
  }
  if (r.tool === 'answer') {
    const answer = typeof args.answer === 'number' ? String(args.answer) : args.answer;
    if (typeof answer !== 'string' || !answer.trim()) return { problem: 'answer needs a non-empty "answer"' };
    const cite = Array.isArray(args.cite) ? args.cite.filter((c): c is string => typeof c === 'string').map((c) => c.trim()) : [];
    return { action: { kind: 'answer', answer: answer.slice(0, 80), cite }, thought };
  }
  return { problem: 'the tool must be "search", "open" or "answer"' };
}

/** Checks a well-formed action against what this visit has actually seen. */
export function checkAction(v: InquiryView, a: Action, exists: (id: string) => boolean): string | null {
  if (a.kind !== 'answer' && v.used >= v.budget) return 'you have no actions left; answer now';
  if (a.kind === 'open') {
    if (!exists(a.doc)) return `there is no document "${a.doc}"; use an id from your search results`;
    if (openedIds(v).includes(a.doc)) return `you have already opened "${a.doc}"; its text is above`;
    return null;
  }
  if (a.kind === 'search') {
    const before = v.steps.some((s) => s.action.kind === 'search' && s.action.query.toLowerCase() === a.query.toLowerCase());
    return before ? 'you already ran that search; its results are above' : null;
  }
  const opened = openedIds(v);
  if (!a.cite.length) return 'cite the documents your answer rests on';
  const unread = a.cite.filter((c) => !opened.includes(c));
  if (unread.length) return `you cited ${unread.map((c) => `"${c}"`).join(', ')} without opening it; cite only documents you opened`;
  if (v.question.answerType === 'name') {
    const text = normaliseName(v.steps.filter((s) => s.doc).map((s) => s.doc!.text).join(' '));
    if (!text.includes(normaliseName(a.answer))) return `"${a.answer}" does not appear in any document you opened; give a name as the documents write it`;
  } else if (!/-?\d+/.test(a.answer)) return 'the answer should be a number';
  return null;
}

export class LLMResearcher {
  constructor(
    readonly provider: LLMProvider,
    readonly meter?: UsageMeter,
  ) {}

  async step(v: InquiryView, exists: (id: string) => boolean): Promise<StepResult> {
    const meta: ResearchMeta = { kind: 'research', hint: clerkAction(v) };
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: visitText(v) }];
    let problem = '';
    for (let round = 0; round < 2; round++) {
      let text: string;
      try {
        const res = await this.provider.complete({ system: RESEARCHER_SYSTEM, messages, maxTokens: 400, meta });
        this.meter?.record(res);
        text = res.text;
      } catch (err) {
        if (this.meter) this.meter.failures++;
        problem = `provider failed: ${(err as Error).message}`;
        break;
      }
      let parsed: unknown;
      try {
        parsed = extractJson(text);
      } catch {
        parsed = null;
      }
      const read = readReply(parsed);
      problem = 'problem' in read ? read.problem : (checkAction(v, read.action, exists) ?? '');
      if (!problem && 'action' in read) return { action: read.action, thought: read.thought, repaired: round > 0, fallback: false };
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That reply can't be used: ${problem}. Reply again with one JSON tool call.` });
    }
    if (this.meter) this.meter.failures++;
    return { action: meta.hint, thought: 'the clerk took this step', repaired: false, fallback: true, problem };
  }
}
