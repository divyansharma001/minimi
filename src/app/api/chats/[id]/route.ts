// GET /api/chats/:id: one chat with its messages, answers and sources.
// DELETE /api/chats/:id: the chat and its answers. Saved page copies stay:
// they are evidence that other answers may cite.

import { BUSY_MESSAGE, lockChat, unlockChat } from "@/server/busy.ts";
import { getRuntime } from "@/server/runtime.ts";
import { chatView } from "@/server/views.ts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const runtime = await getRuntime();
  if (!runtime.ok) return Response.json({ error: runtime.problems.join(" ") }, { status: 503 });
  const { id } = await params;
  const chat = runtime.store.getChat(id);
  if (!chat) return Response.json({ error: "That chat no longer exists." }, { status: 404 });
  return Response.json({ chat: chatView(runtime.store, chat) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const runtime = await getRuntime();
  if (!runtime.ok) return Response.json({ error: runtime.problems.join(" ") }, { status: 503 });
  const { id } = await params;
  if (!runtime.store.getChat(id)) return Response.json({ error: "That chat no longer exists." }, { status: 404 });
  if (!lockChat(id)) return Response.json({ error: BUSY_MESSAGE }, { status: 409 });
  try {
    await runtime.store.deleteChat(id);
    return new Response(null, { status: 204 });
  } finally {
    unlockChat(id);
  }
}
