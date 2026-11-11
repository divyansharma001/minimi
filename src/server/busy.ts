// One change at a time per chat. A second message, an edit or a delete while
// a turn is still running would race on the same chat file and confuse the
// history, so each takes the chat's lock first and is refused if it is held.

const held = new Set<string>();

/** Takes the lock and returns true, or returns false if the chat is busy. */
export function lockChat(chatId: string): boolean {
  if (held.has(chatId)) return false;
  held.add(chatId);
  return true;
}

export function unlockChat(chatId: string): void {
  held.delete(chatId);
}

export const BUSY_MESSAGE = "This chat is still answering your last message.";
