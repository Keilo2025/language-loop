import fs from 'node:fs';
import path from 'node:path';
import { statePath } from './config.js';
import { exists, readJson, writeJson } from './util.js';

interface Manifest {
  id: string;
  createdAt: string;
  command: string;
  files: { path: string; backup: string; existed: boolean }[];
}

/**
 * Every write is undoable in one command.
 *
 * The loop edits source files. That is the whole point of it, and also the
 * reason it needs a way back — a bad extraction pass across two hundred
 * components is not something anyone wants to unpick by hand.
 */
export class Backup {
  private manifest: Manifest;
  private dir: string;

  constructor(private cwd: string, command: string) {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = statePath(cwd, 'backups', id);
    this.manifest = { id, createdAt: new Date().toISOString(), command, files: [] };
  }

  capture(relPath: string): void {
    if (this.manifest.files.some((f) => f.path === relPath)) return;
    const full = path.join(this.cwd, relPath);
    const target = path.join(this.dir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existed = exists(full);
    if (existed) fs.copyFileSync(full, target);
    this.manifest.files.push({ path: relPath, backup: path.relative(this.cwd, target), existed });
  }

  commit(): string | null {
    if (!this.manifest.files.length) return null;
    writeJson(path.join(this.dir, 'manifest.json'), this.manifest);
    writeJson(statePath(this.cwd, 'last-backup.json'), { id: this.manifest.id, dir: path.relative(this.cwd, this.dir) });
    return this.manifest.id;
  }

  rollback(): { restored: number; removed: number } {
    const result = restoreFiles(this.cwd, this.manifest);
    fs.rmSync(this.dir, { recursive: true, force: true });
    return result;
  }
}

export function revertLast(cwd: string): { restored: number; removed: number; id: string } | null {
  const pointer = readJson<{ id?: string; dir?: string }>(statePath(cwd, 'last-backup.json'), {});
  if (!pointer.dir) return null;
  const manifest = readJson<Manifest | null>(path.join(cwd, pointer.dir, 'manifest.json'), null);
  if (!manifest) return null;

  const { restored, removed } = restoreFiles(cwd, manifest);
  fs.rmSync(statePath(cwd, 'last-backup.json'), { force: true });
  return { restored, removed, id: manifest.id };
}

function restoreFiles(cwd: string, manifest: Manifest): { restored: number; removed: number } {
  let restored = 0;
  let removed = 0;
  for (const file of manifest.files) {
    const target = path.join(cwd, file.path);
    if (file.existed) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(cwd, file.backup), target);
      restored++;
    } else if (exists(target)) {
      fs.rmSync(target);
      removed++;
    }
  }
  return { restored, removed };
}
