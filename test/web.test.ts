// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(__dirname, '../src/web/index.html'), 'utf8');

async function boot(setup?: () => void) {
  document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
  localStorage.clear();
  history.replaceState(null, '', '/');
  setup?.();
  vi.resetModules();
  const web = (await import('../src/web/main.js')) as typeof import('../src/web/main.js');
  web.WATCH_DELAY.ms = 0;
  return web;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const until = async (cond: () => boolean, ms = 8000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('the browser game', () => {
  it('searches, opens a hit, cites it and answers', async () => {
    const web = await boot();
    $<HTMLInputElement>('seed').value = '4';
    $('mode-play').click();
    const q = web.getUI().visits[0].question;
    $<HTMLInputElement>('query').value = 'ledger';
    $('searchform').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(document.querySelectorAll('.hit').length).toBeGreaterThan(0);
    document.querySelector<HTMLButtonElement>('.hit [data-open]')!.click();
    expect($('page').textContent).toMatch(/\d{4}\./);
    expect($('page').querySelector('mark')).not.toBeNull();
    expect(document.querySelectorAll('.pips .on').length).toBe(6);
    const box = $('cites').querySelector<HTMLInputElement>('input')!;
    box.checked = true;
    $<HTMLInputElement>('answer').value = q.answer;
    $('answerform').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(web.getUI().visits[0].result!.right).toBe(true);
    expect($('verdictbox').textContent).toContain('Right');
    expect($('nextq').hidden).toBe(false);
  });

  it('opens a page by id and refuses one that does not exist', async () => {
    await boot();
    $<HTMLInputElement>('seed').value = '4';
    $('mode-play').click();
    $<HTMLInputElement>('openid').value = 'Ledger-Mill';
    $('openform').dispatchEvent(new Event('submit', { cancelable: true }));
    expect($('readertitle').textContent).toBe('Ledger of the mill');
    $<HTMLInputElement>('openid').value = 'nowhere';
    $('openform').dispatchEvent(new Event('submit', { cancelable: true }));
    expect($('answerproblem').textContent).toMatch(/no document/);
  });

  it('watches the clerk through all six questions to the results, and resumes a saved visit', async () => {
    const web = await boot();
    $<HTMLInputElement>('seed').value = '6';
    $('mode-watch').click();
    for (let i = 0; i < 6; i++) {
      $('auto').click();
      await until(() => !!web.getUI().visits[i].result && !web.getUI().auto);
      expect(document.querySelectorAll('.trail .why').length).toBeGreaterThan(0);
      if (i === 2) {
        const saved = localStorage.getItem('archivist.save.v1')!;
        expect(JSON.parse(saved).actions.length).toBe(3);
      }
      $('nextq').click();
    }
    expect($('result').hidden).toBe(false);
    expect($('tally').textContent).toContain('Clerk');
    expect($('tally').querySelectorAll('tr').length).toBe(8);

    const again = await boot();
    $<HTMLInputElement>('seed').value = '6';
    $('mode-play').click();
    again.act({ kind: 'search', query: 'mill' });
    again.act({ kind: 'open', doc: 'ledger-mill' });
    $<HTMLTextAreaElement>('notes').value = 'mill: see ledger';
    $('notes').dispatchEvent(new Event('input'));
    const keep = localStorage.getItem('archivist.save.v1')!;
    const third = await boot();
    localStorage.setItem('archivist.save.v1', keep);
    expect(third.resume()).toBe(true);
    expect(third.getUI().visits[0].used).toBe(2);
    expect($<HTMLTextAreaElement>('notes').value).toBe('mill: see ledger');
    expect($('readertitle').textContent).toBe('Ledger of the mill');
  });

  it('switches the interface to Chinese at once and writes the next archive in Chinese', async () => {
    const web = await boot();
    expect(document.querySelector('.lang [data-lang="en"]')!.getAttribute('aria-pressed')).toBe('true');
    document.querySelector<HTMLButtonElement>('.lang [data-lang="zh"]')!.click();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toContain('档案员');
    expect($('mode-play').textContent).toContain('亲自查档');
    expect($('rules').textContent).toContain('产业簿');
    expect($<HTMLInputElement>('query').placeholder).toContain('检索');
    expect(localStorage.getItem('archivist.lang')).toBe('zh');
    expect(document.querySelector('.lang [data-lang="zh"]')!.getAttribute('aria-pressed')).toBe('true');

    $<HTMLInputElement>('seed').value = '4';
    $('mode-play').click();
    const ui = web.getUI();
    expect(ui.archive!.lang).toBe('zh');
    expect($('question').textContent).toMatch(/[一-鿿]/);
    expect($('qledger').querySelectorAll('li').length).toBe(6);
    $<HTMLInputElement>('query').value = '磨坊产业簿';
    $('searchform').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(document.querySelector('.hit .callno')!.textContent).toBe('LED·MILL');
    document.querySelector<HTMLButtonElement>('.hit [data-open]')!.click();
    expect($('readertitle').textContent).toBe('磨坊产业簿');
    expect($('page').textContent).toMatch(/\d{4} 年。/);
    expect([...$('page').querySelectorAll('mark')].map((m) => m.textContent)).toContain('产业');
    expect($('sheetmeta').textContent).toContain('产业簿');
    const q = ui.visits[0].question;
    $<HTMLInputElement>('answer').value = q.answerType === 'number' ? `${q.answer}年` : `是 ${q.answer}`;
    $('answerform').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(ui.visits[0].result!.right).toBe(true);
    expect($('verdictbox').textContent).toContain('答对');
    expect($('verdictbox').querySelector('.stamp')!.textContent).toMatch(/已核实/);

    // Back to English mid-visit: the interface changes, the open archive stays Chinese.
    document.querySelector<HTMLButtonElement>('.lang [data-lang="en"]')!.click();
    expect(document.documentElement.lang).toBe('en');
    expect($('nextq').textContent).toBe('Next question');
    expect($('verdictbox').textContent).toContain('Right');
    expect($('question').textContent).toMatch(/[一-鿿]/);
    expect($('langnote').hidden).toBe(false);
    expect($('langnote').textContent).toContain('written in Chinese');
    $('quit').click();
    expect($('langnote').hidden).toBe(true);
    $('mode-play').click();
    expect(web.getUI().archive!.lang).toBe('en');
    expect($('question').textContent).not.toMatch(/[一-鿿]/);
  });

  it('starts in the language from ?lang=, then the saved choice, and resumes an archive in its own language', async () => {
    await boot(() => history.replaceState(null, '', '/?lang=zh'));
    expect(document.documentElement.lang).toBe('zh-CN');
    expect($('searchform').querySelector('button')!.textContent).toBe('检索');

    const web = await boot(() => localStorage.setItem('archivist.lang', 'zh'));
    expect(document.body.dataset.lang).toBe('zh');
    $<HTMLInputElement>('seed').value = '6';
    $('mode-watch').click();
    $('auto').click();
    await until(() => !!web.getUI().visits[0].result && !web.getUI().auto);
    const why = [...document.querySelectorAll('.trail .why')].map((x) => x.textContent!);
    expect(why.length).toBeGreaterThan(0);
    expect(why.every((t) => /[一-鿿]/.test(t))).toBe(true);
    expect(web.getUI().visits[0].result!.right).toBe(true);
    const keep = localStorage.getItem('archivist.save.v1')!;
    expect(JSON.parse(keep).lang).toBe('zh');

    const again = await boot(() => localStorage.setItem('archivist.lang', 'en'));
    localStorage.setItem('archivist.save.v1', keep);
    expect(again.resume()).toBe(true);
    expect(again.getUI().archive!.lang).toBe('zh');
    expect($('question').textContent).toMatch(/[一-鿿]/);
    expect($('step').textContent).toBe('Next step');
    // The clerk's reasons are worded again in the interface's language.
    expect(document.querySelector('.trail .why')!.textContent).toMatch(/clerk/);
  });

  it('gives each document a call number', async () => {
    const web = await boot();
    expect(web.callNumber('bap-1850')).toBe('REG·BAP·1850');
    expect(web.callNumber('ledger-mill')).toBe('LED·MILL');
    expect(web.callNumber('letter-4', 'Letter from Ada Hale, 1861')).toBe('LET·1861·04');
    expect(web.callNumber('gazette-flood', 'Wending 公报，1851 年')).toBe('GAZ·1851·FLO');
  });
});
