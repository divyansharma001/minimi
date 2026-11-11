// One turn: from the user's message to a saved, cited answer.
//
//  1. Save the message. Work out dates. Recall past chats.         (code)
//  2. Pick the path: talk, memory or research.                     (code)
//  3. If old claims are being questioned, re-read their sources
//     and check each old quote against today's page.               (code)
//  4. Research: the model decides more searches, up to 3 rounds.   (model + tool)
//  5. Write: the model writes the answer as JSON from one brief.   (model)
//  6. Save the answer and its claims. Return the trace.            (code)
//
// The model is called once for small talk and memory questions, and two to
// four times for research. Everything else is plain code.

import { todayIn } from "../memory/dates.ts";
import { recall } from "../memory/recall.ts";
import type { MemoryStore } from "../memory/store.ts";
import type { ChatRecord, ClaimStatus, StoredClaim } from "../memory/types.ts";
import type { ChatMessage, ModelClient, Usage } from "../model/types.ts";
import { ModelError } from "../model/types.ts";
import { LinkGate } from "../search/link-gate.ts";
import type { Snapshot } from "../search/snapshots.ts";
import { LIMITS, webSearch, type Evidence, type PageReport, type WebSearchDeps, type WebSearchInput } from "../search/tool.ts";
import type { Trace } from "../eval/types.ts";
import { parseAnswer, type FinalClaim } from "./answer.ts";
import { checkOldClaims, type OldClaimCheck } from "./claim-checks.ts";
import { checkClaims } from "./verify.ts";
import { choosePath, type Path } from "./intent.ts";
import { checkInput, REFUSAL, SUPPORT_REPLY, type SafetyVerdict } from "../guardrails/input-safety.ts";
import { redactSecrets } from "../guardrails/redact.ts";
import {
  ANSWER_SCHEMA,
  WEB_SEARCH_TOOL,
  formatEvidence,
  researchSystemPrompt,
  writerBrief,
  writerSystemPrompt,
  type Brief, dayName } from "./prompts.ts";

export const TURN_LIMITS = {
  researchRounds: 3,
  toolCallsPerRound: 6,
  queriesPerTurn: 10,
  historyTurns: 10,
  repairRounds: 2,
} as const;

export type TurnDeps = {
  model: ModelClient;
  /** The safety model. Without one, messages are not checked (noted in problems). */
  guard?: ModelClient;
  store: MemoryStore;
  search: Omit<WebSearchDeps, "gate">;
  now: () => Date;
  timeZone: string;
};

export type TurnEvent = { type: "status"; text: string };

export type TurnResult = {
  chatId: string;
  path: Path;
  answer: string;
  claims: FinalClaim[];
  evidence: Evidence[];
  trace: Trace;
  usage: Usage & { modelCalls: number };
  /** How the claim checks went: claims shown, repair rounds run, claims dropped. */
  checks: { claims: number; repairRounds: number; dropped: number };
  safety: SafetyVerdict;
  problems: string[];
};

/** Thrown inside a turn when the safety check says not to answer. */
class Refused extends Error {
  readonly verdict: SafetyVerdict;

  constructor(verdict: SafetyVerdict) {
    super("refused");
    this.verdict = verdict;
  }
}

const urlsIn = (text: string) => text.match(/https?:\/\/[^\s)<>\]"']+/g) ?? [];

/** Token caps for the writer: first try, then a retry after a cut-off reply. */
const WRITER_TOKEN_CAPS = [8_000, 16_000];

/** How a re-checked old fact reads in the thought process. */
const OLD_CHECK_LABEL: Record<ClaimStatus | "not-read", string> = {
  same: "still on their page",
  supported: "still on their page",
  changed: "changed",
  "was-wrong": "were wrong when first said",
  "cannot-confirm": "page is gone",
  "not-read": "page could not be re-read",
};

export async function runTurn(
  input: { chatId?: string; message: string },
  deps: TurnDeps,
  report: (event: TurnEvent) => void = () => {},
): Promise<TurnResult> {
  const started = Date.now();
  // Every step is shown live and kept, to be saved as the thought process.
  const steps: { text: string; ms: number }[] = [];
  const note = (text: string) => {
    if (steps.at(-1)?.text !== text) steps.push({ text, ms: Date.now() - started });
  };
  const onEvent = (event: TurnEvent) => {
    note(event.text);
    report(event);
  };
  const now = deps.now();
  const day = todayIn(deps.timeZone, now);
  // Secrets never reach a model or a file. The user is told.
  const redaction = redactSecrets(input.message.trim());
  const message = redaction.text;
  const withArticle = (kind: string) => `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
  const notices = redaction.found.length
    ? [`The user's message contained ${redaction.found.map(withArticle).join(" and ")}. The app removed it before sending or saving anything. Tell the user briefly, and suggest they change it if it was real.`]
    : [];
  // The safety check runs alongside everything below, and is waited for only
  // before the web is touched or an answer is shown.
  const safety = checkInput(deps.guard, message);
  const mustBeSafe = async () => {
    const verdict = await safety;
    if (verdict.action === "refuse" || verdict.action === "support") throw new Refused(verdict);
  };
  const usage = { inputTokens: 0, outputTokens: 0, cost: 0, modelCalls: 0 };
  const checks = { claims: 0, repairRounds: 0, dropped: 0 };
  let checkFailures: string[] = [];
  const problems: string[] = [];
  const count = (u: Usage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cost += u.cost;
    usage.modelCalls += 1;
  };

  // 1. Save the message, then look back.
  let chat: ChatRecord =
    (input.chatId ? deps.store.getChat(input.chatId) : undefined) ??
    (await deps.store.createChat({ firstMessage: message, at: now.toISOString(), day }));
  const history = chat.turns.slice(-TURN_LIMITS.historyTurns);
  chat = await deps.store.addTurn(chat.id, { role: "user", text: message, at: now.toISOString(), day });

  const recalled = recall(deps.store, message, { now, timeZone: deps.timeZone, excludeChatId: chat.id });
  const path = choosePath(message, recalled.refersToPast);
  if (recalled.chats.length > 0) {
    onEvent({ type: "status", text: `Found ${recalled.chats.length === 1 ? "your chat" : `${recalled.chats.length} chats`} from ${[...new Set(recalled.chats.map((c) => c.chat.turns[0]?.day ?? c.chat.startedAt.slice(0, 10)))].map(dayName).join(", ")}` });
  }

  // Links the agent may open: from the user, old sources, and this chat's answers.
  const gate = new LinkGate();
  const oldClaims: { chatId: string; claim: StoredClaim }[] = recalled.chats.flatMap((r) =>
    r.answers.flatMap((a) => a.claims.map((claim) => ({ chatId: r.chat.id, claim }))),
  );
  gate.remember([
    ...urlsIn(message),
    ...oldClaims.map((o) => o.claim.url),
    ...deps.store.answersFor(chat.id).flatMap((a) => a.claims.map((c) => c.url)),
  ]);
  const search = { ...deps.search, gate };

  const evidence: Evidence[] = [];
  const unreadable: PageReport[] = [];
  const queries: string[] = [];
  const pagesRead = new Set<string>();
  const addResult = (result: Awaited<ReturnType<typeof webSearch>>) => {
    const fresh = result.evidence.filter((e) => !evidence.some((x) => x.url === e.url && x.text === e.text));
    const startRef = evidence.length + 1;
    evidence.push(...fresh);
    unreadable.push(...result.pages.filter((p) => p.outcome !== "read"));
    queries.push(...result.queries);
    for (const p of result.pages) if (p.outcome === "read" || p.outcome === "not-found") pagesRead.add(p.url);
    problems.push(...result.problems);
    return { fresh, startRef };
  };

  // 3. Re-read old sources and check old quotes, when they are in question.
  let oldChecks: OldClaimCheck[] = [];
  if (path === "research" && oldClaims.length > 0) {
    onEvent({ type: "status", text: "Re-reading the sources from that chat" });
    const urls = [...new Set(oldClaims.map((o) => o.claim.url))];
    const batches: string[][] = [];
    for (let i = 0; i < urls.length; i += LIMITS.open) batches.push(urls.slice(i, i + LIMITS.open));
    const results = await Promise.all(batches.map((open) => webSearch({ open }, search, false)));
    const copies = new Map<string, Snapshot>();
    for (const result of results) {
      addResult(result);
      for (const s of result.snapshots) copies.set(s.url, s);
    }
    oldChecks = checkOldClaims(oldClaims, copies);
    const counts = new Map<string, number>();
    for (const check of oldChecks) {
      const label = OLD_CHECK_LABEL[check.status ?? "not-read"];
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    note(`Re-checked ${oldChecks.length} old fact${oldChecks.length === 1 ? "" : "s"}: ${[...counts].map(([label, n]) => `${n} ${label}`).join(", ")}`);
  }

  const brief = (): Brief => ({
    now, timeZone: deps.timeZone, dates: recalled.dates, recall: recalled, history,
    oldChecks, evidence, unreadable, message, notices, checkFailures,
  });

  try {
    // 4. Research: the model decides what to search, a round at a time.
    const research = async (messages: ChatMessage[], rounds: number) => {
      for (let round = 0; round < rounds; round += 1) {
        const reply = await deps.model.complete({ messages, tools: [WEB_SEARCH_TOOL], effort: "low", maxTokens: 1_500 });
        count(reply.usage);
        const calls = reply.toolCalls.slice(0, TURN_LIMITS.toolCallsPerRound);
        if (calls.length === 0) return;
        await mustBeSafe();
        messages.push({
          role: "assistant",
          content: reply.content || null,
          tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
        });

        // Share out the query budget before any search starts: the calls run
        // in parallel, so checking it inside each call would let them all pass.
        let budget = TURN_LIMITS.queriesPerTurn - queries.length;
        const planned = calls.map((call) => {
          let args: WebSearchInput;
          try {
            args = JSON.parse(call.arguments) as WebSearchInput;
          } catch {
            return { error: "The tool call arguments were not valid JSON. Nothing was searched." };
          }
          const asked = (Array.isArray(args.queries) ? args.queries : []).slice(0, LIMITS.queries);
          if (asked.length > 0 && budget <= 0) {
            return { error: "The search budget for this message is used up. Answer with the evidence you have." };
          }
          const granted = asked.slice(0, Math.max(0, budget));
          budget -= granted.length;
          return { args: { ...args, queries: granted } };
        });

        const outputs = await Promise.all(
          planned.map(async (plan) => {
            if (!("args" in plan) || !plan.args) return plan.error ?? "";
            const limited: WebSearchInput = plan.args;
            onEvent({ type: "status", text: `Searching: ${(limited.queries ?? []).join("; ") || "reading pages"}` });
            const result = await webSearch(limited, search, true);
            const { fresh, startRef } = addResult(result);
            const read = result.pages.filter((p) => p.outcome === "read").length;
            const notRead = result.pages.length - read;
            onEvent({
              type: "status",
              text: `Read ${read} page${read === 1 ? "" : "s"}${notRead > 0 ? ` (${notRead} could not be read)` : ""}`,
            });
            const failed = result.pages
              .filter((p) => p.outcome !== "read")
              .map((p) => `Could not read ${p.url}: ${p.outcome}${p.detail ? `, ${p.detail}` : ""}.`);
            const notes = [...failed, ...result.problems].join("\n");
            const found = fresh.length > 0 ? formatEvidence(fresh, startRef) : "No new evidence from this search.";
            return notes ? `${found}\n\n${notes}` : found;
          }),
        );
        calls.forEach((call, i) => messages.push({ role: "tool", tool_call_id: call.id, content: outputs[i] ?? "" }));
      }
    };
    const researchMessages = (userContent: string): ChatMessage[] => [
      { role: "system", content: researchSystemPrompt(brief(), TURN_LIMITS.queriesPerTurn) },
      ...history.map((t): ChatMessage => ({ role: t.role, content: t.text })),
      { role: "user", content: userContent },
    ];
    if (path === "research") await research(researchMessages(message), TURN_LIMITS.researchRounds);

    // 5. Write. On the research path the safety check has almost always
    // finished by now, so waiting for it costs nothing and a refused message
    // skips the writer. Short paths run the writer alongside it instead.
    if (path === "research") await mustBeSafe();
    const write = async () => {
      const writerMessages: ChatMessage[] = [
        { role: "system", content: writerSystemPrompt(brief()) },
        { role: "user", content: writerBrief(brief()) },
      ];
      // The model's hidden thinking counts against the token cap, so the cap
      // is generous: tokens are billed only when used. A reply cut off by the
      // cap is asked again with twice the room, since the same cap would cut
      // it off again.
      for (const maxTokens of WRITER_TOKEN_CAPS) {
        const reply = await deps.model.complete({
          messages: writerMessages,
          jsonSchema: { name: "answer", schema: ANSWER_SCHEMA as unknown as Record<string, unknown> },
          effort: "medium",
          maxTokens,
        });
        count(reply.usage);
        const result = parseAnswer(reply.content, evidence, oldChecks, day);
        if (result) {
          problems.push(...result.problems);
          return result;
        }
        problems.push(
          reply.finishReason === "length"
            ? `The model ran out of room after ${maxTokens.toLocaleString("en-GB")} tokens, so it was asked again with more.`
            : "The model's answer was not valid JSON, so it was asked again.",
        );
      }
      throw new ModelError("bad-reply", "The model did not return a usable answer.");
    };
    onEvent({ type: "status", text: "Writing the answer" });
    let parsed = await write();

    // 6. Check every claim in code. Failures get up to 2 repair rounds: search
    // for what is missing, then rewrite. Whatever still fails a hard check is
    // dropped from the claims and recorded.
    const pageText = (item: Evidence) =>
      (item.snapshotId ? deps.search.snapshots.get(item.snapshotId)?.markdown : undefined) ?? item.text;
    let claimProblems = checkClaims(parsed.claims, evidence, oldChecks, pageText, day);
    for (let round = 0; round < TURN_LIMITS.repairRounds && claimProblems.length > 0; round += 1) {
      checks.repairRounds += 1;
      problems.push(
        `Repair round ${checks.repairRounds}: ${claimProblems.map((p) => `"${p.claim.text}" (${p.reason})`).join("; ")}.`,
      );
      onEvent({ type: "status", text: `Checking: ${claimProblems.length} claim${claimProblems.length === 1 ? "" : "s"} need another look` });
      const hard = claimProblems.filter((p) => p.kind === "hard");
      if (path === "research" && hard.length > 0) {
        const list = hard.map((p) => `- "${p.claim.text}": ${p.reason}`).join("\n");
        await research(
          researchMessages(
            `${message}\n\nThe app could not verify these statements against the evidence:\n${list}\nSearch for evidence that settles them, or reply DONE if the evidence already does or none can exist.`,
          ),
          1,
        );
      }
      checkFailures = claimProblems.map((p) => `"${p.claim.text}": ${p.reason}.`);
      parsed = await write();
      claimProblems = checkClaims(parsed.claims, evidence, oldChecks, pageText, day);
    }
    const dropped = claimProblems.filter((p) => p.kind === "hard").map((p) => p.claim);
    for (const claim of dropped) problems.push(`Dropped a claim that failed its check: "${claim.text}".`);
    parsed = { ...parsed, claims: parsed.claims.filter((c) => !dropped.includes(c)) };
    checks.dropped = dropped.length;
    checks.claims = parsed.claims.length;
    if (checks.claims > 0 || checks.dropped > 0) {
      note(
        `Checked ${checks.claims} ${checks.claims === 1 ? "fact against its page" : "facts against their pages"}` +
          (checks.dropped > 0 ? `, dropped ${checks.dropped} that did not hold up` : ""),
      );
    } else {
      note(
        path === "talk"
          ? "Replied without searching: nothing needed looking up"
          : path === "memory"
            ? "Answered from your saved chats, without searching"
            : "Found no facts to check in the answer",
      );
    }

    await mustBeSafe();
    const verdict = await safety;
    if (verdict.action === "unchecked") problems.push(`The safety check was skipped: ${verdict.reason}.`);

    // 6. Save and report. Keep every source the answer cites, by its number,
    // so a reopened chat still links its [n] markers.
    const cited = new Set<number>([
      ...[...parsed.answer.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])),
      ...parsed.claims.flatMap((c) => (c.source !== null ? [c.source] : [])),
    ]);
    const sources = [...cited]
      .sort((a, b) => a - b)
      .flatMap((n) => {
        const item = evidence[n - 1];
        return item
          ? [{ n, url: item.url, title: item.title, readOn: item.readOn, ...(item.pageDate ? { pageDay: item.pageDate.day } : {}) }]
          : [];
      });
    const answeredAt = deps.now().toISOString();
    const record = await deps.store.addAnswer({
      chatId: chat.id,
      at: answeredAt,
      day,
      question: message,
      answer: parsed.answer,
      claims: parsed.claims.map((c) => ({ text: c.text, quote: c.quote, url: c.url, capturedOn: c.readOn, status: c.status })),
      sources,
      process: { steps, ms: Date.now() - started, searches: queries.length, pages: pagesRead.size },
    });
    await deps.store.addTurn(chat.id, { role: "assistant", text: parsed.answer, at: answeredAt, day, answerId: record.id });

    return {
      chatId: chat.id,
      path,
      answer: parsed.answer,
      claims: parsed.claims,
      evidence,
      usage,
      checks,
      safety: verdict,
      problems,
      trace: {
        refused: false,
        resolvedDates: recalled.dates.days,
        recalledChatIds: recalled.chats.map((r) => r.chat.id),
        searchQueries: queries,
        pagesRead: [...pagesRead],
        claims: parsed.claims.map((c) => ({ text: c.text, quote: c.quote, url: c.url, status: c.status })),
        answer: parsed.answer,
        timings: { totalMs: Date.now() - started, firstTextMs: Date.now() - started },
      },
    };
  } catch (error) {
    const refused = error instanceof Refused ? error.verdict : null;
    const reason = error instanceof ModelError ? error.message : "Something went wrong while answering.";
    const answer = refused
      ? refused.action === "support"
        ? SUPPORT_REPLY
        : REFUSAL
      : `Sorry, I couldn't answer that. ${reason}`;
    await deps.store.addTurn(chat.id, { role: "assistant", text: answer, at: deps.now().toISOString(), day });
    return {
      chatId: chat.id,
      path,
      answer,
      claims: [],
      evidence: refused ? [] : evidence,
      usage,
      checks,
      safety: refused ?? (await safety),
      problems: refused ? problems : [...problems, reason],
      trace: {
        refused: refused !== null,
        resolvedDates: recalled.dates.days,
        recalledChatIds: recalled.chats.map((r) => r.chat.id),
        searchQueries: queries,
        pagesRead: [...pagesRead],
        claims: [],
        answer,
        timings: { totalMs: Date.now() - started, firstTextMs: null },
      },
    };
  }
}
