import { clerkAction, researcherAction } from '../agents/researcher.js';
import { runVisitSync } from '../agents/run.js';
import { makeArchive, type Archive } from '../engine/docs.js';
import { BUDGET, factWords, makeQuestions, POINTS, type Question } from '../engine/questions.js';
import { actionProblem, newInquiry, openedIds, perform, viewOf, type Action, type Inquiry } from '../engine/research.js';
import { Catalogue, tokens } from '../engine/search.js';
import { makeWorld } from '../engine/world.js';

type Mode = 'play' | 'watch';

interface Thought {
  step: number;
  text: string;
  by: string;
}

interface UI {
  mode: Mode;
  seed: number;
  archive: Archive | null;
  cat: Catalogue | null;
  questions: Question[];
  visits: Inquiry[];
  /** The watched researcher's reasons, per question. */
  why: Thought[][];
  /** Which opened document the reader shows. */
  reading: string | null;
  /** 'clerk' for the built-in researcher, or a provider served by the local server. */
  model: string;
  notes: string;
  busy: boolean;
  auto: boolean;
  /** What the built-in researchers do on each question, for comparison. */
  bench: { clerk: Inquiry; skimmer: Inquiry }[];
}

const SAVE_KEY = 'archivist.save.v1';
const ui: UI = { mode: 'play', seed: 1, archive: null, cat: null, questions: [], visits: [], why: [], reading: null, model: 'clerk', notes: '', busy: false, auto: false, bench: [] };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Pause between steps when the researcher plays a question out. */
export const WATCH_DELAY = { ms: 450 };

const visit = (): Inquiry | undefined => ui.visits[ui.visits.length - 1];
const total = () => ui.visits.reduce((a, v) => a + (v.result?.points ?? 0), 0);

// ---- flow ------------------------------------------------------------------

export function start(mode: Mode, seed?: number): void {
  ui.mode = mode;
  ui.seed = seed ?? 1 + Math.floor(Math.random() * 100000);
  ui.archive = makeArchive(makeWorld(ui.seed));
  ui.cat = new Catalogue(ui.archive);
  ui.questions = makeQuestions(ui.archive);
  ui.visits = [newInquiry(ui.questions[0])];
  ui.why = [[]];
  ui.reading = null;
  ui.auto = false;
  ui.busy = false;
  ui.notes = '';
  ($('notes') as HTMLTextAreaElement).value = '';
  ui.bench = ui.questions.map((q) => ({
    clerk: runVisitSync(ui.archive!, ui.cat!, q, (v) => researcherAction('clerk', v)),
    skimmer: runVisitSync(ui.archive!, ui.cat!, q, (v) => researcherAction('skimmer', v)),
  }));
  show('game');
  render();
  save();
}

/** The player's action on the current question. Returns the problem if it can't be taken. */
export function act(a: Action): string | null {
  const v = visit();
  if (!v || !ui.archive || !ui.cat) return 'no visit under way';
  if (ui.mode !== 'play') return 'the researcher is at the desk';
  return take(a);
}

function take(a: Action): string | null {
  const v = visit()!;
  const problem = actionProblem(ui.cat!, v, a);
  if (problem) return problem;
  const step = perform(ui.archive!, ui.cat!, v, a);
  if (step.doc) ui.reading = step.doc.id;
  render();
  save();
  return null;
}

export function nextQuestion(): void {
  const v = visit();
  if (!v?.result) return;
  if (ui.visits.length >= ui.questions.length) return finish();
  ui.visits.push(newInquiry(ui.questions[ui.visits.length]));
  ui.why.push([]);
  ui.reading = null;
  ($('answer') as HTMLInputElement).value = '';
  render();
  save();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function researcherTurn(v: Inquiry): Promise<{ action: Action; thought: string; by: string }> {
  if (ui.model !== 'clerk') {
    try {
      const actions = v.steps.map((s) => s.action).filter((a) => a.kind !== 'answer');
      const r = await post<{ action: Action; thought: string; fallback: boolean }>('/api/researcher', { seed: ui.seed, question: v.question.id, actions, provider: ui.model });
      return { action: r.action, thought: r.thought, by: r.fallback ? 'clerk (the model reply could not be used)' : ui.model };
    } catch (err) {
      ui.why[ui.visits.length - 1].push({ step: v.steps.length, text: `The model researcher is unreachable (${(err as Error).message}); the clerk takes over.`, by: 'archive' });
      ui.model = 'clerk';
    }
  }
  const a = clerkAction(viewOf(v));
  return { action: a, thought: explain(a), by: 'clerk' };
}

function explain(a: Action): string {
  if (a.kind === 'search') return `Search the catalogue for "${a.query}".`;
  if (a.kind === 'open') return `Open ${a.doc} and read it through.`;
  return a.cite.length ? `Answer ${a.answer}, from ${a.cite.join(', ')}.` : `Out of leads: answer ${a.answer}.`;
}

export async function stepWatch(): Promise<void> {
  const v = visit();
  if (!v || v.result || ui.busy || ui.mode !== 'watch') return;
  ui.busy = true;
  render();
  const t = await researcherTurn(v);
  ui.busy = false;
  ui.why[ui.visits.length - 1].push({ step: v.steps.length, text: t.thought, by: t.by });
  if (take(t.action)) take(clerkAction(viewOf(v)));
}

export async function playOut(): Promise<void> {
  ui.auto = true;
  render();
  while (ui.auto && visit() && !visit()!.result) {
    await stepWatch();
    if (WATCH_DELAY.ms) await new Promise((r) => setTimeout(r, WATCH_DELAY.ms));
  }
  ui.auto = false;
  render();
}

function finish(): void {
  ui.auto = false;
  const vs = ui.visits;
  const bench = (k: 'clerk' | 'skimmer') => ui.bench.reduce((a, b) => a + b[k].result!.points, 0);
  const right = vs.filter((v) => v.result?.right).length;
  const who = ui.mode === 'play' ? 'You' : 'The researcher';
  $('verdict').textContent = `Archive ${ui.seed}: ${who.toLowerCase() === 'you' ? 'you' : 'the researcher'} answered ${right} of ${vs.length} right, for ${total()} points.`;
  const cell = (i: Inquiry) => `${i.result!.right ? 'right' : 'wrong'}${i.result!.cited ? ', cited' : ''}, ${i.used} ${i.used === 1 ? 'action' : 'actions'}: <b>${i.result!.points}</b>`;
  $('tally').innerHTML =
    `<tr><th>Question</th><th>${who}</th><th>Clerk</th><th>Skimmer</th></tr>` +
    vs
      .map(
        (v, i) =>
          `<tr><td>${esc(v.question.text)}<div class="ans">Answer: ${esc(v.question.answer)}</div></td><td>${cell(v)}</td><td>${cell(ui.bench[i].clerk)}</td><td>${cell(ui.bench[i].skimmer)}</td></tr>`,
      )
      .join('') +
    `<tr class="sum"><td>Total</td><td><b>${total()}</b></td><td><b>${bench('clerk')}</b></td><td><b>${bench('skimmer')}</b></td></tr>`;
  const c = bench('clerk');
  $('compare').textContent =
    ui.mode === 'play' ? (total() > c ? 'You beat the clerk.' : total() === c ? 'You tied with the clerk.' : `The clerk scores ${c - total()} more. It never skips a source, but it searches for things you might open by id.`) : '';
  show('result');
  localStorage.removeItem(SAVE_KEY);
}

// ---- drawing ---------------------------------------------------------------

function show(which: 'setup' | 'game' | 'result'): void {
  $('setup').hidden = which !== 'setup';
  $('game').hidden = which !== 'game';
  $('gauges').hidden = which !== 'game';
  $('result').hidden = which !== 'result';
}

/** The document text with the words of the latest search marked. */
function marked(text: string, query: string): string {
  const want = new Set(tokens(query));
  return text
    .split('\n')
    .map((line) => `<p>${esc(line).replace(/[A-Za-z0-9£]+/g, (w) => (want.size && tokens(w).some((t) => want.has(t)) ? `<mark>${w}</mark>` : w))}</p>`)
    .join('');
}

export function render(): void {
  const v = visit();
  if (!v || !ui.archive) return;
  const playing = ui.mode === 'play' && !v.result;
  $('qnum').textContent = `${ui.visits.length} of ${ui.questions.length}`;
  $('pips').innerHTML = Array.from({ length: BUDGET }, (_, i) => `<span class="${i < BUDGET - v.used ? 'on' : ''}"></span>`).join('');
  $('points').textContent = String(total());
  $('question').textContent = v.question.text;

  // The trail of searches and pages for this question, with the researcher's reasons.
  const why = ui.why[ui.visits.length - 1] ?? [];
  const items: string[] = [];
  const reasons = (i: number) => why.filter((w) => w.step === i).map((w) => `<li class="why"><span class="by">${esc(w.by)}</span> ${esc(w.text)}</li>`);
  v.steps.forEach((s, i) => {
    items.push(...reasons(i));
    if (s.action.kind === 'search') {
      const hits = (s.hits ?? [])
        .map((h) => {
          const read = openedIds(v).includes(h.id);
          return `<li class="hit${read ? ' read' : ''}"><button data-open="${esc(h.id)}" ${playing || read ? '' : 'disabled'}>${read ? 'Read' : 'Open'}</button><div><span class="id">${esc(h.id)}</span> ${esc(h.title)}<div class="snip">${esc(h.snippet)}</div></div></li>`;
        })
        .join('');
      items.push(`<li class="search"><div class="q">Searched “${esc(s.action.query)}”</div><ul class="hits">${hits || '<li class="none">Nothing found.</li>'}</ul></li>`);
    } else if (s.action.kind === 'open') {
      items.push(`<li class="opened">Opened <button class="link" data-read="${esc(s.action.doc)}">${esc(s.doc!.title)}</button></li>`);
    }
  });
  items.push(...reasons(v.steps.length));
  if (!items.length) items.push(`<li class="none">${ui.mode === 'play' ? 'Nothing searched yet. Start with the names and events in the question.' : 'The researcher has not started.'}</li>`);
  $('trail').innerHTML = items.join('');

  // The reader.
  const opened = v.steps.filter((s) => s.doc).map((s) => s.doc!);
  if (ui.reading && !opened.some((d) => d.id === ui.reading)) ui.reading = null;
  const doc = opened.find((d) => d.id === ui.reading) ?? opened[opened.length - 1];
  $('tabs').innerHTML = opened.map((d) => `<button class="tab${d === doc ? ' on' : ''}" data-read="${esc(d.id)}">${esc(d.id)}</button>`).join('');
  const lastQuery = [...v.steps].reverse().find((s) => s.action.kind === 'search')?.action as { query: string } | undefined;
  $('readertitle').textContent = doc ? doc.title : 'Reader';
  $('page').innerHTML = doc ? `<div class="docid">${esc(doc.id)}</div>${marked(doc.text, lastQuery?.query ?? '')}` : '<p class="empty">Open a document to read it here.</p>';

  // The answer form: cite boxes for each page opened this question.
  const cites = $('cites');
  const ticked = new Set([...cites.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value));
  cites.innerHTML =
    '<legend>Cite what the answer rests on</legend>' +
    (opened.length ? opened.map((d) => `<label class="check"><input type="checkbox" value="${esc(d.id)}" ${ticked.has(d.id) ? 'checked' : ''} ${playing ? '' : 'disabled'} /> ${esc(d.id)}</label>`).join('') : '<span class="none">Open a page to cite it.</span>');
  ($('answer') as HTMLInputElement).disabled = !playing;
  ($('answerbtn') as HTMLButtonElement).disabled = !playing;
  ($('query') as HTMLInputElement).disabled = !playing || v.used >= BUDGET;
  ($('openid') as HTMLInputElement).disabled = !playing || v.used >= BUDGET;
  $('answerform').hidden = ui.mode !== 'play';

  // The verdict on an answered question, beside the clerk's go at it.
  const box = $('verdictbox');
  box.hidden = !v.result;
  if (v.result) {
    const r = v.result;
    const c = ui.bench[ui.visits.length - 1].clerk.result!;
    const missing = r.missing.length && r.right ? `<p>Not cited: ${r.missing.map((k) => esc(factWords(ui.archive!, k))).join('; ')}.</p>` : '';
    box.innerHTML = `<p class="${r.right ? 'good' : 'bad'}"><b>${r.right ? 'Right' : 'Wrong'}</b>: ${esc(r.answer)}${r.right ? '' : `. The answer is ${esc(v.question.answer)}`}. ${r.points >= 0 ? '+' : ''}${r.points} points${r.cited ? ', sources cited' : ''}${r.spare ? `, ${r.spare} spare ${r.spare === 1 ? 'action' : 'actions'}` : ''}.</p>${missing}<p class="muted">${esc(v.question.answer)} rests on ${v.question.needs.map((k) => esc(factWords(ui.archive!, k))).join('; ')}. The clerk scored ${c.points} with ${ui.bench[ui.visits.length - 1].clerk.used} actions.</p>`;
  }
  const watching = ui.mode === 'watch';
  ($('step') as HTMLButtonElement).hidden = !watching || !!v.result;
  ($('auto') as HTMLButtonElement).hidden = !watching || !!v.result;
  ($('step') as HTMLButtonElement).disabled = ui.busy || ui.auto;
  ($('auto') as HTMLButtonElement).disabled = ui.auto;
  ($('nextq') as HTMLButtonElement).hidden = !v.result;
  ($('nextq') as HTMLButtonElement).textContent = ui.visits.length >= ui.questions.length ? 'See the results' : 'Next question';
}

// ---- saving ----------------------------------------------------------------

interface Saved {
  mode: Mode;
  seed: number;
  actions: Action[][];
  why: Thought[][];
  notes: string;
}

function save(): void {
  try {
    const s: Saved = { mode: ui.mode, seed: ui.seed, actions: ui.visits.map((v) => v.steps.map((s) => s.action)), why: ui.why, notes: ui.notes };
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: carry on without saving */
  }
}

function saved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Saved | null;
    return v && Number.isInteger(v.seed) && Array.isArray(v.actions) && (v.mode === 'play' || v.mode === 'watch') ? v : null;
  } catch {
    return null;
  }
}

/** Rebuild a visit from the saved actions: the archive comes from the seed. */
export function resume(): boolean {
  const s = saved();
  if (!s) return false;
  start(s.mode, s.seed);
  s.actions.forEach((actions, i) => {
    if (i > 0) {
      if (!visit()?.result || i >= ui.questions.length) return;
      ui.visits.push(newInquiry(ui.questions[i]));
      ui.why.push([]);
    }
    for (const a of actions) if (!actionProblem(ui.cat!, visit()!, a)) perform(ui.archive!, ui.cat!, visit()!, a);
  });
  ui.why = ui.visits.map((_, i) => (Array.isArray(s.why?.[i]) ? s.why[i] : []));
  ui.notes = typeof s.notes === 'string' ? s.notes : '';
  ($('notes') as HTMLTextAreaElement).value = ui.notes;
  render();
  save();
  return true;
}

// ---- wiring ----------------------------------------------------------------

async function detectServer(): Promise<void> {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const h = (await res.json()) as { providers?: string[] };
    const sel = $('model') as HTMLSelectElement;
    const opts = ['clerk', ...(h.providers ?? [])];
    sel.innerHTML = opts.map((p) => `<option value="${esc(p)}">${p === 'clerk' ? 'the clerk (built in)' : esc(p)}</option>`).join('');
    sel.onchange = () => (ui.model = sel.value);
    $('modelbox').hidden = false;
  } catch {
    /* opened as a file or without the server: the clerk only */
  }
}

function problem(text: string | null): void {
  $('answerproblem').textContent = text ?? '';
}

export function wire(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.mode')) b.onclick = () => start(b.dataset.mode as Mode, Number(($('seed') as HTMLInputElement).value) || undefined);
  $('continue').hidden = !saved();
  $('continue').onclick = () => void resume();
  $('searchform').onsubmit = (e) => {
    e.preventDefault();
    const q = $('query') as HTMLInputElement;
    const p = act({ kind: 'search', query: q.value });
    problem(p);
    if (!p) q.value = '';
  };
  $('openform').onsubmit = (e) => {
    e.preventDefault();
    const q = $('openid') as HTMLInputElement;
    const id = q.value.trim().toLowerCase();
    const p = visit() && openedIds(visit()!).includes(id) ? null : act({ kind: 'open', doc: id });
    if (!p) {
      ui.reading = id;
      q.value = '';
      render();
    }
    problem(p);
  };
  $('trail').onclick = (e) => {
    const t = e.target as HTMLElement;
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) {
      const id = open.dataset.open!;
      if (visit() && openedIds(visit()!).includes(id)) {
        ui.reading = id;
        render();
      } else problem(act({ kind: 'open', doc: id }));
      return;
    }
    const read = t.closest<HTMLElement>('[data-read]');
    if (read) {
      ui.reading = read.dataset.read!;
      render();
    }
  };
  $('tabs').onclick = (e) => {
    const read = (e.target as HTMLElement).closest<HTMLElement>('[data-read]');
    if (read) {
      ui.reading = read.dataset.read!;
      render();
    }
  };
  $('answerform').onsubmit = (e) => {
    e.preventDefault();
    const cite = [...$('cites').querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
    problem(act({ kind: 'answer', answer: ($('answer') as HTMLInputElement).value, cite }));
  };
  ($('notes') as HTMLTextAreaElement).oninput = (e) => {
    ui.notes = (e.target as HTMLTextAreaElement).value;
    save();
  };
  $('step').onclick = () => void stepWatch();
  $('auto').onclick = () => void playOut();
  $('nextq').onclick = nextQuestion;
  const leave = () => {
    ui.auto = false;
    show('setup');
    $('continue').hidden = !saved();
  };
  $('quit').onclick = leave;
  $('back').onclick = leave;
  $('again').onclick = () => start(ui.mode, ui.seed);
  $('next').onclick = () => start(ui.mode);
  void detectServer();
}

export const getUI = () => ui;
export { POINTS };

if (typeof window !== 'undefined' && document.getElementById('setup')) wire();
