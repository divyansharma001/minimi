// Past chats for the test set. All companies are invented and live on
// .example addresses, which are reserved and never real.
//
// The test clock is Wednesday 11 November 2026. Chats are placed so that the
// brief's questions are hard in the right ways:
// - two chats on 3 November, so "what did I ask on 3 November" must list both
// - a chat yesterday (Tuesday 10 Nov) about e-bikes, so "last Tuesday ... about
//   Postgres" must pick the topic match on 3 Nov, not just the nearest Tuesday
// - one old answer that was wrong when given, so the agent can catch it

import type { PastChat } from "../types.ts";

export const EVAL_NOW = "2026-11-11T10:00:00Z";
export const EVAL_TIME_ZONE = "UTC";

export const pastChats: PastChat[] = [
  {
    id: "chat-2026-10-20-fernwood",
    date: "2026-10-20",
    topic: "Fernwood Team plan price",
    userMessage: "How much is Fernwood's Team plan?",
    // Deliberately wrong: the saved page said $29, the answer said $19.
    answer: "Fernwood's Team plan is $19 per user per month [1].",
    claims: [
      {
        text: "Fernwood Team costs $19 per user per month",
        quote: "Team: $29 per user / month",
        url: "https://fernwood.example/pricing",
        capturedOn: "2026-10-20",
      },
    ],
  },
  {
    id: "chat-2026-11-01-austen",
    date: "2026-11-01",
    topic: "Author of Pride and Prejudice",
    userMessage: "Who wrote Pride and Prejudice?",
    answer: "Jane Austen wrote Pride and Prejudice, published in 1813 [1].",
    claims: [
      {
        text: "Jane Austen wrote Pride and Prejudice, published in 1813",
        quote: "Pride and Prejudice is an 1813 novel by Jane Austen.",
        url: "https://books.example/pride-and-prejudice",
        capturedOn: "2026-11-01",
      },
    ],
  },
  {
    id: "chat-2026-11-03-postgres",
    date: "2026-11-03",
    topic: "Managed Postgres hosting for a small SaaS",
    userMessage:
      "Compare managed Postgres hosting for a small SaaS: Basalt, Harborbase and Quillgres. What do they cost?",
    answer: [
      "Basalt: Starter $19/month, Pro $69/month [1].",
      "Harborbase: Hobby free, Standard $25/month [2].",
      "Quillgres: Dev plan $15/month [3].",
    ].join("\n"),
    claims: [
      {
        text: "Basalt Starter costs $19 per month",
        quote: "Starter: $19 / month",
        url: "https://basalt.example/pricing",
        capturedOn: "2026-11-03",
      },
      {
        text: "Basalt Pro costs $69 per month",
        quote: "Pro: $69 / month",
        url: "https://basalt.example/pricing",
        capturedOn: "2026-11-03",
      },
      {
        text: "Harborbase Standard costs $25 per month",
        quote: "Standard: $25 / month",
        url: "https://harborbase.example/pricing",
        capturedOn: "2026-11-03",
      },
      {
        text: "Quillgres Dev costs $15 per month",
        quote: "Dev plan: $15 / month",
        url: "https://quillgres.example/pricing",
        capturedOn: "2026-11-03",
      },
    ],
  },
  {
    id: "chat-2026-11-03-timezones",
    date: "2026-11-03",
    topic: "London to Tokyo time difference",
    userMessage: "If it's 9am in London, what time is it in Tokyo?",
    answer: "6pm in Tokyo. In November London is on UTC+0 and Tokyo on UTC+9.",
    claims: [],
  },
  {
    id: "chat-2026-11-09-crm",
    date: "2026-11-09",
    topic: "CRM shortlist for a 20-person sales team",
    userMessage:
      "We're a 20-person sales team. Shortlist 5 CRM tools with their per-seat pricing.",
    answer: [
      "1. Pipewell: $25 per seat/month [1]",
      "2. Dealcraft: $30 per seat/month [2]",
      "3. Closely: $18 per seat/month [3]",
      "4. Northlane: $40 per seat/month [4]",
      "5. Tallyho: $22 per seat/month [5]",
    ].join("\n"),
    claims: [
      {
        text: "Pipewell costs $25 per seat per month",
        quote: "$25 per seat / month",
        url: "https://pipewell.example/pricing",
        capturedOn: "2026-11-09",
      },
      {
        text: "Dealcraft costs $30 per seat per month",
        quote: "$30 per seat / month",
        url: "https://dealcraft.example/pricing",
        capturedOn: "2026-11-09",
      },
      {
        text: "Closely costs $18 per seat per month",
        quote: "$18 per seat / month",
        url: "https://closely.example/pricing",
        capturedOn: "2026-11-09",
      },
      {
        text: "Northlane costs $40 per seat per month",
        quote: "$40 per seat / month",
        url: "https://northlane.example/pricing",
        capturedOn: "2026-11-09",
      },
      {
        text: "Tallyho costs $22 per seat per month",
        quote: "$22 per seat / month",
        url: "https://tallyho.example/pricing",
        capturedOn: "2026-11-09",
      },
    ],
  },
  {
    id: "chat-2026-11-10-ebikes",
    date: "2026-11-10",
    topic: "E-bikes under $2,000",
    userMessage: "What's a good city e-bike under $2,000?",
    answer: "The Voltaro City at $1,799 is a strong pick for city riding [1].",
    claims: [
      {
        text: "The Voltaro City costs $1,799",
        quote: "Voltaro City: $1,799",
        url: "https://voltaro.example/city",
        capturedOn: "2026-11-10",
      },
    ],
  },
];
