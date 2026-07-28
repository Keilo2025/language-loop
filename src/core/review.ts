import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Config, GuardrailIssue, Memory, TranslationUnit } from '../types.js';
import { statePath } from './config.js';
import { localeInfo } from './locales.js';
import { commandForStage } from './report.js';
import { readJson, writeJson } from './util.js';

/**
 * A human decides. Always.
 *
 * The reviewer usually cannot read most of the languages in front of them, and
 * that is fine — their job is not to check the German. It is to check that the
 * *decisions* are right: that the button still fits, that the brand name
 * survived, that the tone matches the product, that the translator's note
 * about formality is the choice this company wants to make. So the card leads
 * with what changed and why, not with a wall of foreign text.
 */

export interface Decision {
  key: string;
  locale: string;
  approved: boolean;
  value: string;
  editedByHuman: boolean;
}

export interface ReviewBundle {
  units: TranslationUnit[];
  issues: Map<string, GuardrailIssue[]>;
  blocked: { unit: TranslationUnit; issues: GuardrailIssue[] }[];
  /**
   * Decisions already taken for units the reviewer is deliberately not being
   * shown — the guardrail-clean ones under `review --flagged`. `apply` reads
   * decisions.json *instead of* auto-approving when the file exists, so these
   * have to be merged in at save time or a narrowed review would silently drop
   * every translation it did not display.
   */
  carry?: Record<string, Decision>;
}

export function loadDecisions(cwd: string): Record<string, Decision> {
  return readJson<Record<string, Decision>>(statePath(cwd, 'decisions.json'), {});
}

export function saveDecisions(cwd: string, decisions: Record<string, Decision>): void {
  writeJson(statePath(cwd, 'decisions.json'), decisions);
}

export function unitId(key: string, locale: string): string {
  return `${key}::${locale}`;
}

// ---------------------------------------------------------------------------
// Markdown review — works over SSH, in a PR, on a phone
// ---------------------------------------------------------------------------

export function writeReviewMarkdown(cwd: string, bundle: ReviewBundle, config: Config, memory: Memory): string {
  const lines: string[] = [];
  lines.push('# Translation review');
  lines.push('');
  lines.push('Tick the box to approve. Edit the text in the `to:` line to change it — whatever is there');
  lines.push('when you run `--collect` is what gets written. Leave a box unticked to reject.');
  lines.push('');
  lines.push('```');
  lines.push(commandForStage(config, 'review --collect'));
  lines.push(commandForStage(config, 'apply'));
  lines.push('```');
  lines.push('');

  if (bundle.blocked.length) {
    lines.push(`## Blocked — ${bundle.blocked.length}`);
    lines.push('');
    lines.push('These never reach you as a choice. Something is wrong with them mechanically.');
    lines.push('');
    for (const { unit, issues } of bundle.blocked) {
      lines.push(`- \`${unit.key}\` · ${unit.locale} — ${issues.map((i) => i.message).join('; ')}`);
      lines.push(`  - from: ${JSON.stringify(unit.source)}`);
      lines.push(`  - to:   ${JSON.stringify(unit.value)}`);
    }
    lines.push('');
  }

  const byLocale = new Map<string, TranslationUnit[]>();
  for (const unit of bundle.units) {
    if (!byLocale.has(unit.locale)) byLocale.set(unit.locale, []);
    byLocale.get(unit.locale)!.push(unit);
  }

  for (const [locale, units] of byLocale) {
    lines.push(`## ${locale} — ${localeInfo(locale).english} (${units.length})`);
    lines.push('');
    for (const unit of units) {
      const issues = bundle.issues.get(unitId(unit.key, unit.locale)) ?? [];
      lines.push(`- [ ] \`${unit.key}\` · ${unit.kind} · \`${unit.file}\``);
      lines.push(`  - from: ${JSON.stringify(unit.source)}`);
      lines.push(`  - to:   ${JSON.stringify(unit.value)}`);
      const previous = memory.entries[unit.key]?.translations[locale];
      if (previous && unit.status === 'stale') lines.push(`  - was:  ${JSON.stringify(previous.value)}`);
      if (unit.notes) lines.push(`  - note: ${unit.notes}`);
      for (const issue of issues) lines.push(`  - ⚠ ${issue.rule}: ${issue.message}`);
      lines.push('');
    }
  }

  const file = statePath(cwd, 'review.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return path.relative(cwd, file);
}

export function collectReviewMarkdown(cwd: string): Record<string, Decision> {
  const file = statePath(cwd, 'review.md');
  const content = fs.readFileSync(file, 'utf8');
  const decisions: Record<string, Decision> = {};
  const lines = content.split('\n');

  let currentLocale = '';
  let current: { key: string; approved: boolean } | null = null;

  for (const line of lines) {
    const localeMatch = /^##\s+([a-zA-Z-]+)\s+—/.exec(line);
    if (localeMatch && localeMatch[1] !== 'Blocked') currentLocale = localeMatch[1]!;

    const itemMatch = /^-\s+\[( |x|X)\]\s+`([^`]+)`/.exec(line);
    if (itemMatch) {
      current = { key: itemMatch[2]!, approved: itemMatch[1]!.toLowerCase() === 'x' };
      continue;
    }
    const toMatch = /^\s+-\s+to:\s+(.+)$/.exec(line);
    if (toMatch && current && currentLocale) {
      let value: string;
      try {
        value = JSON.parse(toMatch[1]!.trim());
      } catch {
        value = toMatch[1]!.trim().replace(/^"|"$/g, '');
      }
      decisions[unitId(current.key, currentLocale)] = {
        key: current.key,
        locale: currentLocale,
        approved: current.approved,
        value,
        editedByHuman: false,
      };
      current = null;
    }
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

export async function serveReview(
  cwd: string,
  bundle: ReviewBundle,
  config: Config,
  memory: Memory,
  port = 4747
): Promise<{ url: string; close: () => void; done: Promise<Record<string, Decision>> }> {
  const existing = loadDecisions(cwd);
  const payload = bundle.units.map((unit) => {
    const id = unitId(unit.key, unit.locale);
    const previous = memory.entries[unit.key]?.translations[unit.locale];
    return {
      id,
      key: unit.key,
      locale: unit.locale,
      localeName: localeInfo(unit.locale).english,
      rtl: localeInfo(unit.locale).rtl,
      kind: unit.kind,
      file: unit.file,
      source: unit.source,
      value: existing[id]?.value ?? unit.value,
      was: unit.status === 'stale' ? previous?.value ?? '' : '',
      note: unit.notes ?? '',
      placeholders: unit.placeholders,
      warnings: (bundle.issues.get(id) ?? []).map((i) => `${i.rule}: ${i.message}`),
      approved: existing[id]?.approved ?? false,
    };
  });

  let resolveDone: (d: Record<string, Decision>) => void;
  const done = new Promise<Record<string, Decision>>((resolve) => (resolveDone = resolve));

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(reviewHtml(payload, config, bundle.blocked.length));
      return;
    }
    if (req.method === 'POST' && req.url === '/save') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body) as { id: string; approved: boolean; value: string; edited: boolean }[];
          const decisions: Record<string, Decision> = {};
          for (const item of incoming) {
            const [key, locale] = item.id.split('::');
            decisions[item.id] = {
              key: key!,
              locale: locale!,
              approved: item.approved,
              value: item.value,
              editedByHuman: item.edited,
            };
          }
          // Carried decisions first, so anything the reviewer actually touched
          // wins over the automatic approval it would otherwise have had.
          saveDecisions(cwd, { ...(bundle.carry ?? {}), ...decisions });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: incoming.length }));
          resolveDone(decisions);
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(error) }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    done,
  };
}

function reviewHtml(items: unknown[], config: Config, blockedCount: number): string {
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>language-loop review</title>
<style>
  :root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1a1a19; --muted:#6b6b68; --line:#e3e2df; --accent:#2d6a4f; --warn:#9a5b00; --card:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --fg:#eeedeb; --muted:#9a9a96; --line:#2e2e2c; --accent:#74c69d; --warn:#e0a458; --card:#1e1e1c; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:14px 24px; display:flex; gap:16px; align-items:center; z-index:5; }
  h1 { font-size:16px; margin:0; font-weight:600; letter-spacing:-.01em; }
  .muted { color:var(--muted); font-size:13px; }
  main { max-width:920px; margin:0 auto; padding:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:14px; }
  .card.on { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
  .card.focus { outline:2px solid var(--accent); outline-offset:2px; }
  .meta { display:flex; gap:10px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin-bottom:12px; align-items:center; }
  .tag { border:1px solid var(--line); border-radius:99px; padding:1px 9px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:720px) { .grid { grid-template-columns:1fr; } }
  .lbl { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin-bottom:5px; }
  .src { padding:10px 12px; background:var(--bg); border:1px solid var(--line); border-radius:7px; white-space:pre-wrap; }
  textarea { width:100%; min-height:74px; padding:10px 12px; border:1px solid var(--line); border-radius:7px; background:var(--bg); color:var(--fg); font:inherit; resize:vertical; }
  .was { font-size:13px; color:var(--muted); margin-top:8px; }
  .note { font-size:13px; margin-top:10px; padding:8px 11px; border-left:2px solid var(--accent); background:var(--bg); }
  .warn { font-size:13px; margin-top:8px; color:var(--warn); }
  .actions { margin-top:14px; display:flex; gap:8px; }
  button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:7px; padding:7px 15px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .bar { margin-left:auto; display:flex; gap:8px; align-items:center; }
  kbd { border:1px solid var(--line); border-bottom-width:2px; border-radius:4px; padding:0 5px; font:12px ui-monospace,monospace; }
</style></head>
<body>
<header>
  <h1>language-loop</h1>
  <span class="muted" id="count"></span>
  ${blockedCount ? `<span class="muted">· ${blockedCount} blocked by guardrails, not shown</span>` : ''}
  <div class="bar">
    <span class="muted"><kbd>j</kbd><kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject</span>
    <button class="primary" id="save">Save decisions</button>
  </div>
</header>
<main id="list"></main>
<script>
const items = ${data};
const list = document.getElementById('list');
let focus = 0;

function render() {
  list.innerHTML = '';
  items.forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'card' + (it.approved ? ' on' : '') + (i === focus ? ' focus' : '');
    card.innerHTML = \`
      <div class="meta">
        <span class="tag">\${it.locale} · \${it.localeName}</span>
        <span class="tag">\${it.kind}</span>
        <code>\${it.key}</code>
        <span>\${it.file}</span>
      </div>
      <div class="grid">
        <div><div class="lbl">Source</div><div class="src">\${esc(it.source)}</div></div>
        <div><div class="lbl">Translation — edit freely</div>
          <textarea data-i="\${i}" dir="\${it.rtl ? 'rtl' : 'ltr'}">\${esc(it.value)}</textarea></div>
      </div>
      \${it.was ? '<div class="was">Previously: ' + esc(it.was) + '</div>' : ''}
      \${it.note ? '<div class="note">' + esc(it.note) + '</div>' : ''}
      \${it.warnings.map(w => '<div class="warn">⚠ ' + esc(w) + '</div>').join('')}
      <div class="actions">
        <button data-approve="\${i}" class="\${it.approved ? 'primary' : ''}">\${it.approved ? 'Approved' : 'Approve'}</button>
        <button data-reject="\${i}">Reject</button>
      </div>\`;
    list.appendChild(card);
  });
  document.getElementById('count').textContent = items.filter(i => i.approved).length + ' of ' + items.length + ' approved';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

list.addEventListener('input', e => {
  const i = e.target.dataset.i;
  if (i !== undefined) { items[i].value = e.target.value; items[i].edited = true; }
});
list.addEventListener('click', e => {
  const a = e.target.dataset.approve, r = e.target.dataset.reject;
  if (a !== undefined) { items[a].approved = true; render(); }
  if (r !== undefined) { items[r].approved = false; render(); }
});
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'j') { focus = Math.min(focus + 1, items.length - 1); render(); scrollTo(); }
  if (e.key === 'k') { focus = Math.max(focus - 1, 0); render(); scrollTo(); }
  if (e.key === 'a') { items[focus].approved = true; render(); }
  if (e.key === 'r') { items[focus].approved = false; render(); }
});
function scrollTo() { list.children[focus]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
document.getElementById('save').onclick = async () => {
  const res = await fetch('/save', { method: 'POST', body: JSON.stringify(items.map(i => ({ id: i.id, approved: i.approved, value: i.value, edited: !!i.edited }))) });
  const json = await res.json();
  document.getElementById('save').textContent = json.ok ? 'Saved — run apply' : 'Failed';
};
render();
</script>
</body></html>`;
}
