// GET /api/chats: every saved chat, newest first, for the sidebar.

import { getRuntime } from "@/server/runtime.ts";
import { summary } from "@/server/views.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const runtime = await getRuntime();
  if (!runtime.ok) return Response.json({ error: runtime.problems.join(" ") }, { status: 503 });
  const chats = runtime.store
    .allChats()
    .filter((c) => c.turns.length > 0)
    .map(summary)
    .reverse();
  return Response.json({ chats });
}
