import { statePath } from './config.js';
import { localeInfo } from './locales.js';
import { writeJson } from './util.js';

/**
 * One specialist per target language. English → German, Russian and French
 * means three sub-agents, each a specialist in that language.
 */

export const SWARM_FILE = 'swarm.json';

export interface SwarmSpecialist {
  locale: string;
  language: string;
  nativeName: string;
  agentId: string;
}

export interface SwarmState {
  version: 1;
  sourceLocale: string;
  activeLocale: string;
  specialists: SwarmSpecialist[];
}

export function specialistAgentId(locale: string): string {
  return `${locale}-specialist`;
}

export function swarmRoster(locales: readonly string[]): SwarmSpecialist[] {
  const seen = new Set<string>();
  const roster: SwarmSpecialist[] = [];
  for (const locale of locales) {
    if (seen.has(locale)) continue;
    seen.add(locale);
    const info = localeInfo(locale);
    roster.push({
      locale,
      language: info.english,
      nativeName: info.name,
      agentId: specialistAgentId(locale),
    });
  }
  return roster;
}

export function writeSwarmState(cwd: string, state: SwarmState): string {
  writeJson(statePath(cwd, SWARM_FILE), state);
  return `.language-loop/${SWARM_FILE}`;
}

/** Shared rule for installed agent files, the skill, and the brief. */
export function swarmLeadRule(): string {
  return [
    'Always create a language swarm agent specialist in the language they have to translate.',
    'If you translate English to German, Russian and French, you have 3 sub-agents which are',
    'specialists on the specific language — one German specialist, one Russian specialist,',
    'and one French specialist.',
    '',
    '- Spawn **one named specialist per target language** in a single message before anyone',
    '  writes a translation. Name them `<locale>-specialist` (e.g. `de-DE-specialist`).',
    '- The lead does not translate. Each specialist translates only their language.',
    '- The CLI still briefs one language at a time. The matching specialist owns that brief;',
    '  the other specialists stay assigned to their locales for later batches.',
  ].join('\n');
}

export function swarmBriefSection(roster: SwarmSpecialist[], activeLocale: string): string {
  const lines: string[] = [];
  lines.push('## Language swarm');
  lines.push('');
  lines.push(swarmLeadRule());
  lines.push('');
  if (!roster.length) return lines.join('\n');

  lines.push('Spawn these specialists now:');
  lines.push('');
  for (const specialist of roster) {
    const active = specialist.locale === activeLocale ? ' — owns this brief' : '';
    lines.push(
      `- \`${specialist.agentId}\` — ${specialist.language} (\`${specialist.locale}\`, ${specialist.nativeName})${active}`
    );
  }
  lines.push('');
  return lines.join('\n');
}
