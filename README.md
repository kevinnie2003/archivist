# Archivist

An original research game for the browser. Visitors bring questions about a
generated village, Wending, between 1820 and 1895: who held the mill in the
year of the great flood, how old someone was when the chapel burned, who the
mother was of whoever kept the ferry. The answers are in the parish
registers, the property ledgers, old letters and the gazette, and rarely in
one place. You, or an AI researcher, search the catalogue, open what is
needed, and answer with sources.

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

Search on the middle panel, open hits into the reader on the right (the words
of the latest search are marked), tick the pages you rely on and answer on
the left. Document ids such as `ledger-mill` or `bap-1850` can be opened
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
| clerk      | 18.6   | 100%  | 100%  | 4.3     | 100%       | 100%   | 100% | 100%   | 100%   |

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
time, 100 archives average 17.9 points and 97% right over 3,838 model calls,
with 640 replies repaired and none falling back
(`npm run sim -- --researcher llm --noise 0.2 --games 100`). The slips the
checks can't catch are sums off by one, which is why event-year and age
questions drop below the rest.

```
npm start                      # http://127.0.0.1:8793
```

Pick a researcher on the start page and watch. The server offers `mock`
always, `anthropic` when `ANTHROPIC_API_KEY` is set
(`ARCHIVIST_ANTHROPIC_MODEL`, default `claude-opus-5-5`;
`ARCHIVIST_ANTHROPIC_EFFORT`, default `low`), and `openai` for any
OpenAI-compatible endpoint when `OPENAI_MODEL` is set (`OPENAI_BASE_URL`,
`OPENAI_API_KEY`). Keys stay on the server. The browser sends only the
archive number, the question number and the actions taken; the server
rebuilds the archive and replays them, so the model reads the real pages.

## Layout

```
src/engine/   the village, the documents, search, questions and grading, a visit's actions
src/agents/   reading documents, the built-in researchers, running a visit
src/llm/      providers (Anthropic, OpenAI-compatible, mock), the model researcher and its checks
src/sim/      batch runs
src/server/   local server for the model researcher
src/web/      the browser game
test/         engine, researchers, model path, server, browser (jsdom)
```

```
npm test
npm run typecheck
npm run sim -- --games 200 [--researcher all|skimmer|clerk|llm] [--provider mock] [--noise 0.2]
```
