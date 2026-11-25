// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(__dirname, '../src/web/index.html'), 'utf8');

async function boot() {
  document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
  localStorage.clear();
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
});
