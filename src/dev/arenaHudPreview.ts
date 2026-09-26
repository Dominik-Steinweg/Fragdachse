/**
 * Arena-HUD-Vorschau für die Menüwerkstatt (`ui-preview.html`, nur Entwicklung).
 *
 * Spielt eine feste Zeitleiste mit den echten HUD-Klassen ab: Hauptziel- und Wellen-
 * ankündigung samt Übergabeflug, Nebenziel, Statusleiste mit Timer und Zug, untere
 * Ressourcenzeile und eine Kurzmeldung. Alle Daten sind lokale Fixtures.
 */
import type * as Phaser from 'phaser';
import { CenterHUD } from '../ui/CenterHUD';
import type { ArenaHUDData } from '../ui/ArenaHUD';
import { CoopDefenseObjectiveAnnouncement } from '../ui/CoopDefenseObjectiveAnnouncement';
import { CoopDefenseSecondaryObjectiveHud } from '../ui/CoopDefenseSecondaryObjectiveHud';
import { buildCoopDefenseLifeStatusViewModel } from '../ui/coopDefenseLifeStatusModel';
import type {
  CoopDefenseEncounterPresentationState,
  CoopDefenseSecondaryObjectivePresentationEntry,
} from '../types';

export interface ArenaHudPreviewHandle {
  build(): void;
  hide(): void;
  destroy(): void;
}

const LOOP_MS = 22_000;

function hudData(t: number): ArenaHUDData {
  const rage = Math.min(600, Math.max(0, (t - 8_000) * 0.2));
  return {
    hp: 100, maxHp: 100,
    armor: t > 9_000 ? 60 : 0, maxArmor: 100,
    adrenaline: 50, maxAdrenaline: 100,
    rage, maxRage: 600,
    isUltimateActive: false,
    ultimateRequiredRage: 600,
    ultimateThresholds: [],
    ultimateId: 'ARMAGEDDON',
    weapon1CooldownFrac: 0,
    weapon2CooldownFrac: 0,
    utilityCooldownFrac: t > 8_500 && t < 12_500 ? 1 - (t - 8_500) / 4_000 : 0,
    utilityId: 'HE_GRENADE',
    utilityChargeState: { availableCharges: t > 12_500 ? 2 : 1, maxCharges: 2 } as ArenaHUDData['utilityChargeState'],
    activePowerUps: t > 10_000 && t < 18_000
      ? [{ defId: 'DOUBLE_DAMAGE', remainingFrac: 1 - (t - 10_000) / 8_000 }]
      : [],
    constructionCapacityUsed: t > 11_000 ? 3 : 0,
    constructionCapacityMax: t > 11_000 ? 8 : 0,
  };
}

function encounterState(t: number): CoopDefenseEncounterPresentationState | null {
  if (t < 4_000) return null;
  const base = {
    encounterId: 'preview-wave-2', sequenceIndex: 2, sequenceCount: 4,
    encounterFronts: ['west', 'north'], fronts: ['west'],
  } as const;
  if (t < 9_000) return { ...base, phase: 'incoming', phaseStartedAtMs: 4_000, phaseEndsAtMs: 9_000 };
  if (t < 17_000) {
    return { ...base, phase: 'active', phaseStartedAtMs: 9_000, phaseEndsAtMs: null,
      enemiesTotal: 12, enemiesDefeated: Math.min(12, Math.floor((t - 9_000) / 650)) };
  }
  return { ...base, phase: 'cleared', phaseStartedAtMs: 17_000, phaseEndsAtMs: 21_000 };
}

function secondaryState(t: number): CoopDefenseSecondaryObjectivePresentationEntry[] {
  if (t < 7_500) return [];
  const progress = Math.min(5, Math.floor((t - 7_500) / 1_600));
  const done = progress >= 5;
  return [
    { objectiveId: 'preview-destroy', type: 'destroy', state: done ? 'completed' : 'active', focused: !done,
      progressCurrent: progress, progressTotal: 5, stateChangedAtMs: done ? 7_500 + 5 * 1_600 : 7_500 },
    { objectiveId: 'preview-hold', type: 'hold', state: 'active', focused: false,
      progressCurrent: 0, progressTotal: 1, stateChangedAtMs: 7_500 },
  ];
}

export function openArenaHudPreview(scene: Phaser.Scene, status: (message: string) => void): ArenaHudPreviewHandle {
  const announcements = new CoopDefenseObjectiveAnnouncement(scene);
  announcements.build();
  const centerHUD = new CenterHUD(scene);
  centerHUD.setObjectiveAnnouncements(announcements);
  centerHUD.build();
  const secondary = new CoopDefenseSecondaryObjectiveHud(scene, announcements);
  secondary.build();
  centerHUD.transitionToGame();

  let t = 0;
  let speed = 1;
  let toastShown = false;
  let trainGone = false;
  // Anhalten, Zeitraffer der Fixture-Zeitleiste und Neustart für die Sichtprüfung einzelner
  // Animationsphasen (Browser-Konsole). Tweens laufen in Echtzeit; angehalten werden sie über
  // pauseAll, nicht über eine veränderte Zeitskalierung.
  const control = {
    restart: (): void => { t = LOOP_MS + 1; },
    /** Vergrößert um einen Bildpunkt (Ursprung 0..1), der dabei an seiner Stelle bleibt. */
    zoom: (originX: number, originY: number, zoom: number): void => {
      for (const camera of scene.cameras.cameras) camera.setOrigin(originX, originY).setZoom(zoom);
    },
    setSpeed: (next: number): void => {
      speed = next;
      if (next === 0) scene.tweens.pauseAll();
      else scene.tweens.resumeAll();
    },
  };
  (window as unknown as { __arenaHudPreview?: typeof control }).__arenaHudPreview = control;
  const update = (_time: number, delta: number): void => {
    t += delta * speed;
    if (t > LOOP_MS) {
      t = 0;
      toastShown = false;
      trainGone = false;
      centerHUD.resetCoopMissionPresentation();
      secondary.reset();
    }
    centerHUD.updateTimer(Math.max(0, 180 - Math.floor(t / 1000)));
    centerHUD.updateLifeStatus(buildCoopDefenseLifeStatusViewModel({
      budget: { remainingRespawns: t > 15_000 ? 2 : 3, alive: true, eliminated: false },
      missionRespawnActive: false,
    }));
    if (t < 12_000) centerHUD.setTrainArrival((12_000 - t) / 1000);
    else if (t < 19_000) centerHUD.updateTrainHP(1 - (t - 12_000) / 9_000, 1);
    else if (!trainGone) { trainGone = true; centerHUD.showTrainDestroyed(); }
    if (t > 400) {
      centerHUD.updateMainObjectivePresentation({
        id: 'preview-main', title: 'Vorstoß', progressLabel: `${Math.min(6, Math.floor(t / 3_500))} / 6`,
        progress: Math.min(6, Math.floor(t / 3_500)) / 6,
      });
    }
    centerHUD.updateEncounterPresentation(encounterState(t), t);
    secondary.sync(secondaryState(t), [], t, true);
    centerHUD.updateBottomStatus(hudData(t), false);
    if (!toastShown && t > 14_000) {
      toastShown = true;
      centerHUD.showYouFragged('Walddachs 3', 0xffffff);
    }
    status(`Arena-HUD · ${(t / 1000).toFixed(1)} s / ${LOOP_MS / 1000} s`);
  };
  scene.events.on('update', update);

  return {
    build: () => undefined,
    hide: () => centerHUD.transitionToLobby(),
    destroy: () => {
      scene.events.off('update', update);
      control.setSpeed(1);
      control.zoom(0.5, 0.5, 1);
      delete (window as unknown as { __arenaHudPreview?: typeof control }).__arenaHudPreview;
      secondary.destroy();
      centerHUD.destroy();
      announcements.destroy();
    },
  };
}
