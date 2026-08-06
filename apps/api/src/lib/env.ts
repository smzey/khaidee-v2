import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function candidateEnvFiles(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, '.env'),
    join(cwd, 'apps/api/.env'),
    join(dirname(dirname(cwd)), '.env'),
  ];
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
  if (!match) return null;
  const key = match[1];
  const rawValue = match[2];
  if (!key || rawValue === undefined) return null;
  let value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export function loadEnv(): void {
  const seen = new Set<string>();
  for (const file of candidateEnvFiles()) {
    const resolved = resolve(file);
    if (seen.has(resolved) || !existsSync(resolved)) continue;
    seen.add(resolved);
    for (const line of readFileSync(resolved, 'utf8').split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      process.env[key] ??= value;
    }
  }
}

loadEnv();
