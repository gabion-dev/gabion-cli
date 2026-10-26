// src/secret-input.ts
/**
 * Reading from the terminal. Mostly a secret, so that it is left nowhere
 * whole: not on the screen, not in the terminal's scrollback (which an
 * assistant working in the same terminal reads), not in the shell's history
 * file, not in the process list. A secret given as a command argument is in
 * all four — PowerShell's PSReadLine keeps the line in its history file
 * unless it contains one of a few words such as "token", and
 * `gabion auth gbt_…` contains none.
 *
 * Two ways in: a prompt on the terminal that echoes a mask instead of the
 * typing, and standard input for scripts and CI, where no one types.
 *
 * The prompt puts the terminal in raw mode for the time of one line: every
 * key arrives as it is pressed and the terminal echoes nothing — the prompt
 * echoes the mask itself, the first characters as typed and a "*" for each
 * one after. Without an echo a paste looks like nothing happened and the
 * user cannot tell whether the secret went in; the mask shows that it did
 * and how long it is, and the prefix shows which one it was. Enter ends the
 * line, Backspace removes the last character, Ctrl+C cancels; a paste
 * arrives as one chunk of characters and shows at once. Control characters
 * and escape sequences (arrow keys, the brackets of a bracketed paste) are
 * dropped — a secret here is printable ASCII.
 *
 * And one plain line shown as typed (askLine), for answers that are not
 * secrets — a name, a confirmation.
 */

import { createInterface } from "readline";

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
 * Ask for one line on the terminal, echoed as a mask: the first
 * `shownPrefix` characters as typed, a "*" for each one after. Resolves
 * with the line, or null when the user cancels (Ctrl+C, or Ctrl+D on an
 * empty line). The caller checks process.stdin.isTTY first.
 */
export function readMaskedLine(prompt: string, shownPrefix: number): Promise<string | null> {
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

    // The echo of one chunk is written at once: a paste shows as one line.
    const onData = (chunk: string): void => {
      let echo = "";
      for (const char of chunk) {
        if (escaping) {
          // An escape sequence ends with its first letter or "~".
          if (/[A-Za-z~]/.test(char)) escaping = false;
          continue;
        }
        if (char === ESCAPE) {
          escaping = true;
        } else if (ENTER.has(char)) {
          process.stdout.write(echo);
          finish(value);
          return;
        } else if (char === CANCEL || (char === END_OF_INPUT && value === "")) {
          process.stdout.write(echo);
          finish(null);
          return;
        } else if (BACKSPACE.has(char)) {
          if (value !== "") {
            value = value.slice(0, -1);
            echo += "\b \b";
          }
        } else if (isPrintable(char)) {
          value += char;
          echo += value.length <= shownPrefix ? char : "*";
        }
      }
      process.stdout.write(echo);
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

/** One line typed on the terminal, shown as typed. The caller checks process.stdin.isTTY first. */
export function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
