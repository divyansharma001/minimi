// Removes secrets from text before it is sent to a model or saved to memory.
//
// Memory is plain files, and model providers see every prompt. So an API key,
// password or card number pasted into a chat is replaced first, and the user
// is told. The agent never needs the secret itself to answer.
//
// Card numbers must pass the Luhn check, so an order number or a long price
// is not mistaken for one.

const KEYS =
  /\b(?:sk-(?:or-v1-|proj-|ant-)?[A-Za-z0-9_-]{20,}|tvly-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const PASSWORD = /\b(password|passwd|pwd|passcode|passphrase)(\s*(?:is|:|=)\s*)(\S+)/gi;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type Redaction = { text: string; found: string[] };

export function redactSecrets(text: string): Redaction {
  const found = new Set<string>();
  let out = text
    .replace(PRIVATE_KEY, () => {
      found.add("private key");
      return "[removed private key]";
    })
    .replace(KEYS, () => {
      found.add("API key");
      return "[removed API key]";
    })
    .replace(JWT, () => {
      found.add("access token");
      return "[removed access token]";
    })
    .replace(PASSWORD, (_match, word: string, sep: string) => {
      found.add("password");
      return `${word}${sep}[removed password]`;
    });
  out = out.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
    found.add("card number");
    return "[removed card number]";
  });
  return { text: out, found: [...found] };
}
