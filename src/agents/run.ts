import type { Archive } from '../engine/docs.js';
import type { Question } from '../engine/questions.js';
import { newInquiry, perform, viewOf, type Action, type Inquiry, type InquiryView } from '../engine/research.js';
import type { Catalogue } from '../engine/search.js';

export type Chooser = (v: InquiryView) => Action | Promise<Action>;

/** Run one question to its answer. Stops a researcher that keeps erring. */
export async function runVisit(archive: Archive, cat: Catalogue, q: Question, choose: Chooser, onStep?: (inq: Inquiry) => void): Promise<Inquiry> {
  const inq = newInquiry(q);
  let errors = 0;
  for (let i = 0; i < 40 && !inq.result; i++) {
    const step = perform(archive, cat, inq, await choose(viewOf(inq)));
    if (step.error && ++errors >= 3) perform(archive, cat, inq, { kind: 'answer', answer: 'unknown', cite: [] });
    onStep?.(inq);
  }
  if (!inq.result) perform(archive, cat, inq, { kind: 'answer', answer: 'unknown', cite: [] });
  return inq;
}

/** The same, for researchers that answer at once (the built-in ones). */
export function runVisitSync(archive: Archive, cat: Catalogue, q: Question, choose: (v: InquiryView) => Action): Inquiry {
  const inq = newInquiry(q);
  let errors = 0;
  for (let i = 0; i < 40 && !inq.result; i++) {
    const step = perform(archive, cat, inq, choose(viewOf(inq)));
    if (step.error && ++errors >= 3) break;
  }
  if (!inq.result) perform(archive, cat, inq, { kind: 'answer', answer: 'unknown', cite: [] });
  return inq;
}
