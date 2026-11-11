"use client";

import { useState } from "react";
import { SquarePen, Trash2, X } from "lucide-react";
import type { ChatSummary } from "../view.ts";
import { groupLabel } from "./dates.ts";

type Props = {
  chats: ChatSummary[];
  activeId: string | null;
  open: boolean;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => Promise<void>;
  onClose: () => void;
  /** True while an answer is running: chats cannot be deleted then. */
  busy: boolean;
};

function groups(chats: ChatSummary[]): { label: string; chats: ChatSummary[] }[] {
  const result: { label: string; chats: ChatSummary[] }[] = [];
  for (const chat of chats) {
    const label = groupLabel(chat.day);
    const last = result.at(-1);
    if (last?.label === label) last.chats.push(chat);
    else result.push({ label, chats: [chat] });
  }
  return result;
}

function ChatRow({ chat, active, busy, onOpen, onDelete }: { chat: ChatSummary; active: boolean; busy: boolean; onOpen: () => void; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (confirming) {
    return (
      <div className="chat-row chat-row-confirm" role="group" aria-label={`Delete ${chat.title}`}>
        <span className="chat-item-title">Delete this chat?</span>
        <button className="button button-quiet button-small" onClick={() => setConfirming(false)} disabled={deleting} autoFocus>
          Cancel
        </button>
        <button
          className="button button-danger button-small"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            try {
              await onDelete();
            } finally {
              setDeleting(false);
              setConfirming(false);
            }
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="chat-row" data-active={active}>
      <button className="chat-item" aria-current={active} onClick={onOpen} title={chat.title}>
        <span className="chat-item-title">{chat.title}</span>
        {chat.demo && <span className="tag">Demo</span>}
      </button>
      {!busy && (
        <button className="row-action" onClick={() => setConfirming(true)} aria-label={`Delete chat: ${chat.title}`} title="Delete chat">
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function Sidebar({ chats, activeId, open, onOpenChat, onNewChat, onDeleteChat, onClose, busy }: Props) {
  return (
    <nav className="sidebar" data-open={open} aria-label="Past chats">
      <div className="sidebar-head">
        <span className="wordmark">minimi</span>
        <button className="icon-button mobile-only" onClick={onClose} aria-label="Close chat list" hidden={!open}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <button className="new-chat" onClick={onNewChat}>
        <SquarePen size={16} aria-hidden="true" />
        New chat
      </button>
      <div className="chat-list">
        {chats.length === 0 && <p className="sidebar-empty">Your chats will appear here, by date.</p>}
        {groups(chats).map((group) => (
          <section className="chat-group" key={group.label} aria-label={group.label}>
            <div className="chat-group-label">{group.label}</div>
            {group.chats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeId}
                busy={busy}
                onOpen={() => onOpenChat(chat.id)}
                onDelete={() => onDeleteChat(chat.id)}
              />
            ))}
          </section>
        ))}
      </div>
      <div className="sidebar-foot">
        Chats are saved on this computer, in <code>memory/</code>.
      </div>
    </nav>
  );
}
