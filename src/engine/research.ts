import type { Archive } from './docs.js';
import { BUDGET, grade, type Grade, type Question } from './questions.js';
import { Catalogue, type Hit } from './search.js';

// One visit to the reading room for one question: searches and openings cost
// an action each, and the visit ends with an answer and its citations.

export type Action =
  | { kind: 'search'; query: string }
  | { kind: 'open'; doc: string }
  | { kind: 'answer'; answer: string; cite: string[] };

export interface OpenedDoc {
  id: string;
  title: string;
  text: string;
}

export interface Step {
  action: Action;
  hits?: Hit[];
  doc?: OpenedDoc;
  error?: string;
}

export interface Inquiry {
  question: Question;
  steps: Step[];
  used: number;
  result: (Grade & { answer: string; cite: string[] }) | null;
}

/** What a researcher may see: never the answer or the facts it needs. */
export interface InquiryView {
  question: { id: number; text: string; answerType: 'name' | 'number' };
  steps: Step[];
  used: number;
  budget: number;
}

export const newInquiry = (question: Question): Inquiry => ({ question, steps: [], used: 0, result: null });

export const viewOf = (q: Inquiry): InquiryView => ({
  question: { id: q.question.id, text: q.question.text, answerType: q.question.answerType },
  steps: q.steps,
  used: q.used,
  budget: BUDGET,
});

/** Why an action can't be taken now, or null if it can. */
export function actionProblem(cat: Catalogue, q: Inquiry, a: Action): string | null {
  if (q.result) return 'this question is already answered';
  if (a.kind === 'answer') {
    if (!a.answer.trim()) return 'the answer is empty';
    return null;
  }
  if (q.used >= BUDGET) return 'the reading room is closing: answer now';
  if (a.kind === 'search' && !a.query.trim()) return 'the search is empty';
  if (a.kind === 'open' && !cat.open(a.doc)) return `there is no document "${a.doc}"`;
  return null;
}

/** Take an action. Returns the new step; an answer also sets the result. */
export function perform(archive: Archive, cat: Catalogue, q: Inquiry, a: Action): Step {
  const problem = actionProblem(cat, q, a);
  if (problem) return { action: a, error: problem };
  let step: Step;
  if (a.kind === 'search') {
    q.used++;
    step = { action: a, hits: cat.search(a.query) };
  } else if (a.kind === 'open') {
    q.used++;
    const d = cat.open(a.doc)!;
    step = { action: a, doc: { id: d.id, title: d.title, text: d.text } };
  } else {
    const cite = [...new Set(a.cite)];
    q.result = { ...grade(archive, q.question, a.answer, cite, q.used), answer: a.answer, cite };
    step = { action: { ...a, cite } };
  }
  q.steps.push(step);
  return step;
}

/** The ids of documents opened so far in this visit. */
export const openedIds = (v: { steps: Step[] }): string[] => v.steps.filter((s) => s.doc).map((s) => s.doc!.id);
