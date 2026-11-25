import type { Archive, Doc } from './docs.js';

// The reading-room catalogue: plain keyword search (BM25) over titles and
// text, returning a few documents with the line that matched best.

export interface Hit {
  id: string;
  title: string;
  snippet: string;
}

export const MAX_HITS = 6;
const STOP = new Set('a an and the of in to was is it at by for on as who what whom whose which year years how old were did had has have with from this that be when'.split(' '));

export const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/£/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);

/** A light stemmer, so "married" finds "marriages" and "buried" finds "burials". */
function stem(t: string): string {
  if (/^\d+$/.test(t)) return t;
  const irregular: Record<string, string> = { wed: 'marri', married: 'marri', marriage: 'marri', marriages: 'marri', marry: 'marri', buried: 'buri', burial: 'buri', burials: 'buri', baptism: 'bapt', baptisms: 'bapt', baptised: 'bapt', born: 'bapt', bought: 'sold', sold: 'sold' };
  if (irregular[t]) return irregular[t];
  return t.replace(/(ies|es|s)$/, '').replace(/(ing|ed)$/, '') || t;
}

export class Catalogue {
  private index: { doc: Doc; tf: Map<string, number>; pairs: Set<string>; len: number }[];
  private df = new Map<string, number>();
  private avg: number;

  constructor(readonly archive: Archive) {
    this.index = archive.docs.map((doc) => {
      const ts = tokens(`${doc.title} ${doc.title} ${doc.text}`);
      const tf = new Map<string, number>();
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { doc, tf, pairs: pairsOf(ts), len: ts.length };
    });
    this.avg = this.index.reduce((a, d) => a + d.len, 0) / Math.max(1, this.index.length);
  }

  search(query: string, limit = MAX_HITS): Hit[] {
    const all = tokens(query);
    const q = [...new Set(all)];
    if (!q.length) return [];
    const qPairs = [...pairsOf(all)];
    const N = this.index.length;
    const scored = this.index
      .map(({ doc, tf, pairs, len }) => {
        // Words that sit together in the query and the document (a name) count extra.
        let s = qPairs.filter((p) => pairs.has(p)).length * 1.5;
        for (const t of q) {
          const f = tf.get(t) ?? 0;
          if (!f) continue;
          const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
          s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len / this.avg)));
        }
        return { doc, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.doc.id < b.doc.id ? -1 : 1))
      .slice(0, limit);
    return scored.map(({ doc }) => ({ id: doc.id, title: doc.title, snippet: snippet(doc, q) }));
  }

  open(id: string): Doc | undefined {
    return this.archive.docs.find((d) => d.id === id);
  }
}

/** The line of a document that holds the most query words, trimmed. */
export function snippet(doc: Doc, q: string[]): string {
  const lines = doc.text.split('\n');
  const qPairs = [...pairsOf(q)];
  let best = lines[0];
  let bestScore = -1;
  for (const line of lines) {
    const all = tokens(line);
    const ts = new Set(all);
    const pairs = pairsOf(all);
    const s = q.filter((t) => ts.has(t)).length + qPairs.filter((p) => pairs.has(p)).length * 2;
    if (s > bestScore) {
      best = line;
      bestScore = s;
    }
  }
  return best.length > 140 ? `${best.slice(0, 137)}...` : best;
}

function pairsOf(ts: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < ts.length; i++) out.add(`${ts[i - 1]} ${ts[i]}`);
  return out;
}
