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

/** Latin words: lower case, stop words dropped, lightly stemmed. */
const latinTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/£/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);

/**
 * Chinese has no spaces between words, so the catalogue reads it in
 * overlapping pairs of characters ("磨坊产业簿" is 磨坊 坊产 产业 业簿). A run of
 * one character stands for itself. A few words are folded into the one the
 * archive uses, the way the stemmer folds "married" into "marriages".
 */
const CJK_RUN = /[\u4e00-\u9fff]+/g;
const ZH_FOLD: [RegExp, string][] = [
  [/出生|生于|诞生|生年|受洗/g, '洗礼'],
  [/结婚|成亲|婚礼|出嫁|嫁给|娶了|婚配|嫁娶/g, '成婚'],
  [/安葬|埋葬|葬礼|去世|过世|死亡|身故|逝世|葬于/g, '下葬'],
  [/买下|购得|买入|卖给|卖出|出售|转卖|购买/g, '售予'],
  [/账簿|账本|地契|契簿|产业册|产权簿/g, '产业簿'],
  [/报纸|报上|周报|村报/g, '公报'],
  [/信件|书信|家书/g, '来信'],
  [/洪水|水灾|发大水|涨水|决堤/g, '大水'],
  [/火灾|失火|起火|着火|烧了起来/g, '大火'],
  [/时疫|瘟疫|疫病/g, '霍乱'],
  [/大桥|石桥/g, '新桥'],
  [/寒冬|大寒|冬天|酷寒/g, '严冬'],
  [/磨房/g, '磨坊'],
  [/酒馆|旅店|客店/g, '客栈'],
  [/打铁铺|铁匠(?!铺)/g, '铁匠铺'],
  [/渡船|摆渡/g, '渡口'],
];
/** Question words that say nothing about which document holds the answer. */
const ZH_STOP = new Set('那一 一年 哪一 是在 在哪 归谁 谁所 多少 少岁 是谁 的人 按年 年份 份算 减去 那年 什么 时候 哪年'.split(' '));

export const foldZh = (text: string): string => ZH_FOLD.reduce((t, [re, to]) => t.replace(re, to), text);

function cjkTokens(run: string): string[] {
  if (run.length === 1) return [run];
  const out: string[] = [];
  for (let i = 1; i < run.length; i++) {
    const b = run.slice(i - 1, i + 1);
    if (!ZH_STOP.has(b)) out.push(b);
  }
  return out;
}

/**
 * The words of a text, in order: Latin words as before, Chinese as character
 * pairs (a single character only when it stands alone, as in a one-character
 * query).
 */
export const tokens = (text: string): string[] => {
  const folded = foldZh(text);
  const out: string[] = [];
  let at = 0;
  for (const m of folded.matchAll(CJK_RUN)) {
    out.push(...latinTokens(folded.slice(at, m.index)), ...cjkTokens(m[0]));
    at = m.index! + m[0].length;
  }
  out.push(...latinTokens(folded.slice(at)));
  return out;
};

/** Every Chinese character on its own, so a one-character query finds a document. */
const singleChars = (text: string): string[] => [...foldZh(text).matchAll(CJK_RUN)].flatMap((m) => [...m[0]]);

/** The words a document is filed under: its words and, for Chinese, each character too. */
export const indexTokens = (text: string): string[] => [...tokens(text), ...singleChars(text)];

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
      const filed = `${doc.title} ${doc.title} ${doc.text}`;
      const ts = tokens(filed);
      const tf = new Map<string, number>();
      for (const t of indexTokens(filed)) tf.set(t, (tf.get(t) ?? 0) + 1);
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
    const ts = new Set([...all, ...singleChars(line)]);
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
