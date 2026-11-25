import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeArchive } from '../engine/docs.js';
import { makeQuestions } from '../engine/questions.js';
import { newInquiry, perform, viewOf, type Action, type Inquiry } from '../engine/research.js';
import { Catalogue } from '../engine/search.js';
import { makeWorld } from '../engine/world.js';
import { asLang } from '../i18n/lang.js';
import { availableProviders, makeProvider, type ProviderKind } from '../llm/factory.js';
import { UsageMeter } from '../llm/provider.js';
import { LLMResearcher } from '../llm/researcher.js';

/**
 * A small local server that lets a real model do the research, with API keys
 * kept on the server. It is stateless: the browser sends the archive's seed
 * and language, the question and the actions taken so far; the server rebuilds the archive,
 * replays the actions to get the real search results and pages, and returns
 * the model's next action. The model never sees the answer or the facts the
 * grading checks.
 */
const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = process.env.ARCHIVIST_WEB_ROOT ?? join(here, 'web');
const PORT = Number(process.env.PORT ?? 8793);
const HOST = process.env.HOST ?? '127.0.0.1';

const meter = new UsageMeter();
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 100_000): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const v = text ? JSON.parse(text) : {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('body must be a JSON object');
  return v as Record<string, unknown>;
}

const int = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/** Check an action from the browser has the right shape. Answers are not replayed. */
export function actionFrom(raw: unknown): Action {
  const a = raw as Action;
  if (a && a.kind === 'search' && typeof a.query === 'string' && a.query.length <= 200) return { kind: 'search', query: a.query };
  if (a && a.kind === 'open' && typeof a.doc === 'string' && a.doc.length <= 40) return { kind: 'open', doc: a.doc };
  throw new Error('bad action');
}

/**
 * Rebuild a visit from the seed, the archive's language, the question number
 * and the actions so far.
 */
export function visitFrom(body: Record<string, unknown>): { inquiry: Inquiry; cat: Catalogue } {
  if (!int(body.seed, 0, 2 ** 31) || !int(body.question, 1, 12)) throw new Error('bad seed or question');
  if (!Array.isArray(body.actions) || body.actions.length > 12) throw new Error('bad actions');
  if (body.lang !== undefined && body.lang !== 'en' && body.lang !== 'zh') throw new Error('bad lang');
  const archive = makeArchive(makeWorld(body.seed as number), asLang(body.lang));
  const cat = new Catalogue(archive);
  const q = makeQuestions(archive).find((x) => x.id === body.question);
  if (!q) throw new Error('no such question');
  const inquiry = newInquiry(q);
  for (const raw of body.actions) {
    const step = perform(archive, cat, inquiry, actionFrom(raw));
    if (step.error) throw new Error(`an earlier action fails: ${step.error}`);
  }
  return { inquiry, cat };
}

function provider(body: Record<string, unknown>): ProviderKind {
  const kind = String(body.provider ?? 'mock') as ProviderKind;
  if (!availableProviders().includes(kind)) throw new Error(`provider ${kind} is not available on this server`);
  return kind;
}

const usage = () => ({ calls: meter.calls, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens });

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, providers: availableProviders() });
  if (req.method !== 'POST' || url.pathname !== '/api/researcher') return json(res, 404, { error: 'not found' });
  let visit: { inquiry: Inquiry; cat: Catalogue };
  let kind: ProviderKind;
  let seed: number;
  try {
    const body = await readBody(req);
    visit = visitFrom(body);
    kind = provider(body);
    seed = body.seed as number;
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
  const llm = await makeProvider(kind, { seed: seed * 100 + visit.inquiry.question.id * 10 + visit.inquiry.steps.length });
  const step = await new LLMResearcher(llm, meter).step(viewOf(visit.inquiry), (id) => !!visit.cat.open(id));
  return json(res, 200, { ...step, usage: usage() });
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT)) return json(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

export function startServer(port = PORT, host = HOST): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const work = url.pathname.startsWith('/api/') ? handleApi(req, res, url) : serveStatic(res, url.pathname);
    work.catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    });
  });
  server.listen(port, host, () => console.log(`Archivist on http://${host}:${port}  (models: ${availableProviders().join(', ')})`));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) startServer();
