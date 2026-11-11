"use client";

import { SquarePen, X } from "lucide-react";
import type { ChatSummary } from "../view.ts";
import { groupLabel } from "./dates.ts";

type Props = {
  chats: ChatSummary[];
  activeId: string | null;
  open: boolean;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
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

export function Sidebar({ chats, activeId, open, onOpenChat, onNewChat, onClose }: Props) {
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
              <button
                key={chat.id}
                className="chat-item"
                aria-current={chat.id === activeId}
                onClick={() => onOpenChat(chat.id)}
                title={chat.title}
              >
                <span className="chat-item-title">{chat.title}</span>
                {chat.demo && <span className="tag">Demo</span>}
              </button>
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
