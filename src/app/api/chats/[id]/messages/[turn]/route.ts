// DELETE /api/chats/:id/messages/:turn: one of your messages and the answer
// to it. Replies with the chat as it now is, or null if that emptied it.

import { BUSY_MESSAGE, lockChat, unlockChat } from "@/server/busy.ts";
import { getRuntime } from "@/server/runtime.ts";
import { chatView } from "@/server/views.ts";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; turn: string }> }): Promise<Response> {
  const runtime = await getRuntime();
  if (!runtime.ok) return Response.json({ error: runtime.problems.join(" ") }, { status: 503 });
  const { id, turn } = await params;
  const chat = runtime.store.getChat(id);
  if (!chat) return Response.json({ error: "That chat no longer exists." }, { status: 404 });
  const index = /^\d+$/.test(turn) ? Number(turn) : -1;
  if (chat.turns[index]?.role !== "user") return Response.json({ error: "That message no longer exists." }, { status: 404 });
  if (!lockChat(id)) return Response.json({ error: BUSY_MESSAGE }, { status: 409 });
  try {
    const updated = await runtime.store.deleteMessage(id, index);
    return Response.json({ chat: updated ? chatView(runtime.store, updated) : null });
  } finally {
    unlockChat(id);
  }
}
