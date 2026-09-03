import {
  COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
  getCoopDefenseConstructionDefinition,
} from '../config/coopDefenseConstructions';
import type { ConstructionId } from '../types';

export type ConstructionManagementAction = 'reposition' | 'dismantle';

/**
 * Die Readiness-Sicht, die World-Construction-Consumer benoetigen.
 *
 * Der Port traegt nur Construction-/Management-Bereitschaft. Ausstattung, Ressourcen und
 * persistente Basisdaten bleiben bei ihren jeweiligen Ownern.
 */
export interface ConstructionReadinessPort {
  isConstructionOnCooldown(playerId: string, constructionId: ConstructionId, nowMs: number): boolean;
  markConstructionUsed(playerId: string, constructionId: ConstructionId, nowMs: number): number;
  getManagementActionCooldownUntil(playerId: string, action: ConstructionManagementAction): number;
  isManagementActionOnCooldown(playerId: string, action: ConstructionManagementAction, nowMs: number): boolean;
  markManagementActionUsed(playerId: string, action: ConstructionManagementAction, nowMs: number): number;
}

/**
 * World-owned Readiness-State fuer Konstruktionen und die kurzen Management-Aktionen.
 *
 * Der State wird beim Player-in-World-Attach initialisiert, beim Leave entfernt und beim
 * World-Teardown vollstaendig geleert. Dadurch wird die bisherige Player-in-World-Lifetime
 * erhalten, ohne Readiness in den Loadout-Owner oder den raumlanglebigen Persistent-Base-Owner
 * zu legen.
 */
export class ConstructionReadinessRuntime implements ConstructionReadinessPort {
  private readonly constructionCooldowns = new Map<string, Map<ConstructionId, number>>();
  private readonly managementActionCooldowns = new Map<string, Map<ConstructionManagementAction, number>>();

  attachPlayer(playerId: string): void {
    this.resetPlayer(playerId);
  }

  detachPlayer(playerId: string): void {
    this.constructionCooldowns.delete(playerId);
    this.managementActionCooldowns.delete(playerId);
  }

  resetPlayer(playerId: string): void {
    this.constructionCooldowns.set(playerId, new Map());
    this.managementActionCooldowns.set(playerId, new Map());
  }

  isConstructionOnCooldown(playerId: string, constructionId: ConstructionId, nowMs: number): boolean {
    const readyAt = this.constructionCooldowns.get(playerId)?.get(constructionId) ?? 0;
    return nowMs < readyAt;
  }

  markConstructionUsed(playerId: string, constructionId: ConstructionId, nowMs: number): number {
    const perPlayer = this.constructionCooldowns.get(playerId) ?? new Map<ConstructionId, number>();
    this.constructionCooldowns.set(playerId, perPlayer);
    const readyAt = nowMs + getCoopDefenseConstructionDefinition(constructionId).buildCooldownMs;
    perPlayer.set(constructionId, readyAt);
    return readyAt;
  }

  getManagementActionCooldownUntil(playerId: string, action: ConstructionManagementAction): number {
    return this.managementActionCooldowns.get(playerId)?.get(action) ?? 0;
  }

  isManagementActionOnCooldown(
    playerId: string,
    action: ConstructionManagementAction,
    nowMs: number,
  ): boolean {
    return nowMs < this.getManagementActionCooldownUntil(playerId, action);
  }

  markManagementActionUsed(
    playerId: string,
    action: ConstructionManagementAction,
    nowMs: number,
  ): number {
    const perPlayer = this.managementActionCooldowns.get(playerId)
      ?? new Map<ConstructionManagementAction, number>();
    this.managementActionCooldowns.set(playerId, perPlayer);
    const readyAt = nowMs + COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS;
    perPlayer.set(action, readyAt);
    return readyAt;
  }

  destroy(): void {
    this.constructionCooldowns.clear();
    this.managementActionCooldowns.clear();
  }
}
