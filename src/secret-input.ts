// src/secret-input.ts
/**
 * Reading a secret so that it is left nowhere: not on the screen, not in
 * the terminal's scrollback (which an assistant working in the same
 * terminal reads), not in the shell's history file, not in the process
 * list. A secret given as a command argument is in all four — PowerShell's
 * PSReadLine keeps the line in its history file unless it contains one of
 * a few words such as "token", and `gabion auth gbt_…` contains none.
 *
 * Two ways in: a prompt on the terminal with the typing not shown, the way
 * a password is asked for, and standard input for scripts and CI, where no
 * one types.
 *
 * The prompt puts the terminal in raw mode for the time of one line: every
 * key arrives as it is pressed and nothing is echoed. Enter ends the line,
 * Backspace removes the last character, Ctrl+C cancels; a paste arrives as
 * one chunk of characters. Control characters and escape sequences (arrow
 * keys and the like) are dropped — a secret here is printable ASCII.
 */

const ENTER = new Set(["\r", "\n"]);
const BACKSPACE = new Set(["\u007f", "\b"]);
const CANCEL = "\u0003";
const END_OF_INPUT = "\u0004";
const ESCAPE = "\u001b";

/** Printable ASCII: what a secret may consist of. */
function isPrintable(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x20 && code < 0x7f;
}

/**
 * Ask for one line on the terminal without showing it. Resolves with the
 * line, or null when the user cancels (Ctrl+C, or Ctrl+D on an empty
 * line). The caller checks process.stdin.isTTY first.
 */
export function readHiddenLine(prompt: string): Promise<string | null> {
  const input = process.stdin;
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise((resolve) => {
    let value = "";
    let escaping = false;

    const finish = (result: string | null): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (escaping) {
          // An escape sequence ends with its first letter or "~".
          if (/[A-Za-z~]/.test(char)) escaping = false;
          continue;
        }
        if (char === ESCAPE) {
          escaping = true;
        } else if (ENTER.has(char)) {
          finish(value);
          return;
        } else if (char === CANCEL || (char === END_OF_INPUT && value === "")) {
          finish(null);
          return;
        } else if (BACKSPACE.has(char)) {
          value = value.slice(0, -1);
        } else if (isPrintable(char)) {
          value += char;
        }
      }
    };

    input.on("data", onData);
  });
}

/** Everything on standard input, trimmed — the secret piped in by a script. */
export async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
