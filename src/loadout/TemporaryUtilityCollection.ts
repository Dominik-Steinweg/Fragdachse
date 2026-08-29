import type { TemporaryUtilityInstanceDescriptor } from '../types';
import { GenericUtility } from './GenericUtility';
import type { UtilityConfig } from './LoadoutConfig';

export type TemporaryUtilitySource =
  | { readonly kind: 'utility' }
  | {
    readonly kind: 'objective-placement';
    readonly objectiveId: string;
    readonly powerUpDefId: string;
  };

export interface TemporaryUtilityRuntimeInstance {
  readonly instanceId: string;
  readonly utility: GenericUtility;
  readonly source: TemporaryUtilitySource;
  readonly acquisitionOrder: number;
  charges: number;
  cooldownUntil: number;
}

/**
 * Host-owned collection for independent temporary utility instances. It owns identity, pickup
 * order, charges and cooldown state; networking and presentation only consume descriptors.
 */
export class TemporaryUtilityCollection {
  private readonly byPlayer = new Map<string, TemporaryUtilityRuntimeInstance[]>();
  private readonly nextAcquisitionOrder = new Map<string, number>();
  private nextInstanceSequence = 1;

  add(
    playerId: string,
    config: UtilityConfig,
    charges: number,
    source: TemporaryUtilitySource,
  ): TemporaryUtilityRuntimeInstance | null {
    if (!Number.isSafeInteger(charges) || charges <= 0) return null;
    const acquisitionOrder = this.nextAcquisitionOrder.get(playerId) ?? 0;
    this.nextAcquisitionOrder.set(playerId, acquisitionOrder + 1);
    const instance: TemporaryUtilityRuntimeInstance = {
      instanceId: `temporary-utility-${this.nextInstanceSequence++}`,
      utility: new GenericUtility(config),
      source,
      acquisitionOrder,
      charges,
      cooldownUntil: 0,
    };
    const instances = this.byPlayer.get(playerId) ?? [];
    instances.push(instance);
    this.byPlayer.set(playerId, instances);
    return instance;
  }

  get(playerId: string, instanceId: string): TemporaryUtilityRuntimeInstance | null {
    return this.byPlayer.get(playerId)?.find((instance) => instance.instanceId === instanceId) ?? null;
  }

  getDescriptors(playerId: string): TemporaryUtilityInstanceDescriptor[] {
    return (this.byPlayer.get(playerId) ?? [])
      .map((instance) => this.toDescriptor(instance))
      .sort((left, right) => left.acquisitionOrder - right.acquisitionOrder);
  }

  recordSuccessfulUse(playerId: string, instanceId: string, now: number): boolean {
    const instances = this.byPlayer.get(playerId);
    const index = instances?.findIndex((instance) => instance.instanceId === instanceId) ?? -1;
    if (!instances || index < 0) return false;
    const instance = instances[index];
    instance.utility.recordUse(now);
    instance.cooldownUntil = now + Math.max(0, instance.utility.config.cooldown);
    instance.charges -= 1;
    if (instance.charges <= 0) instances.splice(index, 1);
    if (instances.length === 0) this.byPlayer.delete(playerId);
    return true;
  }

  removeForObjective(playerId: string, objectiveId: string): boolean {
    const instances = this.byPlayer.get(playerId);
    if (!instances) return false;
    const index = instances.findIndex((instance) => (
      instance.source.kind === 'objective-placement' && instance.source.objectiveId === objectiveId
    ));
    if (index < 0) return false;
    instances.splice(index, 1);
    if (instances.length === 0) this.byPlayer.delete(playerId);
    return true;
  }

  clearPlayer(playerId: string): void {
    this.byPlayer.delete(playerId);
    this.nextAcquisitionOrder.delete(playerId);
  }

  private toDescriptor(instance: TemporaryUtilityRuntimeInstance): TemporaryUtilityInstanceDescriptor {
    const common = {
      instanceId: instance.instanceId,
      utilityId: instance.utility.config.id,
      charges: instance.charges,
      cooldownUntil: instance.cooldownUntil,
      cooldownDurationMs: Math.max(0, instance.utility.config.cooldown),
      acquisitionOrder: instance.acquisitionOrder,
    };
    return instance.source.kind === 'objective-placement'
      ? { ...common, ...instance.source }
      : { ...common, kind: 'utility' };
  }
}
