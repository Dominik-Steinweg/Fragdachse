import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Obere Scene-/Runtime-/Adapter-Consumer lesen Player-Gameplay über die kleinen Read-Views
// statt über einen Durchgriff auf interne Runtime-Systeme. Diese Grenze ist dauerhaft: neue
// Consumer dürfen den gekapselten Player-Gameplay-Graphen nicht wieder öffnen.

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), root), { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

/** Erkennt einen externen Zugriff auf `WorldPlayerGameplayRuntime.systems`. */
const PLAYER_SYSTEMS_ACCESS =
  /(?:getWorldPlayerGameplayRuntime\(\)|worldPlayerGameplayRuntime|getPlayerGameplayRuntime\(\)|gameplay\.player|playerRuntime)\s*\??\.\s*systems\b/;

describe('PlayerGameplayReadViews – gekapselte Runtime-Grenze', () => {
  it('friert die verbleibenden externen WorldPlayerGameplayRuntime.systems-Consumer ein', () => {
    const offenders = listTypeScriptFiles('src')
      .filter((path) => PLAYER_SYSTEMS_ACCESS.test(read(path)))
      .sort();

    // Combat- und Targeting-Compositions dürfen weiterhin ihre eigenen Owner kennen; dieses
    // Muster trifft ausschließlich den Player-Gameplay-Graph.
    expect(offenders).toEqual([]);
  });
});
