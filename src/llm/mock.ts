import { Rng } from '../engine/rng.js';
import type { ResearchMeta } from './researcher.js';
import type { CompletionRequest, CompletionResult, LLMProvider } from './provider.js';

/**
 * An offline stand-in for a model that speaks the researcher's JSON protocol,
 * so the model path (prompt, checks, repair, fallback) runs and is tested
 * without a key. It takes the clerk's step; `noise` makes some replies broken
 * (caught by the checks) and some plausibly wrong (not caught).
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  private rng: Rng;

  constructor(
    readonly noise = 0,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const usage = { inputTokens: Math.round((req.system.length + req.messages.reduce((a, m) => a + m.content.length, 0)) / 4), outputTokens: 60 };
    const meta = req.meta as ResearchMeta | undefined;
    if (meta?.kind !== 'research') return { text: '{}', usage };
    const a = meta.hint;
    const repairing = req.messages.length > 1;
    if (!repairing && this.noise > 0 && this.rng.chance(this.noise)) {
      const broken = [
        'Let me look in the registers first.',
        '{"tool": "open", "args": {"doc": "register-of-everything"}}',
        '{"tool": "answer", "args": {"answer": "Somebody", "cite": ["letter-99"]}}',
        '{"tool": "browse", "args": {}}',
      ];
      if (a.kind === 'answer' && /\d/.test(a.answer) && this.rng.chance(0.5)) {
        // A slip the checks can't catch: off by one in the sum.
        return { text: JSON.stringify({ thought: 'counting the years', tool: 'answer', args: { answer: String(Number(a.answer) + (this.rng.chance(0.5) ? 1 : -1)), cite: a.cite } }), usage };
      }
      return { text: this.rng.pick(broken), usage };
    }
    const tool = a.kind;
    const args = a.kind === 'search' ? { query: a.query } : a.kind === 'open' ? { doc: a.doc } : { answer: a.answer, cite: a.cite };
    const thought = a.kind === 'search' ? 'find the page that says it' : a.kind === 'open' ? 'read it whole' : 'that settles it';
    return { text: JSON.stringify({ thought, tool, args }), usage };
  }
}
