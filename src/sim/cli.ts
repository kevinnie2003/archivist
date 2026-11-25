// Run many archives with each researcher and print how they do.
import { researcherAction, type ResearcherKind } from '../agents/researcher.js';
import { runVisit, type Chooser } from '../agents/run.js';
import { makeArchive } from '../engine/docs.js';
import { makeQuestions, type QuestionKind } from '../engine/questions.js';
import type { Inquiry } from '../engine/research.js';
import { Catalogue } from '../engine/search.js';
import { makeWorld } from '../engine/world.js';
import { makeProvider, type ProviderKind } from '../llm/factory.js';
import { UsageMeter } from '../llm/provider.js';
import { LLMResearcher } from '../llm/researcher.js';

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const games = Number(flag('games', '100'));
const seed = Number(flag('seed', '1'));
const which = flag('researcher', 'all');
const provider = flag('provider', 'mock') as ProviderKind;
const noise = Number(flag('noise', '0'));
const json = args.includes('--json');

export interface Row {
  researcher: string;
  points: number;
  right: number;
  cited: number;
  actions: number;
  byKind: Partial<Record<QuestionKind, number>>;
  calls?: number;
  repaired?: number;
  fallbacks?: number;
}

async function run(label: string, choose: (cat: Catalogue) => Chooser, extra: () => Partial<Row> = () => ({})): Promise<Row> {
  const done: Inquiry[] = [];
  for (let g = 0; g < games; g++) {
    const archive = makeArchive(makeWorld(seed + g));
    const cat = new Catalogue(archive);
    for (const q of makeQuestions(archive)) done.push(await runVisit(archive, cat, q, choose(cat)));
  }
  const n = done.length;
  const avg = (f: (i: Inquiry) => number) => done.reduce((a, i) => a + f(i), 0) / n;
  const byKind: Partial<Record<QuestionKind, number>> = {};
  for (const k of new Set(done.map((i) => i.question.kind))) {
    const of = done.filter((i) => i.question.kind === k);
    byKind[k] = of.filter((i) => i.result!.right).length / of.length;
  }
  return {
    researcher: label,
    points: avg((i) => i.result!.points),
    right: avg((i) => +i.result!.right),
    cited: avg((i) => +i.result!.cited),
    actions: avg((i) => i.used),
    byKind,
    ...extra(),
  };
}

const rows: Row[] = [];
const rules = (k: ResearcherKind) => run(k, () => (v) => researcherAction(k, v));
if (which === 'all' || which === 'skimmer') rows.push(await rules('skimmer'));
if (which === 'all' || which === 'clerk') rows.push(await rules('clerk'));
if (which === 'all' || which === 'llm') {
  const meter = new UsageMeter();
  const model = new LLMResearcher(await makeProvider(provider, { noise, seed }), meter);
  let repaired = 0;
  let fallbacks = 0;
  rows.push(
    await run(
      `model (${provider}${noise ? `, noise ${noise}` : ''})`,
      (cat) => async (v) => {
        const r = await model.step(v, (id) => !!cat.open(id));
        if (r.repaired) repaired++;
        if (r.fallback) fallbacks++;
        return r.action;
      },
      () => ({ calls: meter.calls, repaired, fallbacks }),
    ),
  );
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
if (json) console.log(JSON.stringify(rows));
else {
  console.log(`${games} archives, 6 questions each, from seed ${seed}`);
  console.log('researcher                  points  right  cited  actions   year  holder  age  wedding  mother');
  for (const r of rows) {
    const k = r.byKind;
    const extra = r.calls !== undefined ? `  (${r.calls} model calls, ${r.repaired} repaired, ${r.fallbacks} fallbacks)` : '';
    console.log(
      `${r.researcher.padEnd(26)} ${r.points.toFixed(1).padStart(6)}  ${pct(r.right).padStart(5)}  ${pct(r.cited).padStart(5)}  ${r.actions.toFixed(1).padStart(7)}  ${pct(k.eventYear ?? 0).padStart(5)}  ${pct(k.holderAtEvent ?? 0).padStart(6)}  ${pct(k.ageAtEvent ?? 0).padStart(3)}  ${pct(k.holderAtWedding ?? 0).padStart(7)}  ${pct(k.motherOfHolder ?? 0).padStart(6)}${extra}`,
    );
  }
}
