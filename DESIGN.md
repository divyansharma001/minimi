# Design

A chat agent with one tool, web search, built to answer one question well: "What did I ask before, and is it still true today?"
Diagram: `design.excalidraw`.
Visual system: `docs/visual-system.md`.

## How it works

Code does everything it can; the model only researches and writes.

1. **Read.** Remove secrets, start the safety check alongside, turn "last Tuesday" into dates, and pick a path: small talk, memory, or research.
2. **Recall.** Find the old chat by date, then by keywords.
   A weak match is flagged; no match is said plainly, never invented.
3. **Re-check.** Code re-reads each old answer's sources and looks for its saved quote on today's page.
   The result is same, changed, could not confirm (page gone) or was wrong (never matched).
4. **Research.** DeepSeek V4.1 Flash searches with `web_search`: one search per thing named, at most 10 queries and 3 rounds.
5. **Write.** The model returns JSON: the reply, and every fact with its topic, source number and exact quote.
6. **Check.** Code checks every quote against the saved page, and every number against its quote.
   Facts on one topic from different sites whose values clash are kept together as "sources disagree", and the reply must give both sides.
   Failures get up to 2 repair rounds that send back only the changes; whatever still fails is dropped.
7. **Reply.** You see live steps, then the checked answer with its facts, sources and thought process.
   Nothing unchecked is shown.

**Web search:** Tavily finds pages; our own safe fetcher and cleaner read them, so an old copy and a new one differ only when the page did.

**Memory** is a folder of Markdown files with a JSON header, read at startup and searched in memory.
A fresh copy gets three real demo chats, dated "last Tuesday", "Monday" and "3 November", so the sample questions work at once.

| Folder | Holds | Fact? |
|---|---|---|
| `chats/` | What you said, by date | No |
| `answers/` | What we answered, with each fact's quote | No, a record |
| `pages/` | Dated page copies, never edited | Yes, what quotes are checked against |

## Guardrails

| Layer | Guardrail |
|---|---|
| Input | Llama Guard 4 runs alongside the first steps. Harmful requests are refused before the web is touched; self-harm gets a caring reply. Keys, passwords and card numbers are removed before any model or file sees them. |
| Web | Public addresses only, checked at connect time and after redirects. Pages capped at 3 MB, 10 s, text only. Hidden text and text aimed at an AI are cut. |
| Output | Quotes, numbers, conflicts and old-claim statuses are checked in code, not trusted to the model. |
| Spend | Per message: 10 searches, 3 research rounds, a model price cap. Per day: `DAILY_SEARCH_LIMIT`, `DAILY_MODEL_SPEND_USD`. No provider that trains on prompts. |
| Time | Research calls 30 s, repairs 45 s, writer 90 s. After 75 s no new round starts. A failed search ends the research, not the turn. |

## Measured

| | Result |
|---|---|
| Test set (19 cases on a fake web with dated page versions) | 19/19 cases, 102/102 checks, about $0.02 per full run |
| Live 3-to-5-company pricing questions | 28 to 68 s, was 41 to 136 s before small repairs |
| Cost per live answer | $0.008 to $0.019; small talk about $0.0002 |
| Repair round | about 2 s with thinking off, was 40 to 90 s as a full re-write |

## Why it is built this way

- **The test questions are about memory over time.** ChatGPT and Perplexity remember facts about you, not the evidence behind an old answer.
- **A cheap, fast model makes mistakes,** so code checks dates, quotes, numbers and conflicts, and the model only writes and judges.
- **One tool means memory is the app's job.** The model never has to remember to look.
- **Files show their work.** Anyone can read what the agent knows and when it read it.

## Considered and rejected

| Option | Why not |
|---|---|
| Memory as a second tool | Breaks the one-tool rule, and a small model forgets to use it |
| Memory found only by meaning | Fuzzy on dates and prices, and always returns something |
| Streaming the draft | A wrong price shown briefly is still wrong |
| Picking one value when sources disagree | Hides exactly what the user needs to judge |
| Lower writer effort | Measured: providers ignore it, one thought for 12,000 tokens on "low" |
| An agent framework | Hides the loop, the part worth reading |
| Pricier or local models | 4 to 14 times the cost, or a multi-GB download for reviewers |

## With another week

- Grow the test set, and score against ChatGPT and Perplexity on dated questions.
- Allow numbers from a page's own title in quote checks ("Node.js 20" on a Node 20 page).
- Compare like with like in conflicts: today any two dates are compared, so "Active vs Maintenance" is caught only when the dates around it happen to differ.
- Rank sources by more than "official site first".
- Handle sites that block bots, and read logged-in pages through a vault.
