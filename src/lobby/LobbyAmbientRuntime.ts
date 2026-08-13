import type * as Phaser from 'phaser';
import {
  LOBBY_ROCK_ROLES,
  MENU_ARENA_PREVIEW_CONFIG,
} from '../arena/MenuArenaPreviewConfig';
import type { MenuArenaPreviewRenderer } from '../arena/MenuArenaPreviewRenderer';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { EffectSystem } from '../effects/EffectSystem';
import type { RendererBundle } from '../scenes/arena/RendererBundle';
import { AmbientActorRegistry } from './AmbientActorRegistry';
import { AmbientCombatWorld } from './AmbientCombatWorld';
import { LobbyAmbientDirector } from './LobbyAmbientDirector';
import { LobbyInspector } from './LobbyInspector';
import { LobbyNavigation } from './LobbyNavigation';
import { LobbyObstacleWorld } from './LobbyObstacleWorld';
import { LobbyRockBodyPool } from './LobbyRockBodyPool';

export interface LobbyAmbientRuntimeDeps {
  readonly scene: Phaser.Scene;
  readonly preview: MenuArenaPreviewRenderer;
  readonly renderers: RendererBundle;
  readonly effects: EffectSystem;
  readonly audio: GameAudioSystem;
  /** Aktuell gewählte weapon1/weapon2 des lokalen Spielers. */
  readonly getSelectedWeaponIds: () => readonly (string | null | undefined)[];
}

/**
 * Zusammenbau und Lebenszyklus der Lobby-Inszenierung.
 *
 * Ein einziger Anlaufpunkt für die Scene: {@link setActive} schaltet sie ein und – synchron
 * und vollständig – wieder aus. Nach dem Ausschalten existiert garantiert kein Ambient-Actor,
 * kein Ambient-Projektil, keine offene Detonation, kein Kollisionskörper und keine laufende
 * Sequenz mehr; die kanonische Felslandschaft steht wieder.
 *
 * Ein Fehler in der Inszenierung darf den Matchstart nie verhindern: Er schaltet sie ab und
 * lässt die Lobby im Übrigen unberührt.
 */
export class LobbyAmbientRuntime {
  private readonly world: LobbyObstacleWorld;
  private readonly navigation: LobbyNavigation;
  private readonly actors = new AmbientActorRegistry();
  private readonly bodyPool: LobbyRockBodyPool;
  private readonly combat: AmbientCombatWorld;
  private readonly inspector: LobbyInspector;
  private readonly director: LobbyAmbientDirector;

  private active = false;
  private failed = false;

  constructor(private readonly deps: LobbyAmbientRuntimeDeps) {
    const layout = MENU_ARENA_PREVIEW_CONFIG.layout;
    const { bounds } = MENU_ARENA_PREVIEW_CONFIG.view;

    this.world = new LobbyObstacleWorld(layout, {
      offsetX: bounds.offsetX,
      offsetY: bounds.offsetY,
      width: bounds.width,
      height: bounds.height,
    });
    this.navigation = new LobbyNavigation(this.world);
    this.bodyPool = new LobbyRockBodyPool(deps.scene, layout, this.world);

    this.combat = new AmbientCombatWorld({
      scene: deps.scene,
      layout,
      world: this.world,
      actors: this.actors,
      bodyPool: this.bodyPool,
      renderers: deps.renderers,
      effects: deps.effects,
      audio: deps.audio,
      rockRole: (rockId) => LOBBY_ROCK_ROLES[rockId] ?? 'ambient',
      onRockAliveChanged: (rockId, alive) => deps.preview.setRockAlive(rockId, alive),
    });

    this.inspector = new LobbyInspector(
      deps.scene, this.world, this.navigation, this.actors, this.combat,
      deps.effects, deps.audio, deps.renderers.lighting, Math.random,
    );

    this.director = new LobbyAmbientDirector({
      scene: deps.scene,
      world: this.world,
      navigation: this.navigation,
      actors: this.actors,
      combat: this.combat,
      inspector: this.inspector,
      lighting: deps.renderers.lighting,
      getSelectedWeaponIds: deps.getSelectedWeaponIds,
      rng: Math.random,
    });
  }

  isActive(): boolean {
    return this.active;
  }

  /** Schaltet die Inszenierung an oder – synchron und vollständig – ab. */
  setActive(active: boolean): void {
    if (this.failed || active === this.active) return;
    this.active = active;
    if (!active) {
      // Der Abbau läuft im Übergang in die Arena. Ein Fehler darf den Matchstart nicht
      // verhindern – er schaltet die Inszenierung ab und lässt alles andere unberührt.
      try {
        this.teardown();
      } catch (error) {
        console.error('[LobbyAmbientRuntime] Abbau fehlgeschlagen; Ambient deaktiviert', error);
        this.failed = true;
      }
    }
  }

  update(deltaMs: number): void {
    if (!this.active || this.failed) return;
    try {
      this.director.update(deltaMs);
    } catch (error) {
      console.error('[LobbyAmbientRuntime] Ambient deaktiviert nach Fehler', error);
      this.failSafe();
    }
  }

  /** Vollständiger Abbau. Danach greifen die Teardown-Invarianten. */
  destroy(): void {
    this.active = false;
    this.teardown();
  }

  // ── Invarianten ────────────────────────────────────────────────────────────

  /**
   * Zustandszählung für den Teardown-Test. Alle Werte müssen nach dem Verlassen der Lobby
   * null sein.
   */
  countResidualState(): {
    actors: number;
    projectiles: number;
    pendingDetonations: number;
    collisionBodies: number;
    missingCanonicalRocks: number;
    runningSequence: number;
  } {
    const layout = MENU_ARENA_PREVIEW_CONFIG.layout;
    let missing = 0;
    for (let id = 0; id < layout.rocks.length; id += 1) {
      if (!this.world.isRockAlive(id)) missing += 1;
    }
    return {
      actors: this.actors.size,
      projectiles: this.combat.projectiles.getActiveProjectiles().size,
      pendingDetonations: this.combat.detonations.flushDetonations().length,
      collisionBodies: this.bodyPool.activeBodyCount,
      missingCanonicalRocks: missing,
      runningSequence: this.director.isBusy() ? 1 : 0,
    };
  }

  // ── Intern ─────────────────────────────────────────────────────────────────

  private teardown(): void {
    this.director.stop();
    this.inspector.abort();
    this.actors.clear();
    this.combat.destroy();
    this.bodyPool.release();
    this.restoreCanonicalRocks();
    // Der gebündelte Neubau der Fels-Bänder liefe sonst erst im nächsten Frame – dann steht
    // die Arena schon.
    this.deps.preview.flushRockBands();
  }

  /** Stellt jeden zerstörten Fels wieder her, auch mitten in einer Reparaturphase. */
  private restoreCanonicalRocks(): void {
    const layout = MENU_ARENA_PREVIEW_CONFIG.layout;
    for (let id = 0; id < layout.rocks.length; id += 1) {
      if (this.world.isRockAlive(id)) continue;
      this.world.setRockAlive(id, true);
      this.combat.rockHp.register(id, this.combat.rockHp.getMaxHP(id));
      this.deps.preview.setRockAlive(id, true);
    }
  }

  private failSafe(): void {
    this.failed = true;
    this.active = false;
    this.director.disable();
    this.teardown();
  }
}
