// POST /api/chat: runs one turn and streams its progress.
//
// The reply is newline-delimited JSON (one ChatEvent per line): the chat it
// belongs to, live status lines while the agent works, then the checked
// answer. The answer arrives whole, because nothing unchecked is shown.
//
// With `editTurn`, the message at that place and everything after it is
// removed first, and the new text is asked in its place.

import { todayIn } from "@/memory/dates.ts";
import { runTurn } from "@/agent/turn.ts";
import { BUSY_MESSAGE, lockChat, unlockChat } from "@/server/busy.ts";
import { getRuntime, safeTimeZone } from "@/server/runtime.ts";
import { messageFromTurn, summary } from "@/server/views.ts";
import type { ChatEvent } from "@/app/view.ts";

export const dynamic = "force-dynamic";

const MAX_MESSAGE = 4_000;

export async function POST(request: Request): Promise<Response> {
  const runtime = await getRuntime();
  if (!runtime.ok) return Response.json({ error: runtime.problems.join(" ") }, { status: 503 });

  let body: { message?: unknown; chatId?: unknown; timeZone?: unknown; editTurn?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message === "") return Response.json({ error: "Type a message first." }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return Response.json({ error: `Messages can be up to ${MAX_MESSAGE.toLocaleString("en-GB")} characters.` }, { status: 400 });
  }
  const timeZone = safeTimeZone(body.timeZone);
  const deps = runtime.deps(timeZone);

  const requested = typeof body.chatId === "string" ? runtime.store.getChat(body.chatId) : undefined;
  if (typeof body.chatId === "string" && !requested) {
    return Response.json({ error: "That chat no longer exists." }, { status: 404 });
  }
  const editTurn = body.editTurn ?? null;
  if (editTurn !== null && (!requested || !Number.isInteger(editTurn) || requested.turns[editTurn as number]?.role !== "user")) {
    return Response.json({ error: "That message can no longer be edited." }, { status: 400 });
  }
  const now = deps.now();
  let chat = requested ?? (await runtime.store.createChat({ firstMessage: message, at: now.toISOString(), day: todayIn(timeZone, now) }));
  if (!lockChat(chat.id)) return Response.json({ error: BUSY_MESSAGE }, { status: 409 });
  if (editTurn !== null) {
    try {
      chat = await runtime.store.truncateFrom(chat.id, editTurn as number, message);
    } catch (error) {
      unlockChat(chat.id);
      console.error("Edit failed:", error);
      return Response.json({ error: "Could not edit that message. Please try again." }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser went away; the turn still finishes and is saved.
        }
      };
      try {
        send({ type: "chat", chat: summary(chat) });
        const result = await runTurn({ chatId: chat.id, message }, deps, (event) => send(event));
        send({ type: "message", message: messageFromTurn(runtime.store, result) });
      } catch (error) {
        console.error("Turn failed:", error);
        send({ type: "error", message: "Something went wrong while answering. Please try again." });
      } finally {
        unlockChat(chat.id);
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
