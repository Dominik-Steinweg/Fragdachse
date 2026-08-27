import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Zone {
    x = 0;
    y = 0;
    rotation = 0;
    active = true;
    body: unknown = null;
    constructor(public scene: unknown, x: number, y: number, public width: number, public height: number) {
      this.x = x;
      this.y = y;
    }
    setOrigin(): this { return this; }
    setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { x: this.x - this.width / 2, y: this.y - this.height / 2, width: this.width, height: this.height };
    }
    destroy(): void { this.active = false; }
  }
  return { GameObjects: { Zone } };
});

import { PlayerBody } from '../src/entities/PlayerBody';
import { PLAYER_SIZE } from '../src/config';

/**
 * Runtime und Presentation von Figuren und Baeumen sind getrennt.
 *
 * Kanonisch ist die Runtime: Position, Ausrichtung, Aktivitaet, Bounds und Physik. Das sichtbare
 * Sprite - beim Baum Stamm, Krone und Schatten - ist ein optionaler Verbraucher, der ihr folgt.
 */

interface FakeBody {
  reset: ReturnType<typeof vi.fn>;
  setCircle: ReturnType<typeof vi.fn>;
  setCollideWorldBounds: ReturnType<typeof vi.fn>;
}

function makeScene(): { scene: unknown; bodies: FakeBody[] } {
  const bodies: FakeBody[] = [];
  const scene = {
    add: {
      zone: (x: number, y: number, w: number, h: number) => makeZone(x, y, w, h),
    },
    physics: {
      add: {
        existing: (obj: { body: unknown }) => {
          const body: FakeBody = {
            reset: vi.fn(),
            setCircle: vi.fn(),
            setCollideWorldBounds: vi.fn(),
          };
          bodies.push(body);
          obj.body = body;
          return obj;
        },
      },
    },
  };
  return { scene, bodies };
}

function makeZone(x: number, y: number, width: number, height: number): Record<string, unknown> {
  const zone: Record<string, unknown> = {
    x, y, width, height, rotation: 0, active: true, body: null,
    setOrigin: () => zone,
    setPosition: (nx: number, ny: number) => { zone.x = nx; zone.y = ny; return zone; },
    getBounds: () => ({
      x: (zone.x as number) - width / 2,
      y: (zone.y as number) - height / 2,
      width,
      height,
    }),
    destroy: () => { zone.active = false; },
  };
  return zone;
}

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('PlayerBody – kanonische Runtime der Figur', () => {
  it('traegt Position, Ausrichtung, Aktivitaet und Bounds', () => {
    const { scene } = makeScene();
    const body = new PlayerBody(scene as never, 100, 200, true);

    expect(body.x).toBe(100);
    expect(body.y).toBe(200);
    expect(body.active).toBe(true);

    body.rotation = 1.5;
    expect(body.rotation).toBe(1.5);

    const bounds = body.getBounds();
    expect(bounds.width).toBe(PLAYER_SIZE);
    expect(bounds.x).toBe(100 - PLAYER_SIZE / 2);
  });

  it('unterscheidet harten Spawn von weicher Interpolation', () => {
    const { scene, bodies } = makeScene();
    const body = new PlayerBody(scene as never, 0, 0, true);

    // Spawn/Respawn setzt den Koerper zurueck.
    body.setPosition(50, 60);
    expect(body.x).toBe(50);
    expect(bodies[0].reset).toHaveBeenCalledWith(50, 60);

    // Client-Interpolation bewegt nur die Position weiter.
    bodies[0].reset.mockClear();
    body.moveTo(51, 61);
    expect(body.x).toBe(51);
    expect(bodies[0].reset).not.toHaveBeenCalled();
  });

  it('fuehrt den Kollisionsradius in Weltpixeln ohne Anzeigemass', () => {
    const { scene, bodies } = makeScene();
    const body = new PlayerBody(scene as never, 0, 0, true);
    expect(body.getCollisionRadius()).toBe(PLAYER_SIZE / 2);

    body.setCollisionRadius(PLAYER_SIZE * 0.25);
    expect(body.getCollisionRadius()).toBe(PLAYER_SIZE * 0.25);
    // Der gesetzte Wert ist zugleich der wirksame - keine Umrechnung ueber eine Sprite-Skalierung.
    expect(bodies[0].setCircle).toHaveBeenLastCalledWith(
      PLAYER_SIZE * 0.25,
      PLAYER_SIZE / 2 - PLAYER_SIZE * 0.25,
      PLAYER_SIZE / 2 - PLAYER_SIZE * 0.25,
    );

    // Ein unsinniger Radius wird verworfen statt den Koerper zu loeschen.
    body.setCollisionRadius(0);
    expect(body.getCollisionRadius()).toBe(PLAYER_SIZE * 0.25);
  });
});

describe('PlayerEntity – das Sprite ist keine Runtime-API mehr', () => {
  const source = read('src/entities/PlayerEntity.ts');

  it('haelt das Sprite privat und antwortet selbst', () => {
    expect(source).toContain('private readonly sprite: Phaser.GameObjects.Sprite | null;');
    expect(source).toContain('private readonly runtime: PlayerBody;');

    // Position, Ausrichtung, Aktivitaet und Bounds kommen aus der Runtime.
    expect(source).toContain('get x(): number { return this.runtime.x; }');
    expect(source).toContain('get y(): number { return this.runtime.y; }');
    expect(source).toContain('get rotation(): number { return this.runtime.rotation; }');
    expect(source).toContain('get active(): boolean { return this.runtime.active; }');
    expect(source).toContain('return this.runtime.getBounds(output);');
    expect(source).toContain('return this.runtime.body;');
  });

  it('zieht die Darstellung jeden Frame an die Runtime nach', () => {
    // Genau der Fehler, der sonst entsteht: die Physik bewegt die Runtime, das Bild bleibt stehen.
    const start = source.indexOf('  syncBar(): void {');
    expect(start, 'the per-frame visual hook must exist').toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n  }', start));
    expect(body).toContain('this.syncVisualPosition();');

    const sync = source.slice(source.indexOf('  private syncVisualPosition(): void {'));
    expect(sync).toContain('this.sprite.setPosition(this.runtime.x, this.runtime.y);');
    expect(sync).toContain('this.sprite.rotation = this.runtime.rotation;');
  });

  it('laesst die Physik am Koerper angreifen, nicht am Bild', () => {
    const physics = read('src/systems/HostPhysicsSystem.ts');
    expect(physics).toContain('player.physicsProxy.body as Phaser.Physics.Arcade.Body | null');
    for (const group of ['rockGroup', 'trunkGroup', 'baseGroup']) {
      expect(physics).toContain(`this.scene.physics.add.collider(player.physicsProxy, this.${group})`);
    }
  });

  it('entscheidet Treffer nicht mehr ueber das Anzeigemass', () => {
    const combat = read('src/systems/CombatSystem.ts');
    expect(combat).toContain('interface HitscanTarget {');
    expect(combat).toContain('readonly hitRadius: number;');
    expect(combat).toContain('const baseRadius = target.hitRadius + traceThickness * 0.5;');
    expect(combat).toContain('hitRadius: player.getHitRadius()');
  });
});

describe('Simulation greift auf kein Figuren-Sprite mehr zu', () => {
  /** Module, die die autoritative Simulation tragen. */
  const SIMULATION_MODULES = [
    'src/systems/HostPhysicsSystem.ts',
    'src/systems/CombatSystem.ts',
    'src/systems/TranslocatorSystem.ts',
    'src/systems/TunnelSystem.ts',
    'src/systems/CoopDefenseCarrySystem.ts',
    'src/systems/CoopDefenseItemRuntimeSystem.ts',
    'src/entities/PlayerManager.ts',
  ] as const;

  it('nennt in keinem Simulationsmodul ein Spieler-Sprite', () => {
    for (const path of SIMULATION_MODULES) {
      const source = read(path);
      for (const forbidden of ['player.sprite', 'localPlayer.sprite', 'ally.sprite']) {
        expect(source.includes(forbidden), `${path} still reaches through the player sprite`).toBe(false);
      }
    }
  });

  it('haelt den Darstellungszugang benannt und getrennt', () => {
    const source = read('src/entities/PlayerEntity.ts');
    expect(source).toContain('get displayObject(): Phaser.GameObjects.Sprite | null {');
    // Der Todeseffekt ist Darstellung und wird von der Entity beantwortet, nicht abgegriffen.
    expect(source).toContain('getDeathVisual(): PlayerDeathVisual {');
    expect(read('src/systems/CombatSystem.ts')).toContain('player?.getDeathVisual()');
  });
});

describe('Baeume – Runtime und Darstellung getrennt', () => {
  it('traegt Kollision und Geometrie in einem nicht rendernden Koerper', () => {
    const proxy = read('src/arena/trees/TreePhysicsProxy.ts');
    expect(proxy).toContain('Phaser.GameObjects.Zone');
    // Der Radius macht den Koerper zugleich zum Kreis-Hindernis.
    expect(proxy).toContain('readonly radius: number;');
    expect(proxy).toContain('proxy.radius = TRUNK_RADIUS;');
  });

  it('trennt Koerper und sichtbare Staemme im Aufbau', () => {
    const builder = read('src/arena/ArenaBuilder.ts');
    expect(builder).toContain('trunkBodies: TreePhysicsProxy[];');
    expect(builder).toContain('trunkVisuals: Phaser.GameObjects.Arc[];');
    expect(builder).toContain('const trunk = createTreePhysicsProxy(this.scene, worldX, worldY);');
    // Stamm und Krone entstehen nur mit Darstellung.
    expect(builder).toContain('if (presentation) {');
    expect(builder).toContain('trunkVisuals.push(this.createTrunkVisual(worldX, worldY));');
    expect(builder).toContain('const presentation = options.presentation !== false;');
  });

  it('laesst Hindernis- und Lichtindex die Runtime lesen', () => {
    const coordinator = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(coordinator).toContain('this.ctx.arenaResult.trunkBodies');
    expect(coordinator).toContain('trunks: () => this.ctx.arenaResult?.trunkBodies ?? null');
    // Und beide Indices sprechen denselben Geometrie-Vertrag.
    expect(read('src/systems/CombatSystem.ts'))
      .toContain('private trunkObjects: readonly ObstacleCircleBody[] | null = null;');
    expect(read('src/effects/LightOccluderIndex.ts'))
      .toContain('readonly trunks: () => readonly ObstacleCircleBody[] | null;');
  });

  it('gattert die Baumdarstellung an der lokalen World-Presentation', () => {
    const coordinator = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(coordinator).toContain('presentation: this.getLocalWorldPresentation().required,');
  });
});
