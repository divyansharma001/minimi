# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: hiring reviewers testing the agent the way a real user would, on a laptop.
They ask about earlier chats by date ("what did I ask on 3 November?", "last Tuesday I asked about Postgres hosting") and whether old answers still hold.
Later: the builder's own personal tool, reused by an email agent and a LinkedIn agent.

## Product Purpose

A chat agent with one tool, web search, that answers one question well: what did I ask before, and is it still true today?
Success is an answer that is right, cites the page each fact came from, says plainly when something changed or could not be confirmed, and never invents a past chat.

## Positioning

It keeps the evidence behind every old answer: dated copies of the pages it read.
So it can compare then against now claim by claim, and catch its own past mistakes.
Chat assistants that remember facts about the user cannot do this.

## Operating Context

Chats are saved as plain Markdown files on the user's machine.
Every fact shown is checked in code against a saved page before it appears.
A turn takes a few seconds to about 20; the user sees live progress while it works.

## Capabilities and Constraints

- One tool: web search (Tavily finds pages; the app reads them itself).
- Model: DeepSeek V4.1 Flash through OpenRouter; swappable in `.env`.
- Claim statuses: supported, same, changed, was wrong, could not confirm.
- Safety: harmful requests are refused; self-harm gets a caring reply with where to find help.
- Runs with `npm install` and `npm run dev`; two API keys.

## Brand Commitments

- Name: minimi, shown as a small wordmark.
- Visual direction pinned by the builder: modern like Sarvam (sarvam.ai), a grainy gradient in a green family, white rounded cards, a clean friendly sans, grey labels with bold values, soft tinted status pills. Colour must follow colour theory and colour psychology.
- Past chats in a sidebar grouped by date.
- Under each answer: each checked fact as a row with a status pill and its numbered source.

## Evidence on Hand

No real users, testimonials or metrics. Demo chats on a fresh install must be labelled as demo.

## Product Principles

1. Nothing unchecked is shown.
2. Dates and old answers are facts about the conversation, never about the world.
3. Say "could not confirm" rather than guess.
4. Make memory visible: the date of every past chat and every source read.
