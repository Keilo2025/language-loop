import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Interactive prompts with no dependencies.
 *
 * `init` is the one command where asking beats guessing: which agent someone
 * uses and which languages they want are facts no amount of file-sniffing will
 * tell you reliably, and getting either wrong wastes a whole run.
 */

export interface Choice {
  value: string;
  label: string;
  hint?: string;
  preselected?: boolean;
}

export interface MultiOptions {
  hint?: string;
  /** Extra lines printed under the list — shortcuts, search help. */
  legend?: string[];
  /**
   * Tokens that are neither an index nor a listed value are offered here.
   * Return the values the token expands to, or `{ reprompt: true }` to redraw
   * and ask again — which is how search prints its matches and waits.
   */
  resolve?: (token: string, choices: Choice[]) => { values?: string[]; reprompt?: boolean } | null;
}

export class Prompt {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input: stdin, output: stdout });
  }

  close(): void {
    this.rl.close();
  }

  async text(question: string, fallback = ''): Promise<string> {
    const suffix = fallback ? ` (${fallback})` : '';
    const answer = (await this.rl.question(`${question}${suffix}\n> `)).trim();
    return answer || fallback;
  }

  async confirm(question: string, fallback = true): Promise<boolean> {
    const suffix = fallback ? ' [Y/n]' : ' [y/N]';
    const answer = (await this.rl.question(`${question}${suffix} `)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer.startsWith('y');
  }

  async pick(question: string, choices: Choice[], fallback?: string): Promise<string> {
    console.log(`\n${question}`);
    choices.forEach((choice, i) => {
      const mark = choice.value === fallback ? '·' : ' ';
      console.log(` ${mark} ${String(i + 1).padStart(2)}. ${choice.label}${choice.hint ? `  — ${choice.hint}` : ''}`);
    });
    const answer = (await this.rl.question(`> `)).trim();
    if (!answer && fallback) return fallback;
    const index = Number.parseInt(answer, 10);
    if (Number.isFinite(index) && index >= 1 && index <= choices.length) return choices[index - 1]!.value;
    const byValue = choices.find((c) => c.value.toLowerCase() === answer.toLowerCase());
    if (byValue) return byValue.value;
    return fallback ?? choices[0]!.value;
  }

  async multi(
    question: string,
    choices: Choice[],
    hintOrOptions: string | MultiOptions = 'numbers or codes, comma separated'
  ): Promise<string[]> {
    const options: MultiOptions =
      typeof hintOrOptions === 'string' ? { hint: hintOrOptions } : hintOrOptions;
    const hint = options.hint ?? 'numbers or codes, comma separated';

    console.log(`\n${question}`);
    this.printChoices(choices);
    for (const line of options.legend ?? []) console.log(`   ${line}`);
    console.log(`   (${hint})`);

    // Loops so a search can print its matches and ask again without losing
    // the question. Everything else returns on the first pass.
    for (;;) {
      const answer = (await this.rl.question('> ')).trim();
      if (!answer) return choices.filter((c) => c.preselected).map((c) => c.value);

      const picked: string[] = [];
      let reprompt = false;

      for (const token of answer.split(/[,\s]+/).filter(Boolean)) {
        const index = Number.parseInt(token, 10);
        if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
          picked.push(choices[index - 1]!.value);
          continue;
        }
        const match = choices.find((c) => c.value.toLowerCase() === token.toLowerCase());
        if (match) {
          picked.push(match.value);
          continue;
        }
        const resolved = options.resolve?.(token, choices);
        if (resolved?.reprompt) {
          reprompt = true;
          continue;
        }
        if (resolved?.values?.length) {
          picked.push(...resolved.values);
          continue;
        }
        picked.push(token); // an unlisted but valid locale code
      }

      if (reprompt && !picked.length) continue;
      return [...new Set(picked)];
    }
  }

  /** Public so callers can print search results in the same shape as the list. */
  printChoices(choices: Choice[]): void {
    const width = String(choices.length).length;
    choices.forEach((choice, i) => {
      const mark = choice.preselected ? '·' : ' ';
      console.log(
        ` ${mark} ${String(i + 1).padStart(width)}. ${choice.label}${choice.hint ? `  — ${choice.hint}` : ''}`
      );
    });
  }
}

export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}
