# Archivist

An original research game for the browser. Visitors bring questions about a
generated village, Wending, between 1820 and 1895: who held the mill in the
year of the great flood, how old someone was when the chapel burned, who the
mother was of whoever kept the ferry. The answers are in the parish
registers, the property ledgers, old letters and the gazette, and rarely in
one place. You, or a researcher (the built-in clerk or a model), search the
catalogue, open what is needed, and answer with sources.

The game speaks English and Simplified Chinese, and writes the whole archive
in either.

## 中文简介

Archivist（档案员）是一款在浏览器里玩的考据游戏。档案来自一个虚构的村庄 Wending（1820 至 1895 年）：教区登记簿、产业簿、旧信和公报。每份档案有六道题，比如“大水那一年，磨坊归谁所有？”，答案却很少写在同一处，一封信也许只说“大水已经过去三年了”。你可以亲自检索目录、调阅文件、附上出处作答，也可以看内置的书记员或接入的模型研究员怎么做。在页首点“中文”，或在网址后加 `?lang=zh`，界面和新生成的档案就都是中文；人名保留拉丁字母原文。

## How a visit works

- Six questions per archive, eight actions per question. A search or opening
  a document costs one action. Answering is free.
- A search returns up to six documents with the line that matched best. A
  snippet is a clue, not a source: only opened documents can be cited.
- Right answer +10. Citing every fact the answer rests on +5 more. Each action
  left over +1. A wrong answer −3.
- Each event's year is written down once: in a gazette clipping, or in a
  letter that dates it from its own year ("It is three years since the great
  flood", "the year before last", "came this year"). Other letters mention
  the same events without a date.
- Older villagers were born before the registers start, so their ages come
  from the burial register: the year of burial minus the age at burial.

Every document records which facts it establishes (an event's year, a
property's chain of holders, a birth year, a mother, a wedding year). A
question's citation is good when the cited documents cover every fact its
answer needs, whichever documents those are: a letter that announces a
wedding counts as much as the marriage register.

## Play

```
npm install
npm run build
open dist/archivist.html       # the whole game in one file, no server needed
```

`docs/index.html` is a copy of that file, checked in, so the game can be
served as a static page (GitHub Pages from `docs/`, or any web server) or
opened straight from disk. It has no web fonts or outside requests and works
offline.

The reading room has three parts: the enquiry slip and question ledger on
the left, the catalogue drawer in the middle, and the reading desk on the
right (one column on a phone). Search the catalogue, open a card onto the
desk (the words of the latest search are marked), tick the slips of the
pages you rely on and hand in the answer. Document ids such as `ledger-mill` or `bap-1850` can be opened
directly once you know them, which saves a search. The notebook keeps what you
write across questions. After each answer you see what it rested on and how
the clerk did on the same question; the results table compares you with both
built-in researchers. **Watch the researcher** runs the same six questions
with its reasoning in the trail.

## The researchers

Neither built-in researcher sees the answer or the facts it needs. They read
the question, search, and parse documents from their text alone
(`src/agents/read.ts`).

- **skimmer** runs one search on the whole question and answers from the
  snippets, without opening anything.
- **clerk** works out what the answer needs (an event year, a ledger, a birth
  year, a wedding, a mother), searches for each in turn, ranks the hits
  (gazette first, then a letter whose matching line dates the event), opens
  the best one, and does the sums.

Results from `npm run sim -- --games 200` (1,200 questions):

| Researcher | Points | Right | Cited | Actions | Event year | Holder | Age | Wedding | Mother |
| ---------- | ------ | ----- | ----- | ------- | ---------- | ------ | --- | ------- | ------ |
| skimmer    | 2.3    | 22%   | 17%   | 1.0     | 44%        | 46%    | 2%  | 22%     | 0%     |
| clerk      | 18.9   | 100%  | 100%  | 4.1     | 100%       | 100%   | 100% | 100%   | 100%   |

The same 200 archives written in Chinese (`--lang zh`): the clerk scores
18.9 points, 100% right and cited, in 4.1 actions; the skimmer 3.2 points and
26% right.

The clerk is the rival to beat on points, not on accuracy. A player who learns
the document ids and keeps notes can answer in fewer actions than it does.

## A model researcher

`src/llm/researcher.ts` puts a model in the reading room. Each step it gets
the rules, the question, and everything found so far (each search with its
snippets, each opened page in full), and replies with one JSON tool call:
`search`, `open` or `answer` with citations.

Every reply is checked before it is used:

- the tool and its arguments must be well formed;
- a document it opens must exist and must not already be open;
- it may not repeat a search;
- it may cite only documents it has opened;
- a name it answers must appear in one of those documents.

A refused reply goes back to the model with the reason, once. If the second
reply fails too, the clerk takes that step. The model never sees the answer
or the facts the grading checks.

With the offline mock sending a broken or subtly wrong reply a fifth of the
time, 100 archives average 17.9 points and 96% right over 3,687 model calls,
with 620 replies repaired and none falling back
(`npm run sim -- --researcher llm --noise 0.2 --games 100`). The slips the
checks can't catch are sums off by one, which is why event-year and age
questions drop below the rest.

```
npm start                      # http://127.0.0.1:8793
```

Pick a researcher on the start page and watch. The server offers `mock`
always, `anthropic` when `ANTHROPIC_API_KEY` and
`ARCHIVIST_ANTHROPIC_MODEL` (the model id) are set
(`ARCHIVIST_ANTHROPIC_EFFORT`, default `low`), and `openai` for any
OpenAI-compatible endpoint when `OPENAI_MODEL` is set (`OPENAI_BASE_URL`,
`OPENAI_API_KEY`). Keys stay on the server. The browser sends only the
archive number, its language, the question number and the actions taken; the
server rebuilds the archive and replays them, so the model reads the real
pages.

## Languages

The interface and the archive come in English and 简体中文.

- **Switcher.** `EN` / `中文` at the top right changes every word of the
  interface at once. The first language is taken from `?lang=en` or
  `?lang=zh` in the address, then from the last choice (kept in
  `localStorage` as `archivist.lang`), then from the browser's language.
- **The archive is written in the chosen language** when a visit starts:
  register entries, ledgers, letters (with their relative dates: "It is three
  years since the great flood" is "大水已经过去三年了"), gazette clippings,
  the questions, the verdicts and what each answer rests on. People and the
  village keep their Latin names, set with a space either side in Chinese
  text ("1851 年。Ada Hale，享年 42 岁。").
- **An open archive keeps its language.** Switching in the middle of a visit
  changes the interface straight away and says that the open archive stays as
  it was written; the next archive you open (including *Same archive again*)
  is written in the new language. A saved visit resumes in its own language.
- **One seed, one village.** The generator draws the same facts whatever the
  language, so an archive number gives the same documents, facts and correct
  answers in both (`test/i18n.test.ts` checks this).
- **Chinese search.** The catalogue reads Chinese in overlapping pairs of
  characters (磨坊产业簿 is 磨坊 坊产 产业 业簿), and a one-character query as
  that character; Latin words keep the English tokenizer. A few everyday words
  are folded into the archive's own, as the stemmer folds "married" into
  "marriages": 洪水 finds 大水, 结婚 finds 成婚, 出生 finds 洗礼.
- **Answers.** Years and ages are digits, with or without a unit (`1851`,
  `1851年`, full-width digits too); names are written as the documents write
  them, and may sit in a Chinese sentence (`是 Ada Hale`).
- **Researchers.** The clerk and the skimmer read Chinese documents and search
  in Chinese. A model researcher on a Chinese archive gets a LANGUAGE
  instruction: think and take notes in Simplified Chinese, search in Chinese,
  keep JSON keys and tool names in English. The mock provider works in both.
  `npm run sim -- --lang zh` runs the batch in Chinese.

## Layout

```
src/engine/   the village, the documents and their wording (lexicon.ts), search, questions and grading, a visit's actions
src/i18n/     languages and Chinese spacing
src/agents/   reading documents, the built-in researchers, running a visit
src/llm/      providers (Anthropic, OpenAI-compatible, mock), the model researcher and its checks
src/sim/      batch runs
src/server/   local server for the model researcher
src/web/      the browser game and its strings in both languages
test/         engine, researchers, model path, server, languages, browser (jsdom)
```

```
npm test
npm run typecheck
npm run sim -- --games 200 [--researcher all|skimmer|clerk|llm] [--provider mock] [--noise 0.2] [--lang en|zh]
```
