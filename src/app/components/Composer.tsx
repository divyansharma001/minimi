"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

type Props = { busy: boolean; onSend: (text: string) => void };

export function Composer({ busy, onSend }: Props) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  // Focus on load only with a mouse: on a phone it would pop the keyboard
  // over the answer.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) field.current?.focus();
  }, []);

  // Grow with the text, up to the CSS max height.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = () => {
    const message = text.trim();
    if (!message || busy) return;
    onSend(message);
    setText("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  // Enter sends; Shift+Enter adds a line. Never send mid-composition (IME).
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="composer-wrap">
      <form className="column composer" onSubmit={onSubmit}>
        <label htmlFor="message" className="visually-hidden">
          Message
        </label>
        <textarea
          id="message"
          ref={field}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything, or about a past chat"
          maxLength={4000}
        />
        <button className="send" type="submit" disabled={busy || text.trim() === ""} aria-label="Send">
          {busy ? <span className="spinner" aria-hidden="true" /> : <ArrowUp size={20} strokeWidth={2.4} aria-hidden="true" />}
        </button>
      </form>
      <p className="column composer-hint">Every fact is checked against its source. Answers can still be wrong.</p>
    </div>
  );
}
