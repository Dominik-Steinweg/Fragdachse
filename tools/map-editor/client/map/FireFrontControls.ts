import { at, object, type Path } from '../../shared/json';
import { element, heading, numberField, type EditorEnvironment } from '../ui';
import type { MapObject } from './objects';

export function fireFrontControls(env: EditorEnvironment, item: MapObject): HTMLElement {
  const box = element('div'), path = item.path.slice(0, -1);
  const event = object(at(env.session.draft, path)), start = object(event.start), spread = object(event.spread);
  const seconds = (label: string, tail: Path, min = 0, optional = false) => {
    const fieldPath = [...path, ...tail];
    return numberField(env, label, fieldPath, { min, step: .001, scale: 1000, optional,
      fallback: optional ? 0 : undefined,
      write: value => env.session.change(fieldPath, value === undefined ? undefined : Math.round(value), label),
    });
  };
  box.append(heading('Ausbreitung & Zeiten'), element('p', 'muted',
    'Die Front breitet sich von links nach rechts aus. Erreichte Flächen brennen dauerhaft weiter. Alle Zeiten sind in Sekunden angegeben.'));
  if (start.type === 'time') {
    box.append(seconds('Startzeit (s)', ['start', 'atMs']));
  } else {
    const triggers: Record<string, string> = {
      'after-checkpoint': `nach Checkpoint ${start.checkpointId}`,
      'after-encounter': `nach Encounter ${start.encounterId}`,
      'after-event': `nach Ereignis ${start.eventId}`,
      'boss-phase': `bei Bossphase ${start.phase}`,
      'base-destroyed': `nach Zerstörung der Basis ${start.baseId}`,
    };
    box.append(element('p', 'muted', `Start: ${triggers[String(start.type)] ?? String(start.type)}. Die Verzögerung beginnt nach diesem Auslöser.`));
  }
  box.append(
    seconds('Verzögerung nach Start (s)', ['delayMs'], 0, true),
    seconds('Ausbreitungsdauer (s)', ['spread', 'durationMs'], .001),
    seconds('Vorwarnzeit je Zelle (s)', ['spread', 'warningLeadMs']),
    seconds('Nachbrenndauer bei Treffern (s)', ['effect', 'burnDurationMs'], .001),
    numberField(env, 'Unregelmäßigkeit (Zellen)', [...path, 'spread', 'roughnessCells'], { min: 0, step: .01 }),
  );
  if (start.type === 'time') {
    const action = (Number(start.atMs) + Number(event.delayMs ?? 0)) / 1000;
    box.append(element('p', 'muted', `Ausbreitungsbeginn: ${action.toLocaleString('de-DE')} s Rundenzeit. Ausbreitungsende: ${(action + Number(spread.durationMs) / 1000).toLocaleString('de-DE')} s.`));
  }
  box.append(element('p', 'muted', 'Die Karte zeigt die gesamte Zielfläche. Darunterliegende Objekte haben beim Anklicken Vorrang. Feuerfront über ihren Rand oder die Liste wählen; Alt+Klick wechselt durch überlappende Objekte.'));
  return box;
}
