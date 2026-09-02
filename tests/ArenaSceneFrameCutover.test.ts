import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readScene(): string {
  return readFileSync(resolve(process.cwd(), 'src/scenes/ArenaScene.ts'), 'utf8');
}

function updateBody(): string {
  const source = readScene();
  const start = source.indexOf('  update(_time: number, delta: number): void {');
  const end = source.indexOf('\n  private resolveArenaFrameSignals', start);
  expect(start, 'ArenaScene.update() nicht gefunden').toBeGreaterThan(-1);
  expect(end, 'Ende von ArenaScene.update() nicht gefunden').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Phase 8 – ArenaScene-Frame-Cutover', () => {
  it('zeigt im Frame nur benannte Top-Level-Orchestrierungsschritte', () => {
    const update = updateBody();

    for (const step of [
      'const frame = this.resolveArenaFrameSignals(phase, deferArenaExit);',
      'this.arenaRuntime.update(delta);',
      'this.inputBindings?.updateFrame({',
      'this.syncArenaLobbyFrame(',
      'this.runArenaRoleFrame(',
      'this.syncArenaVisualEffects(inArena, delta, diagnosticsFrame);',
      'this.syncArenaAimAndPlacementPresentation(',
      'this.applyCameraFeedback(delta);',
      'ChunkedRenderSurface.flushBakeBudget(',
      'bridge.flushNetwork();',
    ]) {
      expect(update, step).toContain(step);
    }

    for (const longDomainBlock of [
      'this.ctx.centerHUD.updateTimer(',
      'this.lobbyOverlay.refreshPlayerList(',
      'this.renderers.beer.update(',
      'this.renderers.reinforcementMatrix.syncVisuals(',
      'this.ctx.aimSystem?.update(',
    ]) {
      expect(update, longDomainBlock).not.toContain(longDomainBlock);
    }
  });

  it('bewahrt die verifizierte Reihenfolge der groben Frame-Schritte', () => {
    const update = updateBody();
    const positions = [
      update.indexOf('this.arenaRuntime.syncRoomOwners();'),
      update.indexOf('this.arenaRuntime.update(delta);'),
      update.indexOf('this.inputBindings?.updateFrame({'),
      update.indexOf('this.runArenaRoleFrame('),
      update.indexOf('this.arenaRuntime.syncWorldCamera(spectator ? 0 : delta, presentationPolicy.showWorld);'),
      update.indexOf('this.syncArenaVisualEffects(inArena, delta, diagnosticsFrame);'),
      update.indexOf('this.syncArenaAimAndPlacementPresentation('),
      update.indexOf('this.applyCameraFeedback(delta);'),
      update.indexOf('ChunkedRenderSurface.flushBakeBudget('),
      update.indexOf('this.syncBootReveal(phase);'),
      update.indexOf('bridge.flushNetwork();'),
    ];

    expect(positions.every(position => position >= 0)).toBe(true);
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index], `Frame-Schritt ${index} steht an der falschen Position`)
        .toBeGreaterThan(positions[index - 1]);
    }
  });

  it('führt den Activity-Client-Presentation-Step weiterhin nicht aus der Scene aus', () => {
    const scene = readScene();
    expect(scene).not.toContain('clientPresentationStep(');
  });
});

describe('Phase 9 – ArenaScene-Cleanup und Architektur-Gate', () => {
  it('entfernt die verbliebenen World-/Activity-Kompatibilitaetsfassaden', () => {
    const scene = readScene();
    expect(scene).not.toMatch(/private get (worldRuntime|world|arenaResult|currentLayout|placementSystem|rockRegistry|baseManager|targetingSystems|playerSystems|combatSystems|supportSystems|powerUpSystem|trainManager|coopMissionRuntime|enemyManager|captureTheBeerSystem)\b/);
    expect(scene).not.toContain('ArenaSceneController');
    expect(scene).not.toMatch(/private [A-Za-z][A-Za-z0-9]*(?:Counter|Sampler|Key|Handler)\s*[=:]/);
  });
});
