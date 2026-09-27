/**
 * Utility-Rad-Vorschau für die Menüwerkstatt (`ui-preview.html`, nur Entwicklung).
 *
 * Öffnet den echten `RadialActionMenu` mit lokalen Fixtures, die durch denselben Resolver wie
 * im Spiel laufen. Das Rad folgt dem Zeiger wie bei gehaltenem R; ein Klick wählt wie das
 * Loslassen von R und öffnet das Rad kurz danach an der Klickposition erneut.
 *
 * Für die Sichtprüfung einzelner Zustände steht `window.__radialPreview` bereit: `zoom`
 * vergrößert um einen Bildpunkt, `aim(index)` zielt ohne Maus auf ein Segment (`-1` in die
 * Totzone, `null` gibt den Zeiger zurück), `reopen` öffnet das Rad in der Bildmitte neu.
 */
import type * as Phaser from 'phaser';
import { resolveRadialActions, type RadialActionRef, type RadialActionState } from '../systems/RadialActionModel';
import type { LoadoutToolRef } from '../types';
import { RadialActionMenu } from '../ui/RadialActionMenu';

export interface RadialMenuPreviewHandle {
  build(): void;
  hide(): void;
  destroy(): void;
}

const REOPEN_DELAY_MS = 450;

function fixtureEntries(variant: string, openedAt: number): RadialActionState[] {
  const compact = variant === 'solo';
  const locked = variant === 'locked';
  const tools: LoadoutToolRef[] = compact
    ? [
      { kind: 'construction', id: 'machine_gun_turret' },
      { kind: 'construction', id: 'rock_barrier' },
      { kind: 'utility', id: 'HE_GRENADE' },
    ]
    : [
      { kind: 'construction', id: 'machine_gun_turret' },
      { kind: 'construction', id: 'tesla_turret' },
      { kind: 'construction', id: 'rocket_turret' },
      { kind: 'construction', id: 'rock_barrier' },
      { kind: 'utility', id: 'HE_GRENADE' },
      { kind: 'utility', id: 'TRANSLOCATOR' },
    ];
  return resolveRadialActions({
    gameMode: 'coop_defense',
    tools,
    persistentRewardIds: [],
    // Genug Kapazität für die günstigen Bauwerke, das teuerste bleibt gesperrt.
    usedCapacity: 12,
    capacityMax: 40,
    now: openedAt,
    canUseUtility: !locked,
    canPlace: !locked,
    canManage: !locked,
    managementActions: compact ? ['reposition'] : ['reposition', 'dismantle', 'dismantle-own-all'],
    getUtilityChargeState: (utilityId) => utilityId === 'HE_GRENADE'
      ? {
        utilityId, revision: 1, maxCharges: 3, availableCharges: 2, rechargeIntervalMs: 9_000,
        nextChargeAt: openedAt + 6_000, lockoutUntil: 0,
      }
      : null,
    getCooldownUntil: (ref) => ref.kind === 'construction' && ref.constructionId === 'tesla_turret'
      ? openedAt + 7_500
      : 0,
  });
}

export function openRadialMenuPreview(
  scene: Phaser.Scene,
  variant: string,
  status: (message: string) => void,
): RadialMenuPreviewHandle {
  const menu = new RadialActionMenu(scene);
  let selected: RadialActionRef | null = null;
  let reopen: Phaser.Time.TimerEvent | null = null;
  const pointer = scene.input.activePointer;
  let origin = { x: 0, y: 0 };
  let entryCount = 0;
  let aimed: number | null = null;

  const open = (x: number, y: number): void => {
    const entries = fixtureEntries(variant, Date.now());
    origin = { x, y };
    entryCount = entries.length;
    menu.open(x, y, entries, selected ?? entries[0]?.ref ?? null);
    status(`Utility-Rad · ${entries.length} Einträge · Klick wählt wie Loslassen von R`);
  };
  const update = (): void => {
    if (!menu.isOpen) return;
    if (aimed === null) {
      menu.update(pointer.x, pointer.y);
      return;
    }
    // Negativer Index: Zeiger in der Totzone, der Fokus bleibt auf der ausgerüsteten Aktion.
    const reach = aimed < 0 ? 0 : 100;
    const angle = -Math.PI / 2 + ((aimed + 0.5) / Math.max(1, entryCount)) * Math.PI * 2;
    menu.update(origin.x + Math.cos(angle) * reach, origin.y + Math.sin(angle) * reach);
  };
  const control = {
    zoom: (originX: number, originY: number, zoom: number): void => {
      for (const camera of scene.cameras.cameras) camera.setOrigin(originX, originY).setZoom(zoom);
    },
    aim: (index: number | null): void => { aimed = index; },
    reopen: (): void => open(scene.scale.width / 2, scene.scale.height / 2),
  };
  (window as unknown as { __radialPreview?: typeof control }).__radialPreview = control;
  const choose = (clicked: Phaser.Input.Pointer): void => {
    if (!menu.isOpen) return;
    const choice = menu.close(clicked.x, clicked.y);
    if (choice) selected = choice;
    status(choice ? `Gewählt: ${JSON.stringify(choice)}` : 'Totzone · Auswahl unverändert');
    reopen?.remove();
    reopen = scene.time.delayedCall(REOPEN_DELAY_MS, () => open(clicked.x, clicked.y));
  };

  scene.events.on('update', update);
  scene.input.on('pointerdown', choose);
  open(scene.scale.width / 2, scene.scale.height / 2);

  return {
    build: () => undefined,
    hide: () => menu.close(),
    destroy: () => {
      reopen?.remove();
      scene.events.off('update', update);
      scene.input.off('pointerdown', choose);
      menu.destroy();
      control.zoom(0.5, 0.5, 1);
      delete (window as unknown as { __radialPreview?: typeof control }).__radialPreview;
    },
  };
}
