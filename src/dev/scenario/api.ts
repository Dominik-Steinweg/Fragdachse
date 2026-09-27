import type { DevScenarioController } from './controller';
import { parseScenario, type GridPoint } from './config';
import { COOP_DEFENSE_ENEMY_KINDS, type CoopDefenseEnemyKind } from '../../config/coopDefenseEnemies';
import { COOP_DEFENSE_CONSTRUCTION_IDS } from '../../config/coopDefenseConstructions';
import type { ConstructionId, WeaponSlot } from '../../types';

export type ScenarioResult = { ok: true; status: Record<string, unknown>; path?: string; url?: string }
  | { ok: false; error: string; status: Record<string, unknown> };
export interface DevScenarioApi {
  readonly version: 1;
  status(): Record<string, unknown>;
  run(command: unknown): ScenarioResult;
  whenReady(timeoutMs?: number): Promise<ScenarioResult>;
  capture(): Promise<ScenarioResult>;
}
declare global { interface Window { devScenario?: DevScenarioApi } }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Befehl muss ein Objekt sein.');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Zahl ${min}…${max} erwartet.`);
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Boolean erwartet.');
  return value;
}
function point(value: unknown): GridPoint {
  const raw = object(value);
  return { gridX: number(raw.gridX, 0, 10000), gridY: number(raw.gridY, 0, 10000) };
}
function slot(value: unknown): WeaponSlot {
  if (value !== 'weapon1' && value !== 'weapon2') throw new Error('slot: weapon1 oder weapon2 erwartet.');
  return value;
}

/** The panel and script API share commands; arbitrary JavaScript is never evaluated. */
export function runScenarioCommand(controller: DevScenarioController, value: unknown): void {
  const c = object(value);
  switch (c.action) {
    case 'status': return;
    case 'start': controller.start(c.scenario); break;
    case 'target': controller.aim = point(c); break;
    case 'findFree': controller.findFree(); break;
    case 'teleport': controller.teleport(c.gridX === undefined && c.gridY === undefined ? undefined : point(c)); break;
    case 'move': controller.move(number(c.dx, -1, 1), number(c.dy, -1, 1), number(c.durationMs, 0, 10000)); break;
    case 'holdWeapon': controller.fire(slot(c.slot), true); break;
    case 'fire': controller.fire(slot(c.slot), false); break;
    case 'utility': controller.utility(); break;
    case 'burrow': {
      if (c.phase !== 'enter' && c.phase !== 'exit') throw new Error('phase: enter oder exit erwartet.');
      controller.burrow(c.phase === 'enter'); break;
    }
    case 'ultimate': {
      if (c.phase !== undefined && c.phase !== 'press' && c.phase !== 'release') throw new Error('phase: press oder release erwartet.');
      controller.ultimate(c.phase as 'press' | 'release' | undefined); break;
    }
    case 'stop': controller.stop(); break;
    case 'spawn': {
      if (!COOP_DEFENSE_ENEMY_KINDS.includes(c.kind as CoopDefenseEnemyKind)) throw new Error('Unbekannte Gegnerart.');
      controller.spawn(c.kind as CoopDefenseEnemyKind, c.pinned === undefined ? false : boolean(c.pinned),
        c.hp == null ? null : number(c.hp, 1, 10000000), c.gridX === undefined && c.gridY === undefined ? undefined : point(c)); break;
    }
    case 'clearEnemies': controller.clearEnemies(); break;
    case 'build': {
      if (!COOP_DEFENSE_CONSTRUCTION_IDS.includes(c.id as ConstructionId)) throw new Error('Unbekanntes Bauwerk.');
      controller.build(c.id as ConstructionId, c.gridX === undefined && c.gridY === undefined ? undefined : point(c)); break;
    }
    case 'pause': controller.pause(); break;
    case 'resume': controller.resume(); break;
    case 'step': {
      const frames = c.frames === undefined ? 1 : number(c.frames, 1, 600);
      if (!Number.isInteger(frames)) throw new Error('frames muss ganzzahlig sein.');
      controller.step(frames); break;
    }
    case 'options': {
      const options = object(c.values);
      for (const key of Object.keys(options)) if (!['timeOfDay', 'freezeMission', 'hideTutorial', 'suppressWaves', 'refillHp', 'refillAdrenaline'].includes(key)) throw new Error(`Keine Live-Option: ${key}`);
      controller.config = parseScenario({ ...controller.config, ...options }); controller.saveLink(); break;
    }
    case 'camera': {
      const zoom = c.zoom === undefined ? controller.zoom : number(c.zoom, 0.25, 8);
      const focus = c.focusTarget === undefined ? controller.cameraAtTarget : boolean(c.focusTarget);
      controller.zoom = zoom; controller.cameraAtTarget = focus; break;
    }
    case 'speed': controller.clock.speed = number(c.value, 0.1, 2); break;
    case 'panel': controller.setPanelCollapsed(boolean(c.collapsed)); break;
    default: throw new Error(`Unbekannte Aktion: ${String(c.action)}`);
  }
  controller.syncPanel();
}

export function installScenarioApi(controller: DevScenarioController) {
  let active = true;
  const waiters = new Set<() => void>();
  const status = () => structuredClone(controller.snapshot());
  const failure = (error: unknown): ScenarioResult => ({ ok: false, error: error instanceof Error ? error.message : String(error), status: status() });
  const api: DevScenarioApi = {
    version: 1, status,
    run(command) {
      try {
        if (!active) throw new Error('Dev-Szenario wurde beendet.');
        runScenarioCommand(controller, command); return { ok: true, status: status() };
      } catch (error) { controller.fail(error); return failure(error); }
    },
    whenReady(timeoutMs = 180000) {
      try { number(timeoutMs, 1, 180000); } catch (error) { return Promise.resolve(failure(error)); }
      return new Promise(resolve => {
        const started = performance.now();
        const check = () => {
          const current = status();
          if (!active || current.state === 'error' || performance.now() - started >= timeoutMs || current.ready === true) {
            clearInterval(timer); waiters.delete(check);
            resolve(active && current.ready === true ? { ok: true, status: current }
              : failure(!active ? 'Dev-Szenario wurde beendet.' : current.state === 'error' ? current.message : 'Szenario nicht rechtzeitig bereit.'));
          }
        };
        const timer = setInterval(check, 100); waiters.add(check); check();
      });
    },
    async capture() {
      try {
        if (!active) throw new Error('Dev-Szenario wurde beendet.');
        const result = await controller.captureToWorkspace();
        return { ok: true, ...result };
      } catch (error) { controller.fail(error); return failure(error); }
    },
  };
  window.devScenario = api;
  return { destroy() {
    active = false;
    for (const check of waiters) check();
    if (window.devScenario === api) delete window.devScenario;
  } };
}
