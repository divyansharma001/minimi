"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { MessageView } from "../view.ts";

type Props = {
  message: MessageView;
  /** False while an answer is running, or before the message is saved. */
  canChange: boolean;
  /** True when more of the chat follows this message's own answer. */
  hasLater: boolean;
  onEdit: (text: string) => void;
  onDelete: () => Promise<void>;
};

type Mode = "view" | "edit" | "confirm-delete";

export function UserMessage({ message, canChange, hasLater, onEdit, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState(message.text);
  const [deleting, setDeleting] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  // A running answer locks the chat: leave any half-made change.
  useEffect(() => {
    if (!canChange) setMode("view");
  }, [canChange]);

  // Open the editor with the cursor at the end of the text.
  useEffect(() => {
    const el = field.current;
    if (mode !== "edit" || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [mode]);

  // Grow with the text, up to the CSS max height.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, mode]);

  const close = () => {
    setMode("view");
    setDraft(message.text);
    requestAnimationFrame(() => editButton.current?.focus());
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (text === message.text.trim()) return close();
    setMode("view");
    onEdit(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setMode("view");
    }
  };

  if (mode === "edit") {
    return (
      <form
        className="user-edit"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={`edit-${message.id}`} className="visually-hidden">
          Edit your message
        </label>
        <textarea
          id={`edit-${message.id}`}
          ref={field}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={4000}
        />
        <div className="user-edit-foot">
          <p>{hasLater ? "Replaces this answer and removes the messages after it." : "Replaces the answer below."}</p>
          <div className="button-row">
            <button type="button" className="button button-quiet" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={draft.trim() === ""}>
              Ask again
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    // The buttons come first: on a desktop they sit to the left of the bubble,
    // on a touch screen CSS moves them under it.
    <div className="user-turn">
      {canChange && mode === "view" && (
        <div className="message-actions">
          <button ref={editButton} className="message-action" onClick={() => setMode("edit")} aria-label="Edit message" title="Edit">
            <Pencil size={16} aria-hidden="true" />
          </button>
          <button className="message-action" onClick={() => setMode("confirm-delete")} aria-label="Delete message" title="Delete">
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="message-user">{message.text}</div>
      {canChange && mode === "confirm-delete" && (
        <div className="confirm-line">
          <div className="confirm" role="group" aria-label="Delete this message">
            <p>Delete this question and its answer?</p>
            <div className="button-row">
              <button className="button button-quiet" onClick={() => setMode("view")} disabled={deleting} autoFocus>
                Cancel
              </button>
              <button className="button button-danger" onClick={() => void remove()} disabled={deleting}>
                {deleting ? "Deleting" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
