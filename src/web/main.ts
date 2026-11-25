import { clerkAction, researcherAction } from '../agents/researcher.js';
import { runVisitSync } from '../agents/run.js';
import { makeArchive, type Archive } from '../engine/docs.js';
import { BUDGET, factWords, makeQuestions, POINTS, type Question } from '../engine/questions.js';
import { actionIssue, newInquiry, openedIds, perform, viewOf, type Action, type Inquiry } from '../engine/research.js';
import { Catalogue, foldZh, tokens } from '../engine/search.js';
import { makeWorld } from '../engine/world.js';
import { asLang, type Lang } from '../i18n/lang.js';
import { S, setUiLang, uiLang } from './strings.js';

type Mode = 'play' | 'watch';

/**
 * One line of the researcher's reasoning. The clerk's steps keep the action,
 * so they are worded again in whatever language the interface speaks; a
 * model's thought keeps the words it was given.
 */
interface Thought {
  step: number;
  by: string;
  text?: string;
  action?: Action;
  fallback?: boolean;
  unreachable?: string;
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
  screen: 'setup' | 'game' | 'result';
}

const SAVE_KEY = 'archivist.save.v1';
const LANG_KEY = 'archivist.lang';
const ui: UI = { mode: 'play', seed: 1, archive: null, cat: null, questions: [], visits: [], why: [], reading: null, model: 'clerk', notes: '', busy: false, auto: false, bench: [], screen: 'setup' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const htmlLang = (l: Lang) => (l === 'zh' ? 'zh-CN' : 'en');
/** Pause between steps when the researcher plays a question out. */
export const WATCH_DELAY = { ms: 450 };

const visit = (): Inquiry | undefined => ui.visits[ui.visits.length - 1];
const total = () => ui.visits.reduce((a, v) => a + (v.result?.points ?? 0), 0);
const archiveLang = (): Lang => ui.archive?.lang ?? uiLang();

// ---- language --------------------------------------------------------------

function initialLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl) return asLang(fromUrl);
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved) return asLang(saved);
  } catch {
    // Storage can be blocked; fall back to the browser's language.
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Words that live in the static page. */
function applyStatic(): void {
  const s = S() as unknown as Record<string, unknown>;
  const lang = uiLang();
  document.documentElement.lang = htmlLang(lang);
  document.body.dataset.lang = lang;
  document.title = S().docTitle;
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = String(s[el.dataset.t!] ?? '');
  for (const el of document.querySelectorAll<HTMLElement>('[data-t-ph]')) el.setAttribute('placeholder', String(s[el.dataset.tPh!] ?? ''));
  for (const el of document.querySelectorAll<HTMLElement>('[data-t-aria]')) el.setAttribute('aria-label', String(s[el.dataset.tAria!] ?? ''));
  for (const b of document.querySelectorAll<HTMLButtonElement>('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  $('rules').innerHTML = S()
    .rules.map((r) => `<li><span>${esc(r).replace(/`([^`]+)`/g, '<code>$1</code>')}</span></li>`)
    .join('');
  fillModels();
}

/**
 * Switching language changes the interface at once. An archive already open
 * stays in the language it was written in; the next one is written in the new
 * language (that includes "Same archive again", which writes the same seed
 * afresh).
 */
export function switchLang(lang: Lang): void {
  if (lang === uiLang()) return;
  setUiLang(lang);
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not saved; the switch still applies to this visit.
  }
  applyStatic();
  langNote();
  if (ui.screen === 'game') render();
  if (ui.screen === 'result') finish();
}

function langNote(): void {
  const note = $('langnote');
  const differs = ui.screen !== 'setup' && !!ui.archive && ui.archive.lang !== uiLang();
  note.hidden = !differs;
  note.textContent = differs ? S().archiveIn(ui.archive!.lang, uiLang()) : '';
}

// ---- flow ------------------------------------------------------------------

export function start(mode: Mode, seed?: number, lang: Lang = uiLang()): void {
  ui.mode = mode;
  ui.seed = seed ?? 1 + Math.floor(Math.random() * 100000);
  ui.archive = makeArchive(makeWorld(ui.seed), lang);
  ui.cat = new Catalogue(ui.archive);
  ui.questions = makeQuestions(ui.archive);
  ui.visits = [newInquiry(ui.questions[0])];
  ui.why = [[]];
  ui.reading = null;
  ui.auto = false;
  ui.busy = false;
  ui.notes = '';
  ($('notes') as HTMLTextAreaElement).value = '';
  ($('answer') as HTMLInputElement).value = '';
  problem(null);
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
  if (!v || !ui.archive || !ui.cat) return S().noVisit;
  if (ui.mode !== 'play') return S().watching;
  return take(a);
}

function take(a: Action): string | null {
  const v = visit()!;
  const code = actionIssue(ui.cat!, v, a);
  if (code) return S().problem[code](a.kind === 'open' ? a.doc : '');
  const step = perform(ui.archive!, ui.cat!, v, a);
  if (step.doc) {
    ui.reading = step.doc.id;
    render();
    toSheet();
  } else render();
  save();
  return null;
}

/** On a phone the sheet sits below the catalogue: bring it into view when a page is opened. */
function toSheet(): void {
  if (ui.mode === 'play' && window.matchMedia?.('(max-width: 760px)').matches) document.querySelector('.sheet')?.scrollIntoView?.({ block: 'start' });
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

async function researcherTurn(v: Inquiry): Promise<Thought & { action: Action }> {
  const step = v.steps.length;
  if (ui.model !== 'clerk') {
    try {
      const actions = v.steps.map((s) => s.action).filter((a) => a.kind !== 'answer');
      const r = await post<{ action: Action; thought: string; fallback: boolean }>('/api/researcher', { seed: ui.seed, lang: archiveLang(), question: v.question.id, actions, provider: ui.model });
      return r.fallback ? { step, by: 'clerk', fallback: true, action: r.action } : { step, by: ui.model, text: r.thought, action: r.action };
    } catch (err) {
      ui.why[ui.visits.length - 1].push({ step, by: 'archive', unreachable: (err as Error).message });
      ui.model = 'clerk';
    }
  }
  return { step, by: 'clerk', action: clerkAction(viewOf(v)) };
}

function explain(a: Action): string {
  const t = S().think;
  if (a.kind === 'search') return t.search(a.query);
  if (a.kind === 'open') return t.open(a.doc);
  return a.cite.length ? t.answer(a.answer, a.cite.join(', ')) : t.out(a.answer);
}

/** Who gave a reason and its words; a model's own words are in the archive's language. */
function thoughtText(w: Thought): { by: string; text: string; lang: Lang } {
  const s = S();
  if (w.unreachable !== undefined) return { by: s.byArchive, text: s.unreachable(w.unreachable), lang: uiLang() };
  if (w.by === 'clerk') return { by: w.fallback ? s.byFallback : s.byClerk, text: w.text ?? (w.action ? explain(w.action) : ''), lang: uiLang() };
  if (w.by === 'archive') return { by: s.byArchive, text: w.text ?? '', lang: uiLang() };
  return { by: w.by, text: w.text ?? '', lang: archiveLang() };
}

export async function stepWatch(): Promise<void> {
  const v = visit();
  if (!v || v.result || ui.busy || ui.mode !== 'watch') return;
  ui.busy = true;
  render();
  const t = await researcherTurn(v);
  ui.busy = false;
  ui.why[ui.visits.length - 1].push(t);
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
  const s = S();
  const vs = ui.visits;
  const bench = (k: 'clerk' | 'skimmer') => ui.bench.reduce((a, b) => a + b[k].result!.points, 0);
  const right = vs.filter((v) => v.result?.right).length;
  const you = ui.mode === 'play';
  const aLang = htmlLang(archiveLang());
  $('verdict').textContent = s.verdictTitle(ui.seed, you, right, vs.length, total());
  $('finalstamp').textContent = s.finalStamp(right, vs.length);
  const t = s.tally;
  const cell = (label: string, i: Inquiry) => `<td data-label="${esc(label)}">${esc(s.cell(i.result!.right, i.result!.cited, i.used))}: <b>${i.result!.points}</b></td>`;
  const who = you ? t.you : t.researcher;
  $('tally').innerHTML =
    `<thead><tr><th>${esc(t.question)}</th><th>${esc(who)}</th><th>${esc(t.clerk)}</th><th>${esc(t.skimmer)}</th></tr></thead><tbody>` +
    vs
      .map(
        (v, i) =>
          `<tr><td class="qcell"><span class="callno">Q${i + 1}</span> <span lang="${aLang}">${esc(v.question.text)}</span><div class="ans">${esc(s.answerIs(v.question.answer))}</div></td>${cell(who, v)}${cell(t.clerk, ui.bench[i].clerk)}${cell(t.skimmer, ui.bench[i].skimmer)}</tr>`,
      )
      .join('') +
    `<tr class="sum"><td>${esc(t.total)}</td><td data-label="${esc(who)}"><b>${total()}</b></td><td data-label="${esc(t.clerk)}"><b>${bench('clerk')}</b></td><td data-label="${esc(t.skimmer)}"><b>${bench('skimmer')}</b></td></tr></tbody>`;
  $('compare').textContent = you ? s.compare(total(), bench('clerk')) : '';
  show('result');
  localStorage.removeItem(SAVE_KEY);
}

// ---- drawing ---------------------------------------------------------------

function show(which: 'setup' | 'game' | 'result'): void {
  ui.screen = which;
  document.body.dataset.screen = which;
  $('setup').hidden = which !== 'setup';
  $('game').hidden = which !== 'game';
  $('gauges').hidden = which !== 'game';
  $('result').hidden = which !== 'result';
  langNote();
}

/** A catalogue call number for a document, from its id and title: REG·BAP·1850, LED·MILL, LET·1861·04, GAZ·1851·FLO. */
export function callNumber(id: string, title = ''): string {
  const year = title.match(/(\d{4})(?: ?年)?$/)?.[1];
  let m = id.match(/^(bap|mar|bur)-(\d{4})$/);
  if (m) return `REG·${m[1].toUpperCase()}·${m[2]}`;
  m = id.match(/^ledger-(\w+)$/);
  if (m) return `LED·${m[1].toUpperCase()}`;
  m = id.match(/^letter-(\d+)$/);
  if (m) return `LET·${year ? `${year}·` : ''}${m[1].padStart(2, '0')}`;
  m = id.match(/^gazette-(\w+)$/);
  if (m) return `GAZ·${year ? `${year}·` : ''}${m[1].slice(0, 3).toUpperCase()}`;
  return id.toUpperCase();
}

/** Which series a document belongs to, from its id. */
const seriesOf = (id: string): string => {
  const m = id.match(/^(bap|mar|bur|ledger|letter|gazette)-/);
  return m ? m[1] : 'letter';
};

/** The document text with the words of the latest search marked. */
function marked(text: string, query: string): string {
  const want = new Set(tokens(query));
  // Chinese is marked by the pairs of characters the search matched on, or a
  // single character when that was the whole search word.
  const pairs = new Set<string>();
  const singles = new Set<string>();
  for (const run of `${query} ${foldZh(query)}`.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) singles.add(run);
    for (let i = 1; i < run.length; i++) pairs.add(run.slice(i - 1, i + 1));
  }
  const markZh = (run: string): string => {
    const on = run.split('').map((c) => singles.has(c));
    for (let i = 0; i + 1 < run.length; i++) if (pairs.has(run.slice(i, i + 2))) on[i] = on[i + 1] = true;
    return run
      .split('')
      .map((c, i) => `${on[i] && !on[i - 1] ? '<mark>' : ''}${c}${on[i] && !on[i + 1] ? '</mark>' : ''}`)
      .join('');
  };
  const mk = (part: string) =>
    esc(part).replace(/[A-Za-z0-9£]+|[\u4e00-\u9fff]+/g, (w) =>
      /[\u4e00-\u9fff]/.test(w) ? markZh(w) : want.size && tokens(w).some((t) => want.has(t)) ? `<mark>${w}</mark>` : w,
    );
  return text
    .split('\n')
    .map((line) => {
      // Register and ledger entries begin with their year: "1850. …" or "1850 年。…".
      const m = line.match(/^(\d{4}(?:\. | ?年。))(.*)$/);
      return m ? `<p class="entry"><span class="yr">${mk(m[1])}</span><span>${mk(m[2])}</span></p>` : `<p>${mk(line)}</p>`;
    })
    .join('');
}

function renderLedger(v: Inquiry): void {
  const aLang = htmlLang(archiveLang());
  $('qledger').innerHTML = ui.questions
    .map((q, i) => {
      const done = ui.visits[i]?.result;
      const current = i === ui.visits.length - 1 && !done;
      const state = done ? (done.right ? (done.cited ? 'cited' : 'right') : 'wrong') : current ? 'current' : 'pending';
      const reached = i < ui.visits.length;
      const mark = done ? `${done.points >= 0 ? '+' : ''}${done.points}` : current ? '…' : '';
      return `<li class="q-row ${state}${ui.visits[i] === v ? ' here' : ''}"><span class="callno">Q${i + 1}</span><span class="q-text"${reached ? ` lang="${aLang}"` : ''}>${reached ? esc(q.text) : esc(S().pending)}</span><span class="q-mark">${mark}</span></li>`;
    })
    .join('');
}

export function render(): void {
  const v = visit();
  if (!v || !ui.archive) return;
  const s = S();
  const aLang = htmlLang(archiveLang());
  const playing = ui.mode === 'play' && !v.result;
  const qi = ui.visits.length;
  $('qnum').textContent = s.qOf(qi, ui.questions.length);
  $('pips').innerHTML = Array.from({ length: BUDGET }, (_, i) => `<span class="${i < BUDGET - v.used ? 'on' : ''}"></span>`).join('');
  $('pips').setAttribute('aria-label', String(BUDGET - v.used));
  $('points').textContent = String(total());
  $('qcall').textContent = `Q${qi} · ${ui.seed}`;
  $('question').textContent = v.question.text;
  $('question').lang = aLang;
  renderLedger(v);

  // The trail of searches and pages for this question, with the researcher's reasons.
  const why = ui.why[qi - 1] ?? [];
  const items: string[] = [];
  const reasons = (i: number) =>
    why
      .filter((w) => w.step === i)
      .map((w) => {
        const t = thoughtText(w);
        return `<li class="why"><span class="by label">${esc(t.by)}</span> <span lang="${htmlLang(t.lang)}">${esc(t.text)}</span></li>`;
      });
  v.steps.forEach((st, i) => {
    items.push(...reasons(i));
    if (st.action.kind === 'search') {
      const hits = (st.hits ?? [])
        .map((h) => {
          const read = openedIds(v).includes(h.id);
          return `<li class="hit${read ? ' read' : ''}"><div class="card-top"><span class="callno">${esc(callNumber(h.id, h.title))}</span><span class="docid">${esc(h.id)}</span></div><div class="card-title" lang="${aLang}">${esc(h.title)}</div><div class="snip" lang="${aLang}">${esc(h.snippet)}</div><button type="button" data-open="${esc(h.id)}" ${playing || read ? '' : 'disabled'}>${esc(read ? s.hitRead : s.hitOpen)}</button></li>`;
        })
        .join('');
      items.push(
        `<li class="search"><div class="q"><span class="label">${esc(s.searched)}</span> <span class="query">“${esc(st.action.query)}”</span></div><ul class="hits">${hits || `<li class="none">${esc(s.nothingFound)}</li>`}</ul></li>`,
      );
    } else if (st.action.kind === 'open') {
      items.push(`<li class="opened"><span class="label">${esc(s.opened)}</span> <button type="button" class="link" data-read="${esc(st.action.doc)}" lang="${aLang}">${esc(st.doc!.title)}</button></li>`);
    }
  });
  items.push(...reasons(v.steps.length));
  if (!items.length) items.push(`<li class="none">${esc(ui.mode === 'play' ? s.trailEmptyPlay : s.trailEmptyWatch)}</li>`);
  $('trail').innerHTML = items.join('');

  // The reader: tabs for each page opened, the chosen one laid out as a sheet.
  const opened = v.steps.filter((st) => st.doc).map((st) => st.doc!);
  if (ui.reading && !opened.some((d) => d.id === ui.reading)) ui.reading = null;
  const doc = opened.find((d) => d.id === ui.reading) ?? opened[opened.length - 1];
  $('tabs').innerHTML = opened.map((d) => `<button type="button" class="tab${d === doc ? ' on' : ''}" data-read="${esc(d.id)}">${esc(d.id)}</button>`).join('');
  const lastQuery = [...v.steps].reverse().find((st) => st.action.kind === 'search')?.action as { query: string } | undefined;
  $('readertitle').textContent = doc ? doc.title : s.readerEmptyTitle;
  $('readertitle').lang = doc ? aLang : htmlLang(uiLang());
  const sheet = document.querySelector<HTMLElement>('.sheet')!;
  sheet.classList.toggle('empty', !doc);
  if (doc) {
    const full = ui.cat!.open(doc.id);
    const series = seriesOf(doc.id);
    const decade = doc.id.match(/^(?:bap|mar|bur)-(\d{4})$/);
    const date = full?.year ? String(full.year) : decade ? s.decade(Number(decade[1])) : series === 'ledger' ? s.ledgerSpan : '—';
    const row = (k: string, val: string, cls = '') => `<div><dt class="label">${esc(k)}</dt><dd class="${cls}">${esc(val)}</dd></div>`;
    $('sheetmeta').innerHTML = row(s.meta.series, s.series[series] ?? series) + row(s.meta.date, date) + row(s.meta.call, callNumber(doc.id, doc.title), 'callno') + row(s.meta.id, doc.id, 'docid');
    $('page').innerHTML = marked(doc.text, lastQuery?.query ?? '');
    $('page').lang = aLang;
    sheet.dataset.series = series;
  } else {
    $('sheetmeta').innerHTML = '';
    $('page').innerHTML = `<p class="empty">${esc(s.pageEmpty)}</p>`;
    $('page').lang = htmlLang(uiLang());
    delete sheet.dataset.series;
  }

  // The answer form: a slip for each page opened this question.
  const cites = $('cites');
  const ticked = new Set([...cites.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value));
  cites.innerHTML =
    `<legend class="label">${esc(s.citeLegend)}</legend>` +
    (opened.length
      ? opened
          .map(
            (d) =>
              `<label class="slip"><input type="checkbox" value="${esc(d.id)}" ${ticked.has(d.id) ? 'checked' : ''} ${playing ? '' : 'disabled'} /><span class="callno">${esc(callNumber(d.id, d.title))}</span><span class="docid">${esc(d.id)}</span></label>`,
          )
          .join('')
      : `<span class="none">${esc(s.citeNone)}</span>`);
  ($('answer') as HTMLInputElement).disabled = !playing;
  ($('answerbtn') as HTMLButtonElement).disabled = !playing;
  ($('query') as HTMLInputElement).disabled = !playing || v.used >= BUDGET;
  ($('openid') as HTMLInputElement).disabled = !playing || v.used >= BUDGET;
  $('answerform').hidden = ui.mode !== 'play' || !!v.result;

  // The verdict on an answered question, stamped, beside the clerk's go at it.
  const box = $('verdictbox');
  box.hidden = !v.result;
  if (v.result) {
    const r = v.result;
    const bench = ui.bench[qi - 1].clerk;
    const facts = (keys: string[]) => keys.map((k) => factWords(ui.archive!, k, uiLang())).join(s.listJoin);
    const stamp = r.right ? (r.cited ? s.stamp.cited : s.stamp.right) : s.stamp.wrong;
    const slips = r.cite.length
      ? `<div class="cited"><span class="label">${esc(s.citedLabel)}</span>${r.cite.map((c) => `<span class="slip small"><span class="callno">${esc(callNumber(c, ui.cat!.open(c)?.title ?? ''))}</span></span>`).join('')}</div>`
      : '';
    box.className = `verdictbox ${r.right ? 'good' : 'bad'}`;
    box.innerHTML =
      `<div class="stamp ${r.right ? (r.cited ? 'cited' : 'right') : 'wrong'}">${esc(stamp)}</div>` +
      `<p class="verdict-line"><b>${esc(r.right ? s.verdictRight : s.verdictWrong)}</b>${uiLang() === 'zh' ? '：' : ': '}${esc(s.verdictLine(r.right, r.answer, v.question.answer, r.points, r.cited, r.spare))}</p>` +
      (r.right && r.missing.length ? `<p>${esc(s.notCited(facts(r.missing)))}</p>` : '') +
      slips +
      `<p class="muted">${esc(s.restsOn(v.question.answer, facts(v.question.needs), bench.result!.points, bench.used))}</p>`;
  }
  const watching = ui.mode === 'watch';
  $('busy').hidden = !ui.busy;
  $('busy').textContent = ui.busy ? s.busy : '';
  ($('step') as HTMLButtonElement).hidden = !watching || !!v.result;
  ($('auto') as HTMLButtonElement).hidden = !watching || !!v.result;
  ($('step') as HTMLButtonElement).disabled = ui.busy || ui.auto;
  ($('auto') as HTMLButtonElement).disabled = ui.auto;
  ($('nextq') as HTMLButtonElement).hidden = !v.result;
  ($('nextq') as HTMLButtonElement).textContent = ui.visits.length >= ui.questions.length ? s.seeResults : s.nextQ;
}

// ---- saving ----------------------------------------------------------------

interface Saved {
  mode: Mode;
  seed: number;
  /** The language the archive was written in. */
  lang?: Lang;
  actions: Action[][];
  why: Thought[][];
  notes: string;
}

function save(): void {
  try {
    const s: Saved = { mode: ui.mode, seed: ui.seed, lang: archiveLang(), actions: ui.visits.map((v) => v.steps.map((st) => st.action)), why: ui.why, notes: ui.notes };
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

/** Rebuild a visit from the saved actions: the archive comes from the seed, in the language it was written in. */
export function resume(): boolean {
  const s = saved();
  if (!s) return false;
  start(s.mode, s.seed, asLang(s.lang));
  s.actions.forEach((actions, i) => {
    if (i > 0) {
      if (!visit()?.result || i >= ui.questions.length) return;
      ui.visits.push(newInquiry(ui.questions[i]));
      ui.why.push([]);
    }
    for (const a of actions) if (!actionIssue(ui.cat!, visit()!, a)) perform(ui.archive!, ui.cat!, visit()!, a);
  });
  ui.why = ui.visits.map((_, i) => (Array.isArray(s.why?.[i]) ? s.why[i] : []));
  ui.notes = typeof s.notes === 'string' ? s.notes : '';
  ($('notes') as HTMLTextAreaElement).value = ui.notes;
  render();
  save();
  return true;
}

// ---- wiring ----------------------------------------------------------------

let providers: string[] | null = null;

function fillModels(): void {
  if (!providers) return;
  const sel = $('model') as HTMLSelectElement;
  const opts = ['clerk', ...providers];
  sel.innerHTML = opts.map((p) => `<option value="${esc(p)}">${p === 'clerk' ? esc(S().clerkBuiltIn) : esc(p)}</option>`).join('');
  sel.value = opts.includes(ui.model) ? ui.model : 'clerk';
}

async function detectServer(): Promise<void> {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const h = (await res.json()) as { providers?: string[] };
    providers = h.providers ?? [];
    fillModels();
    const sel = $('model') as HTMLSelectElement;
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
  setUiLang(initialLang());
  applyStatic();
  for (const b of document.querySelectorAll<HTMLButtonElement>('.lang button')) b.onclick = () => switchLang(asLang(b.dataset.lang));
  for (const b of document.querySelectorAll<HTMLButtonElement>('.mode')) b.onclick = () => start(b.dataset.mode as Mode, Number(($('seed') as HTMLInputElement).value) || undefined);
  ($('seed') as HTMLInputElement).oninput = (e) => {
    const n = (e.target as HTMLInputElement).value.replace(/\D/g, '');
    $('ticketno').textContent = n ? n.padStart(4, '0') : '0001';
  };
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
        toSheet();
      } else problem(act({ kind: 'open', doc: id }));
      return;
    }
    const read = t.closest<HTMLElement>('[data-read]');
    if (read) {
      ui.reading = read.dataset.read!;
      render();
      toSheet();
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
