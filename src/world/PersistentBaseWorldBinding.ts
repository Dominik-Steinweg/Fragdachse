import type {
  PersistentBaseBuildArea,
} from '../persistentBase/PersistentBaseCore';
import { PersistentBaseRuntimeBindings } from '../persistentBase/PersistentBaseRuntimeBindings';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';

/**
 * Die world-lokale Materialisierung der persistenten Basis.
 *
 * Sie traegt ausschliesslich, was mit **dieser** World-Instanz entsteht und vergeht: die
 * aufgeloeste Stelle, die bebaubare Flaeche, die Runtime-Objekte der materialisierten Beitraege
 * und Belohnungen und die Signaturen, aus denen der Composite gebaut wurde.
 *
 * Ausdruecklich **nicht** hier: der raumlanglebige Session-State der persistenten Basis und der
 * Arbeitsstand einer laufenden Mission. Beide ueberleben einen World-Wechsel und bekommen ihre
 * eigenen Owner.
 *
 * Ihr Abbau ist der Moment, in dem der Bestand abgeschlossen wird: Nur solange die Bau-Runtime
 * steht, ist "hat dieses Objekt die Runde ueberlebt?" ueberhaupt beantwortbar. Danach waere jede
 * Antwort "zerstoert" und der Arbeitsstand leer.
 */

/** Runtime-Bindung genau einer materialisierten Belohnung dieser World. */
export interface PersistentBaseRewardRuntimeBinding {
  readonly runtimeId: number;
  readonly gridX: number;
  readonly gridY: number;
}

export interface PersistentBaseWorldBindingSink {
  /**
   * Schliesst den Bestand ab: Was als Runtime-Objekt noch steht, bleibt im Arbeitsstand, alles
   * andere faellt heraus. Laeuft genau einmal und mit noch lebender Bau-Runtime.
   */
  readonly finalizeRuntimeObjects: () => void;
  /** Loest die Runtime-Bindung genau einer Belohnung wieder auf. */
  readonly releaseRewardRuntime: (rewardId: PersistentBaseRewardId) => void;
}

export class PersistentBaseWorldBinding {
  /** Runtime-IDs der in dieser World materialisierten Belohnungen. */
  private readonly rewardRuntimeBindings = new Map<PersistentBaseRewardId, PersistentBaseRewardRuntimeBinding>();
  /** Runtime-Objekte der in dieser World materialisierten persoenlichen Beitraege. */
  private readonly constructionRuntimeBindings = new PersistentBaseRuntimeBindings();
  /** Bausignaturen, aus denen der aktuelle Composite dieser World entstanden ist. */
  private readonly compositeBuildSignatures = new Map<string, string>();
  private anchorValue: PersistentBaseAnchor | null = null;
  private buildAreaValue: PersistentBaseBuildArea | null = null;
  private destroyed = false;

  constructor(private readonly sink: PersistentBaseWorldBindingSink) {}

  /** Anker der persistenten Basis dieser World; `null`, wenn sie keine fuehrt. */
  get anchor(): PersistentBaseAnchor | null {
    return this.anchorValue;
  }

  /** Bebaubare Flaeche dieser Instanz; `null`, wenn sie keine persistente Basis fuehrt. */
  get buildArea(): PersistentBaseBuildArea | null {
    return this.buildAreaValue;
  }

  get rewardRuntimes(): Map<PersistentBaseRewardId, PersistentBaseRewardRuntimeBinding> {
    return this.rewardRuntimeBindings;
  }

  /**
   * Die Runtime-Objekte der persoenlichen Beitraege dieser World.
   *
   * Der raumlanglebige Beitragsspeicher liest sie, besitzt sie aber nicht: Ein Blueprint ueberlebt
   * seine World, sein Objekt nicht.
   */
  get constructionRuntimes(): PersistentBaseRuntimeBindings {
    return this.constructionRuntimeBindings;
  }

  get compositeSignatures(): Map<string, string> {
    return this.compositeBuildSignatures;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Bindet die aufgeloeste Stelle dieser World-Instanz; `null` fuer eine World ohne Basiskern. */
  setSite(anchor: PersistentBaseAnchor | null, buildArea: PersistentBaseBuildArea | null): void {
    if (this.destroyed) {
      throw new Error('[PersistentBaseWorldBinding] Cannot bind a site on a destroyed binding');
    }
    this.anchorValue = anchor;
    this.buildAreaValue = buildArea;
  }

  bindRewardRuntime(rewardId: PersistentBaseRewardId, binding: PersistentBaseRewardRuntimeBinding): void {
    if (this.destroyed) {
      throw new Error('[PersistentBaseWorldBinding] Cannot bind a reward runtime on a destroyed binding');
    }
    this.rewardRuntimeBindings.set(rewardId, binding);
  }

  getRewardRuntime(rewardId: PersistentBaseRewardId): PersistentBaseRewardRuntimeBinding | undefined {
    return this.rewardRuntimeBindings.get(rewardId);
  }

  unbindRewardRuntime(rewardId: PersistentBaseRewardId): void {
    this.rewardRuntimeBindings.delete(rewardId);
  }

  /**
   * Schliesst den Bestand ab und loest jede materialisierte Belohnung. Idempotent.
   *
   * Wird vor dem Abbau der Bau-Runtime gerufen und nachdem die Darstellung diese World bereits
   * verlassen hat: Der Abschluss veraendert damit keine Darstellung, die ein Uebergang
   * weiterzeigt oder weiterverwendet.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sink.finalizeRuntimeObjects();
    for (const rewardId of [...this.rewardRuntimeBindings.keys()]) {
      this.sink.releaseRewardRuntime(rewardId);
    }
    this.rewardRuntimeBindings.clear();
    this.constructionRuntimeBindings.clear();
    this.compositeBuildSignatures.clear();
    this.anchorValue = null;
    this.buildAreaValue = null;
  }
}
