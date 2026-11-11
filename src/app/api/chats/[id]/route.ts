// GET /api/chats/:id: one chat with its messages, answers and sources.

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
