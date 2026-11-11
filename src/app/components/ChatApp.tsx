"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Menu, ShieldCheck, SquarePen } from "lucide-react";
import type { ChatEvent, ChatSummary, ChatView, MessageView } from "../view.ts";
import { AnswerCard } from "./AnswerCard.tsx";
import { Composer } from "./Composer.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Working } from "./Working.tsx";

const SUGGESTIONS = [
  "What did I ask you on 3 November? Is your answer still correct today?",
  "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
  "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?",
  "What does Neon charge for its paid Postgres plans right now?",
];

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function setUrlChat(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("chat", id);
  else url.searchParams.delete("chat");
  window.history.replaceState(null, "", url);
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `The server answered ${response.status}.`;
  } catch {
    return `The server answered ${response.status}.`;
  }
}

export function ChatApp() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [steps, setSteps] = useState<string[] | null>(null);
  const [error, setError] = useState<{ text: string; retry?: string } | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const busy = steps !== null;

  const loadChats = useCallback(async () => {
    const response = await fetch("/api/chats", { cache: "no-store" });
    if (response.ok) setChats(((await response.json()) as { chats: ChatSummary[] }).chats);
  }, []);

  const openChat = useCallback(async (id: string) => {
    setDrawerOpen(false);
    setError(null);
    setActiveId(id);
    setUrlChat(id);
    setLoadingChat(true);
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) {
        setMessages([]);
        setError({ text: await readError(response) });
        return;
      }
      setMessages(((await response.json()) as { chat: ChatView }).chat.messages);
    } finally {
      setLoadingChat(false);
    }
  }, []);

  useEffect(() => {
    void loadChats();
    const fromUrl = new URL(window.location.href).searchParams.get("chat");
    if (fromUrl) void openChat(fromUrl);
  }, [loadChats, openChat]);

  // While working, keep the live steps in view. When an answer lands, or a
  // chat opens, show your last question at the top so the answer reads from
  // its start rather than from its sources.
  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    if (steps !== null) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const questions = el.querySelectorAll<HTMLElement>(".message-user");
    const last = questions[questions.length - 1];
    if (last) el.scrollTop = last.offsetTop - el.offsetTop - 16;
  }, [messages, steps]);

  const newChat = () => {
    if (busy) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
    setDrawerOpen(false);
    setUrlChat(null);
  };

  const send = async (text: string) => {
    if (busy) return;
    setError(null);
    setSteps([]);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", text, at: new Date().toISOString() }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, chatId: activeId, timeZone: timeZone() }),
      });
      if (!response.ok || !response.body) {
        setError({ text: await readError(response), retry: text });
        return;
      }

      // One JSON event per line.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      let answered = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += value;
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "chat") {
            setActiveId(event.chat.id);
            setUrlChat(event.chat.id);
            setChats((current) => (current.some((c) => c.id === event.chat.id) ? current : [event.chat, ...current]));
          } else if (event.type === "status") {
            setSteps((current) => (current && current.at(-1) === event.text ? current : [...(current ?? []), event.text]));
          } else if (event.type === "message") {
            answered = true;
            setMessages((current) => [...current, event.message]);
          } else if (event.type === "error") {
            setError({ text: event.message, retry: text });
          }
        }
      }
      if (!answered) setError((current) => current ?? { text: "The answer was cut off. Please try again.", retry: text });
    } catch {
      setError({ text: "Could not reach minimi. Check that the app is still running, then try again.", retry: text });
    } finally {
      setSteps(null);
    }
  };

  const retry = (text: string) => {
    setMessages((current) => (current.at(-1)?.role === "user" ? current.slice(0, -1) : current));
    void send(text);
  };

  const empty = messages.length === 0 && !busy && !loadingChat;

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeId={activeId}
        open={drawerOpen}
        onOpenChat={(id) => void openChat(id)}
        onNewChat={newChat}
        onClose={() => setDrawerOpen(false)}
      />
      <div className="scrim" data-open={drawerOpen} onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <main className="main">
        <header className="topbar">
          <button className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Open chat list">
            <Menu size={22} aria-hidden="true" />
          </button>
          <span className="wordmark">minimi</span>
          <button className="icon-button" onClick={newChat} aria-label="New chat" disabled={busy}>
            <SquarePen size={20} aria-hidden="true" />
          </button>
        </header>

        <div
          className="thread"
          ref={thread}
          onScroll={(event) => {
            event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 4);
          }}
        >
          <div className="column" style={{ minHeight: "100%" }}>
            {empty ? (
              <section className="empty" aria-labelledby="empty-title">
                <h1 id="empty-title">Ask anything. I&nbsp;check every fact, and remember what you asked.</h1>
                <p>Ask about a past chat by its date, like &ldquo;last Tuesday&rdquo;, and I&rsquo;ll check whether my answer still holds.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((question) => (
                    <button className="suggestion" key={question} onClick={() => void send(question)}>
                      {question}
                    </button>
                  ))}
                </div>
                {chats.some((c) => c.demo) && (
                  <p className="notice">
                    <ShieldCheck size={16} aria-hidden="true" />
                    The chats marked Demo came with this copy, so you can ask about past dates straight away.
                  </p>
                )}
              </section>
            ) : (
              <div className="messages">
                {loadingChat && <Working steps={["Opening your chat"]} />}
                {messages.map((message) =>
                  message.role === "user" ? (
                    <div className="message-user" key={message.id}>
                      {message.text}
                    </div>
                  ) : (
                    <AnswerCard message={message} key={message.id} />
                  ),
                )}
                {busy && <Working steps={steps ?? []} />}
                {error && (
                  <div className="alert" role="alert">
                    <CircleAlert size={18} aria-hidden="true" />
                    <div>
                      {error.text}
                      {error.retry && (
                        <div>
                          <button onClick={() => retry(error.retry as string)}>Try again</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <Composer busy={busy} onSend={(text) => void send(text)} />
      </main>
    </div>
  );
}
