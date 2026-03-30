import { HP_MAX } from '../config';
import type { ArenaHUDData } from './ArenaHUD';

export interface LocalArenaHudData extends ArenaHUDData {
  weapon2AdrenalineCost: number;
}

interface BuildLocalArenaHudDataParams {
  hp: number;
  armor: number;
  adrenaline: number;
  rage: number;
  isUltimateActive: boolean;
  ultimateRequiredRage: number;
  ultimateThresholds: number[];
  weapon1CooldownFrac: number;
  weapon2CooldownFrac: number;
  utilityCooldownFrac: number;
  utilityDisplayName?: string;
  adrenalineSyringeActive?: boolean;
  isUtilityOverridden?: boolean;
  activePowerUps?: ArenaHUDData['activePowerUps'];
  shieldBuff?: ArenaHUDData['shieldBuff'];
  weapon2AdrenalineCost?: number;
}

interface BuildInitialLocalArenaHudDataParams {
  ultimateRequiredRage: number;
  ultimateThresholds: number[];
  utilityDisplayName?: string;
  weapon2AdrenalineCost?: number;
}

export function buildLocalArenaHudData(params: BuildLocalArenaHudDataParams): LocalArenaHudData {
  return {
    hp: params.hp,
    armor: params.armor,
    adrenaline: params.adrenaline,
    rage: params.rage,
    isUltimateActive: params.isUltimateActive,
    ultimateRequiredRage: params.ultimateRequiredRage,
    ultimateThresholds: params.ultimateThresholds,
    weapon1CooldownFrac: params.weapon1CooldownFrac,
    weapon2CooldownFrac: params.weapon2CooldownFrac,
    utilityCooldownFrac: params.utilityCooldownFrac,
    utilityDisplayName: params.utilityDisplayName,
    adrenalineSyringeActive: params.adrenalineSyringeActive ?? false,
    isUtilityOverridden: params.isUtilityOverridden ?? false,
    activePowerUps: params.activePowerUps ?? [],
    shieldBuff: params.shieldBuff,
    weapon2AdrenalineCost: params.weapon2AdrenalineCost ?? 0,
  };
}

export function buildInitialLocalArenaHudData(
  params: BuildInitialLocalArenaHudDataParams,
): LocalArenaHudData {
  return buildLocalArenaHudData({
    hp: HP_MAX,
    armor: 0,
    adrenaline: 0,
    rage: 0,
    isUltimateActive: false,
    ultimateRequiredRage: params.ultimateRequiredRage,
    ultimateThresholds: params.ultimateThresholds,
    weapon1CooldownFrac: 0,
    weapon2CooldownFrac: 0,
    utilityCooldownFrac: 0,
    utilityDisplayName: params.utilityDisplayName,
    adrenalineSyringeActive: false,
    isUtilityOverridden: false,
    activePowerUps: [],
    weapon2AdrenalineCost: params.weapon2AdrenalineCost ?? 0,
  });
}