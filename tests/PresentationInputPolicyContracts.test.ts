import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInputPolicy, type InputPolicyInput } from '../src/world/InputPolicy';
import { resolvePlayerCapabilities } from '../src/world/PlayerCapabilities';
import { resolvePresentationPolicy, type PresentationPolicyInput } from '../src/world/PresentationPolicy';
import { WORLD_PRESENTATION_SURFACES } from '../src/world/WorldPresentation';

/**
 * Presentation und Input werden zentral abgeleitet.
 *
 * Die lokale Scene soll nicht selbst zahlreiche Zustandskombinationen interpretieren. Beide
 * Policies sind rein: dieselbe Eingabe ergibt dasselbe Ergebnis, und ihre Eingaben sind genau
 * die Zustaende, die das Konzept nennt.
 */

const FULL_PRESENTATION = { required: true, surfaces: WORLD_PRESENTATION_SURFACES } as const;
const NO_PRESENTATION = { required: false, surfaces: [] } as const;

function presentation(overrides: Partial<PresentationPolicyInput> = {}): PresentationPolicyInput {
  return {
    inLobby: false,
    worldPresentation: FULL_PRESENTATION,
    worldVisible: true,
    gameplayActive: true,
    roundRole: 'participant',
    matchTerminated: false,
    spectatorPanAvailable: true,
    ...overrides,
  };
}

function inputPolicy(overrides: Partial<InputPolicyInput> = {}): InputPolicyInput {
  return {
    capabilities: resolvePlayerCapabilities({ participation: 'interactive', activityKind: 'coop-mission' }),
    gameplayActive: true,
    countdownActive: false,
    uiBlocking: false,
    diagnosticsArena: false,
    ...overrides,
  };
}

describe('Presentation Policy', () => {
  it('zeigt die World nur, wenn dieser Peer sie ueberhaupt darstellt', () => {
    expect(resolvePresentationPolicy(presentation()).showWorld).toBe(true);
    // Host ohne Teilnahme: die Simulation laeuft, die Darstellung nicht.
    expect(resolvePresentationPolicy(presentation({ worldPresentation: NO_PRESENTATION })).showWorld).toBe(false);
    expect(resolvePresentationPolicy(presentation({ worldVisible: false })).showWorld).toBe(false);
  });

  it('bindet HUD und Kameras an die sichtbare World', () => {
    const running = resolvePresentationPolicy(presentation());
    expect(running.showHud).toBe(true);
    expect(running.useWorldCamera).toBe(true);
    expect(running.useSpectatorCamera).toBe(false);

    // Vor dem Rundenstart bleibt das HUD still, die Welt ist aber schon zu sehen.
    const countdown = resolvePresentationPolicy(presentation({ gameplayActive: false }));
    expect(countdown.showWorld).toBe(true);
    expect(countdown.showHud).toBe(false);

    // Ein Spectator fuehrt seine eigene Kamera statt der Weltkamera.
    const spectator = resolvePresentationPolicy(presentation({ roundRole: 'spectator' }));
    expect(spectator.useWorldCamera).toBe(false);
    expect(spectator.useSpectatorCamera).toBe(true);
    expect(resolvePresentationPolicy(presentation({ roundRole: 'spectator', spectatorPanAvailable: false }))
      .useSpectatorCamera).toBe(false);
  });

  it('beendet mit dem technischen Abbruch jede Darstellung', () => {
    const terminated = resolvePresentationPolicy(presentation({ matchTerminated: true, inLobby: true }));
    expect(terminated).toEqual({
      showLobby: false,
      showWorld: false,
      showHud: false,
      useWorldCamera: false,
      useSpectatorCamera: false,
    });
  });

  it('zeigt die Lobby genau im Raumzustand Lobby', () => {
    expect(resolvePresentationPolicy(presentation({ inLobby: true })).showLobby).toBe(true);
    expect(resolvePresentationPolicy(presentation({ inLobby: false })).showLobby).toBe(false);
  });
});

describe('Input Policy', () => {
  it('gibt einem handelnden Spieler die vollen Eingaben', () => {
    const policy = resolveInputPolicy(inputPolicy());
    expect(policy).toEqual({
      movement: true,
      combat: true,
      placement: true,
      worldInteraction: true,
      cameraNavigation: true,
      aim: true,
    });
  });

  it('haelt im Countdown Bewegung an, aber Zielen und Weltinteraktion offen', () => {
    const policy = resolveInputPolicy(inputPolicy({ gameplayActive: false, countdownActive: true }));
    expect(policy.movement).toBe(false);
    expect(policy.combat).toBe(false);
    expect(policy.aim).toBe(true);
    expect(policy.worldInteraction).toBe(true);
  });

  it('sperrt alles hinter einer Oberflaeche', () => {
    const policy = resolveInputPolicy(inputPolicy({ uiBlocking: true, countdownActive: true }));
    expect(policy).toEqual({
      movement: false,
      combat: false,
      placement: false,
      worldInteraction: false,
      cameraNavigation: false,
      aim: false,
    });
  });

  it('laesst einem Beobachter nur die Kamera', () => {
    const observer = resolveInputPolicy(inputPolicy({
      capabilities: resolvePlayerCapabilities({ participation: 'observer', activityKind: 'coop-mission' }),
    }));
    expect(observer.cameraNavigation).toBe(true);
    expect(observer.movement).toBe(false);
    expect(observer.aim).toBe(false);
    expect(observer.worldInteraction).toBe(false);
  });

  it('kennt in einer World ohne Activity Bauen, aber keinen Kampf', () => {
    const editor = resolveInputPolicy(inputPolicy({
      capabilities: resolvePlayerCapabilities({ participation: 'interactive', activityKind: null }),
    }));
    expect(editor.movement).toBe(true);
    expect(editor.placement).toBe(true);
    expect(editor.combat).toBe(false);
  });

  it('sperrt das Gameplay der Diagnose-Arena, nicht aber ihre Countdown-Interaktion', () => {
    // Genau die bestehende Semantik: der Lab-Filter hing am Gameplay, nicht am Countdown-Zweig.
    const running = resolveInputPolicy(inputPolicy({ diagnosticsArena: true }));
    expect(running.movement).toBe(false);
    expect(running.aim).toBe(false);
    expect(running.worldInteraction).toBe(false);

    const countdown = resolveInputPolicy(inputPolicy({
      diagnosticsArena: true,
      gameplayActive: false,
      countdownActive: true,
    }));
    expect(countdown.worldInteraction).toBe(true);
    expect(countdown.aim).toBe(false);
  });
});

describe('Policies – in der Scene verdrahtet', () => {
  it('leitet die Eingabe der Scene aus der Policy ab statt aus einer Bedingungskette', () => {
    const scene = readFileSync(resolve(process.cwd(), 'src/scenes/ArenaScene.ts'), 'utf8');
    expect(scene).toContain('const inputPolicy = resolveInputPolicy({');
    expect(scene).toContain('this.ctx.inputSystem.setAimEnabled(inputPolicy.aim);');
    expect(scene).toContain('this.ctx.inputSystem.setInputEnabled(inputPolicy.movement, inputPolicy.worldInteraction);');

    // Die frueher dreifach wiederholte Kombination steht nicht mehr in der Scene.
    expect(
      scene.includes('!optionsOpen && !spectator && !weaponBalanceLabArena'),
      'scene still recombines the input state by hand',
    ).toBe(false);
  });
});
