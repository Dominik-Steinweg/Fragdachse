import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Teilphase 2B: obere Scene-/Runtime-/Adapter-Consumer lesen Player-Gameplay über die
// kleinen Read-Views von WorldPlayerGameplayRuntime (PlayerGameplayReadViews) statt über
// .systems-Durchgriff. Dieser Ratchet friert die verbleibenden .systems-Consumer ein –
// jeder neue Leak fällt hier auf, und ein wegportierter Consumer ebenfalls.

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

describe('PlayerGameplayReadViews – 2B Read-View-Grenze', () => {
  it('friert die verbleibenden externen WorldPlayerGameplayRuntime.systems-Consumer ein', () => {
    const offenders = listTypeScriptFiles('src')
      .filter((path) => PLAYER_SYSTEMS_ACCESS.test(read(path)))
      .sort();

    // Teilphase 12C schliesst die letzten Activity-/World-/Scene-Leaks. Die Combat- und
    // Targeting-Compositions duerfen weiterhin ihre eigenen `systems`-Owner kennen; dieses
    // Muster trifft ausschliesslich den Player-Gameplay-Graph.
    expect(offenders).toEqual([]);
  });

  it('führt die in 2B migrierten Consumer über die öffentlichen Read-Views', () => {
    const runtime = read('src/world/WorldPlayerGameplayRuntime.ts');
    expect(runtime).not.toContain('export interface WorldPlayerGameplaySystems');
    expect(runtime).toContain('private readonly systems: WorldPlayerGameplaySystems');
    for (const view of [
      'interface PlayerGameplayStateReadView',
      'interface PlayerGameplayLoadoutReadView',
      'interface PlayerGameplayResourceReadView',
      'interface PlayerGameplaySnapshotReadView',
      'type PlayerGameplayReadViews',
    ]) {
      expect(runtime, view).toContain(view);
    }

    const adapters = read('src/scenes/arena/ArenaRuntimeAdapters.ts');
    expect(adapters).toContain('flow.getWorldPlayerGameplayRuntime()?.isBurrowed(');
    expect(adapters).toContain('flow.getWorldPlayerGameplayRuntime()?.getAdrenaline(');
    expect(adapters).toContain('flow.getWorldPlayerGameplayRuntime()?.getAk47StrategicTargetNetSnapshot(');
    // Reads sind weg; nur noch Mutations-/Snapshot-Durchgriffe bleiben (siehe Ratchet oben).
    for (const goneRead of [
      '.systems.burrow?.isBurrowed(',
      '.systems.burrow?.isStunned(',
      '.systems.translocator?.getActivePuckId(',
      '.systems.loadout?.getEquippedUtilityConfig(',
      '.systems.utilityAction?.getTemporaryUtilityConfig(',
      '.systems.resource?.getAdrenaline(',
      '.systems.resource.getMaxAdrenaline(',
      '.systems?.ak47StrategicTarget',
    ]) {
      expect(adapters, goneRead).not.toContain(goneRead);
    }

    const arenaRuntime = read('src/scenes/arena/ArenaRuntime.ts');
    expect(arenaRuntime).toContain('.getTranslocatorActivePuckId(playerId)');
    expect(arenaRuntime).toContain('.getTunnelNetSnapshot()');
    expect(arenaRuntime).toContain('.getRemoteControlSnapshot(');
    expect(arenaRuntime).not.toContain('.systems?.itemRuntime?.getRemoteControlSnapshot(');

    const rockHelper = read('src/scenes/arena/RockVisualHelper.ts');
    expect(rockHelper).toContain('.getPlayerGameplayRuntime()?.getPlayerClassId(');
    expect(rockHelper).not.toMatch(/playerSystems\b/);
  });
});