/** The languages the archive is written in and the interface speaks. */
export type Lang = 'en' | 'zh';

export const LANGS: Lang[] = ['en', 'zh'];

export function asLang(x: unknown): Lang {
  return x === 'zh' ? 'zh' : 'en';
}

/** True when a piece of text holds Chinese characters. */
export const hasCjk = (s: string): boolean => /[\u4e00-\u9fff]/.test(s);
