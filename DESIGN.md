# Design

A chat agent with one tool, web search, built to answer one question well: "What did I ask before, and is it still true today?"
The full diagram is in `design.excalidraw`.

## How it works

Code does everything it can; the model does only research and writing.

1. **Read.** Save the message, with secrets removed. Start the safety check alongside everything else. Turn "last Tuesday" into real dates. Pick a path: small talk, a memory question, or research, which is the default.
2. **Recall.** Find the old chat by exact date, then by keywords. A chat found by its date is the right chat; one found only by a few words is flagged as a weak match. If nothing is found, say so and ask.
3. **Re-check.** When old answers are in question, code re-reads their sources and checks each old quote against today's page: still there ("same"), gone ("changed"), page gone ("could not confirm"), or never matched ("was wrong").
4. **Research.** DeepSeek V4.1 Flash decides what else to search with `web_search`: one search per item named, news since a date, at most 10 queries and 3 rounds.
5. **Write.** The model writes the answer as JSON: the reply, plus each claim with its exact quote from numbered evidence.
6. **Check.** Code checks each quote against its saved page, and numbers and dates against the quote. Gaps get up to 2 repair searches; anything still unsure is marked "could not confirm".
7. **Save and reply.** The answer, claims and page copies are saved. Each claim streams once it passes, so nothing unchecked is shown.

The model is one line in `.env`, so any OpenAI-style model can replace it.

**Web search tool:** Tavily finds pages > link gate > our own safe fetch > Markdown > dated snapshot > rank > short passages with sources.
Tavily only finds pages; every saved copy goes through our own cleaner, so an old copy and a new one differ only when the page did.
The link gate opens only links from results, the user or pages already read, and blocks local addresses and bad redirects.

**Memory** is a folder of Markdown files, read into memory at startup and searched there, with no database to fall out of step with the files.
On a fresh install the folder starts with demo chats dated relative to today, clearly marked as demo, so the sample questions work on a clean clone.

| Folder | Holds | Fact? |
|---|---|---|
| `chats/` | What you said, by date | No |
| `answers/` | What we answered, with claims | No |
| `pages/` | Source page copies, hashed, never edited | Yes, the only facts |

So the agent can catch its own past mistakes: "On 3 Nov I told you $19, but the page that day said $29."

## Guardrails

| Layer | Guardrail |
|---|---|
| Input | Llama Guard 4 checks every message, alongside the first steps, so it adds no wait. Harmful requests are refused before the web is touched; self-harm gets a caring reply with where to find help; medical, legal and money questions are answered. Keys, passwords and card numbers are removed before any model or file sees them. |
| Web | Only public addresses, checked at connect time and after every redirect. Links the model makes up cannot carry query strings. Pages are capped at 3 MB, 10 seconds and text only. Hidden text, and text written to an AI, is cut before the model sees a page. |
| Output | Answers are JSON checked again in code. Every quote must be on its saved page, and every number in a claim must be in its quote. The official site is cited over copies of it. A failed claim gets up to 2 repair rounds, then is dropped. Code, not the model, decides an old claim's status. |
| Spend | Per message: at most 10 searches, 3 research rounds and a model price cap. Per day: `DAILY_SEARCH_LIMIT` and `DAILY_MODEL_SPEND_USD`. No provider that keeps prompts for training. |

If the safety model is down, the agent still answers and logs it: one provider's outage should not stop the agent, and the main model has its own safety.

## Why it is built this way

- **The test questions are about memory over time, and many name several things at once.** ChatGPT and Perplexity remember facts about you, not the evidence behind an old answer.
- **A cheap, fast model makes mistakes.** So code checks dates, quotes, numbers and hashes, and the model only writes and judges.
- **One tool means memory is the app's job.** The model never has to remember to look.
- **Files show their work.** Anyone can read what the agent knows. Page copies are dated and never overwritten, so "then vs now" compares two files.
- **One loop, no multi-agent setup.** Fewer parts, fewer ways to be wrong.

## Considered and rejected

| Option | Why not |
|---|---|
| Memory as a second tool | Breaks the one-tool rule, and a small model forgets to use it |
| Memory found only by meaning | Fuzzy on dates and prices, and always returns something |
| A background user summary, like ChatGPT | OpenAI says theirs went stale and held conflicting facts |
| Stream the draft, strike out errors later | A wrong price shown briefly is still wrong |
| SearXNG in Docker | Free, but every reviewer would need Docker running |
| Reading pages with Tavily too | Two different cleaners would make unchanged pages look changed |
| An agent framework | Hides the loop, the part worth reading |
| Pricier models (Claude, GPT) | About 4 to 14 times the cost per answer |
| A local model | Weaker and slower, and reviewers would need a multi-GB download |
| Free tiers | Quotas too small for one review session |
| A guard that blocks every flagged category | Medical, legal and money questions are normal; blocking them makes the agent worse |

## With another week

- Grow the test set and publish scores against ChatGPT and Perplexity on dated questions.
- Pick the model by test score and tune prompts for it.
- Rank sources by more than "official site first".
- Better handling of sites that block bots.
- Read logged-in pages through a vault of saved sessions.
- Tidy the memory folder over long use.
