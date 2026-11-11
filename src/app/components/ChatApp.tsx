"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Menu, SquarePen } from "lucide-react";
import type { ChatEvent, ChatSummary, ChatView, MessageView } from "../view.ts";
import { AnswerCard } from "./AnswerCard.tsx";
import { Composer } from "./Composer.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { UserMessage } from "./UserMessage.tsx";
import { Working } from "./Working.tsx";

// Real questions only: a question about a past chat needs a real past chat.
const SUGGESTIONS = [
  "What does Neon charge for its paid Postgres plans right now?",
  "We are shortlisting HubSpot, Pipedrive and Zoho CRM for a 20-person sales team. What does each cost per user per month?",
  "Which Node.js versions are LTS right now, and when does Node.js 22 reach end of life?",
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

/** What "Try again" re-sends: the text, and the message it replaces if any. */
type Retry = { text: string; editTurn?: number };

export function ChatApp() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [steps, setSteps] = useState<string[] | null>(null);
  const [error, setError] = useState<{ text: string; retry?: Retry } | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  // Set before a change that should leave the scroll where it is, like a delete.
  const holdScroll = useRef(false);
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
    if (holdScroll.current) {
      holdScroll.current = false;
      return;
    }
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

  /** Reloads the open chat as saved, keeping the scroll where it is. */
  const syncChat = async (id: string) => {
    const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return;
    holdScroll.current = true;
    setMessages(((await response.json()) as { chat: ChatView }).chat.messages);
  };

  /**
   * Asks `text`. With `editTurn`, it replaces your message at that place:
   * the server removes it and everything after it first.
   */
  const send = async (text: string, editTurn?: number) => {
    if (busy) return;
    const retryWith: Retry = editTurn === undefined ? { text } : { text, editTurn };
    let chatId = activeId;
    setError(null);
    setSteps([]);
    const local: MessageView = { id: `local-${Date.now()}`, role: "user", text, at: new Date().toISOString() };
    setMessages((current) => {
      const cut = editTurn === undefined ? -1 : current.findIndex((m) => m.turn === editTurn);
      return [...(cut === -1 ? current : current.slice(0, cut)), local];
    });

    let answered = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, chatId, timeZone: timeZone(), ...(editTurn === undefined ? {} : { editTurn }) }),
      });
      if (!response.ok || !response.body) {
        setError({ text: await readError(response), retry: retryWith });
        return;
      }

      // One JSON event per line.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
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
            chatId = event.chat.id;
            setActiveId(event.chat.id);
            setUrlChat(event.chat.id);
            // Add a new chat, or update one whose first message was edited.
            setChats((current) =>
              current.some((c) => c.id === event.chat.id)
                ? current.map((c) => (c.id === event.chat.id ? event.chat : c))
                : [event.chat, ...current],
            );
          } else if (event.type === "status") {
            setSteps((current) => (current && current.at(-1) === event.text ? current : [...(current ?? []), event.text]));
          } else if (event.type === "message") {
            answered = true;
            const reply = event.message;
            // Your message is saved just before its answer, so it can now be edited.
            setMessages((current) => [
              ...current.map((m) => (m.id === local.id && reply.turn !== undefined ? { ...m, turn: reply.turn - 1 } : m)),
              reply,
            ]);
          } else if (event.type === "error") {
            setError({ text: event.message, retry: retryWith });
          }
        }
      }
      if (!answered) setError((current) => current ?? { text: "The answer was cut off. Please try again.", retry: retryWith });
    } catch {
      setError({ text: "Could not reach minimi. Check that the app is still running, then try again.", retry: retryWith });
    } finally {
      setSteps(null);
      // Without an answer, show the chat as saved: your message may or may
      // not have been kept, and an edit may or may not have cut the chat.
      if (!answered && chatId) await syncChat(chatId).catch(() => undefined);
    }
  };

  // A failed turn may already have saved your message. Re-ask it as an edit
  // of that saved message, so it is not saved twice.
  const retry = ({ text, editTurn }: Retry) => {
    const last = messages.at(-1);
    if (last?.role === "user" && last.turn !== undefined && last.text === text) return void send(text, last.turn);
    if (last?.role === "user" && last.turn === undefined) setMessages((current) => current.slice(0, -1));
    void send(text, editTurn);
  };

  const deleteMessage = async (turn: number) => {
    if (!activeId || busy) return;
    const id = activeId;
    setError(null);
    const response = await fetch(`/api/chats/${encodeURIComponent(id)}/messages/${turn}`, { method: "DELETE" });
    if (!response.ok) {
      setError({ text: await readError(response) });
      return;
    }
    const { chat } = (await response.json()) as { chat: ChatView | null };
    if (chat) {
      holdScroll.current = true;
      setMessages(chat.messages);
    } else {
      setChats((current) => current.filter((c) => c.id !== id));
      newChat();
    }
  };

  const deleteChat = async (id: string) => {
    if (busy) return;
    const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      setError({ text: await readError(response) });
      return;
    }
    setChats((current) => current.filter((c) => c.id !== id));
    if (id === activeId) newChat();
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
        onDeleteChat={deleteChat}
        onClose={() => setDrawerOpen(false)}
        busy={busy}
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
              </section>
            ) : (
              <div className="messages">
                {loadingChat && <Working steps={["Opening your chat"]} />}
                {messages.map((message, i) =>
                  message.role === "user" ? (
                    <UserMessage
                      key={message.id}
                      message={message}
                      canChange={!busy && message.turn !== undefined}
                      hasLater={messages.length > i + 2}
                      onEdit={(text) => void send(text, message.turn)}
                      onDelete={() => deleteMessage(message.turn as number)}
                    />
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
                          <button onClick={() => retry(error.retry as Retry)}>Try again</button>
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
