# minimi

A chat agent with one tool, web search.
It remembers what you asked and when, re-checks old answers against today's web, and shows a source for every fact.

How it works and why: [DESIGN.md](DESIGN.md) and the diagram in `design.excalidraw` (open it at excalidraw.com).

## Run it

You need Node.js 22.18 or newer and two keys.

```sh
npm install
cp .env.example .env   # then add OPENROUTER_API_KEY and TAVILY_API_KEY
npm run dev            # open http://localhost:3000
```

- OpenRouter key: https://openrouter.ai/keys (a few dollars of credit lasts a long time; an answer costs about $0.01).
- Tavily key: https://app.tavily.com (free, 1,000 searches a month, no card).

## Try it

Memory here is only ever real: there are no sample chats, so the agent can only remember what you actually asked.
A fresh install starts empty.

| Step | Ask | What should happen |
|---|---|---|
| 1 | What does Neon charge for its paid Postgres plans right now? | Searches, answers, cites a source for every fact, and checks each one. |
| 2 | Start a **new chat**, then: What did I ask you earlier today? Is your answer still correct? | Finds the chat from step 1, re-reads its sources today, and says which facts still hold. |
| 3 | What did I ask you on 25 October? | Says there is no chat from that day, instead of making one up. |
| 4 | On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since? | On a fresh install there is no Monday chat, so it says so plainly and asks which tools you mean. |
| 5 | Come back on a later day: Yesterday I asked you about Neon. Has the price changed? | Finds yesterday's chat by its date and compares the old prices with today's page. |

Things to look at on each answer:

- **Thought process** (top of the answer): the steps it took, with times.
- **Checked facts**: each fact with its source and status (checked, still true, changed, was wrong, couldn't confirm). When two sources disagree, both are kept under "Sources disagree".
- **Citation numbers** open the source page.
- **Your messages** can be edited (it asks again from there) or deleted, and whole chats can be deleted from the sidebar.

Questions about past chats take a few seconds; questions that search the web take about 20 to 70 seconds, longer for several companies at once.
You see each step while it works; the answer appears once every fact has passed its checks.

## Start again

Chats are Markdown files in `memory/`.
To start fresh, stop the app, delete `memory/`, and start it again.

## Tests

| Command | What it does | Cost |
|---|---|---|
| `npm test` | 203 tests of the plumbing: dates, memory, the web tool's safety, claim checks, conflicts, repairs | Free, no network |
| `npm run eval` | 19 scored cases with the real model on a fake web whose pages change over dated versions | About $0.02, no searches |
| `npm run typecheck` | TypeScript | Free |

`npm run eval` prints a score per case and saves the full run to `eval-results/`.

## Settings

Everything is in `.env.example`: the model (any OpenRouter model with tool calling), the safety model (`GUARD_MODEL=off` turns it off), and daily caps on searches and spend.
