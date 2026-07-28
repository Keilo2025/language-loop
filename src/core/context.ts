import fs from 'node:fs';
import path from 'node:path';
import type { ComponentContext, Memory } from '../types.js';
import { posix, sha } from './util.js';

export interface ContextOptions {
  radius?: number;
  maxChars?: number;
  maxNeighborKeys?: number;
}

export function extractComponentContext(
  cwd: string,
  key: string,
  locale: string,
  memory: Memory,
  options: ContextOptions = {}
): ComponentContext {
  const entry = memory.entries[key];
  if (!entry) throw new Error(`Cannot extract component context: unknown key ${key}.`);
  const root = fs.realpathSync(cwd);
  if (path.isAbsolute(entry.file)) {
    throw new Error(`Cannot extract component context: ${entry.file} must be relative to the project.`);
  }
  const lexicalTarget = path.resolve(root, entry.file);
  assertWithin(root, lexicalTarget, entry.file);
  const neighborKeys = Object.entries(memory.entries)
    .filter(([otherKey, other]) => otherKey !== key && posix(other.file) === posix(entry.file))
    .map(([otherKey]) => otherKey)
    .sort()
    .slice(0, Math.max(0, options.maxNeighborKeys ?? 12));
  if (!fs.existsSync(lexicalTarget)) {
    return finishContext({
      key,
      locale,
      file: posix(entry.file),
      component: entry.component,
      line: entry.line,
      startLine: 0,
      endLine: 0,
      excerpt: '',
      neighborKeys,
    });
  }
  let target: string;
  try {
    target = fs.realpathSync(lexicalTarget);
  } catch {
    return finishContext({
      key,
      locale,
      file: posix(entry.file),
      component: entry.component,
      line: entry.line,
      startLine: 0,
      endLine: 0,
      excerpt: '',
      neighborKeys,
    });
  }
  assertWithin(root, target, entry.file);

  const source = fs.readFileSync(target, 'utf8');
  const lines = source.split(/\r?\n/);
  const radius = Math.max(0, options.radius ?? 4);
  const requestedLine = Math.min(Math.max(1, entry.line ?? 1), Math.max(1, lines.length));
  const startLine = Math.max(1, requestedLine - radius);
  const endLine = Math.min(lines.length, requestedLine + radius);
  const numbered = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
  const excerpt = redactContext(numbered).slice(0, Math.max(1, options.maxChars ?? 4_000));
  return finishContext({
    key,
    locale,
    file: posix(entry.file),
    component: entry.component,
    line: entry.line,
    startLine,
    endLine,
    excerpt,
    neighborKeys,
  });
}

export function contextMap(
  cwd: string,
  memory: Memory,
  items: { key: string; locale: string }[],
  options?: ContextOptions
): Map<string, ComponentContext> {
  return new Map(items.map((item) => [
    `${item.key}::${item.locale}`,
    extractComponentContext(cwd, item.key, item.locale, memory, options),
  ]));
}

function assertWithin(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Cannot extract component context: ${label} resolves outside the project.`);
  }
}

function finishContext(
  value: Omit<ComponentContext, 'version' | 'hash'>
): ComponentContext {
  const packetWithoutHash = {
    version: 1 as const,
    key: value.key,
    locale: value.locale,
    file: value.file,
    ...(value.component ? { component: value.component } : {}),
    ...(value.line ? { line: value.line } : {}),
    startLine: value.startLine,
    endLine: value.endLine,
    excerpt: value.excerpt,
    neighborKeys: value.neighborKeys,
  };
  return { ...packetWithoutHash, hash: sha(JSON.stringify(packetWithoutHash)) };
}

function redactContext(text: string): string {
  return text
    .replace(
      /\b(api[_-]?key|access[_-]?token|secret|password)\b(\s*[:=]\s*)(["'`])[^"'`\r\n]*\3/gi,
      (_match, name: string, separator: string, quote: string) =>
        `${name}${separator}${quote}[REDACTED]${quote}`
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [REDACTED]');
}
