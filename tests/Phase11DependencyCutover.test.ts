import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Phase 11B dependency cutover', () => {
  it('bindet RPCs an fachliche Ports statt ArenaContext, Lifecycle oder konkrete Runtime-Owner', () => {
    const rpc = read('src/scenes/arena/RpcCoordinator.ts');
    expect(rpc).not.toMatch(/ArenaContext|ArenaLifecycleCoordinator|ArenaPersistentBaseSession/);
    expect(rpc).not.toMatch(/getWorld(PlayerGameplay|PowerUp)Runtime/);
    expect(rpc).not.toContain('this.ctx');
    for (const port of [
      'WorldParticipationRpcPort',
      'PlayerCapabilitiesRpcPort',
      'ConstructionRpcPort',
      'PersistentBaseRpcPort',
      'PlayerLoadoutRpcPort',
      'HeldActionRpcPort',
    ]) {
      expect(rpc, port).toContain(port);
    }
  });

  it('laesst Construction-RPCs direkt am World-Owner enden', () => {
    const flow = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    for (const adapter of [
      'placeInspectorConstruction(',
      'useInspectorUtility(',
      'dismantleConstruction(',
      'dismantleAllOwnedConstructions(',
    ]) {
      expect(flow, adapter).not.toContain(adapter);
    }
    const scene = read('src/scenes/ArenaScene.ts');
    expect(scene).toContain('getConstructionWorldRuntime()?.placeInspectorConstruction(');
    expect(scene).toContain('getConstructionWorldRuntime()?.useInspectorUtility(');
  });

  it('ordnet Host-held Actions dem World-Player-Owner zu', () => {
    const context = read('src/scenes/arena/ArenaContext.ts');
    const runtime = read('src/world/WorldPlayerGameplayRuntime.ts');
    expect(context).not.toContain('HostHeldActionSystem');
    expect(context).not.toContain('hostHeldActionSystem');
    expect(runtime).toContain('readonly heldAction: HostHeldActionSystem;');
    expect(runtime).toContain('systems.heldAction.reset();');
  });

  it('verdichtet Frame-Reads auf wenige kleine World-, Player-, Combat- und Activity-Ports', () => {
    const host = read('src/scenes/arena/HostUpdateCoordinator.ts');
    const client = read('src/scenes/arena/ClientUpdateCoordinator.ts');
    for (const source of [host, client]) {
      expect(source).toContain('setWorldFramePort(');
      expect(source).toContain('setPlayerFramePort(');
      expect(source).toContain('setActivityFramePort(');
      expect(source).not.toMatch(/setWorld[A-Z]\w+RuntimeResolver/);
      expect(source).not.toContain('setActivityStepResolver');
    }
    expect(host).toContain('setCombatFramePort(');
  });

  it('haelt adressierten Runtime-/Domain-Code von der Bridge frei', () => {
    for (const path of [
      'src/world/WorldPlayerGameplayRuntime.ts',
      'src/world/ConstructionWorldRuntime.ts',
      'src/scenes/arena/ArenaRpcPorts.ts',
    ]) {
      expect(read(path), path).not.toMatch(/NetworkBridge|network\/bridge|\bbridge\b/);
    }
  });
});
