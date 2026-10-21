import { TIMED_POWERUP_PEDESTAL_CONFIGS } from '../../../../src/powerups/PowerUpConfig';
import { getPowerUpName } from '../../../../src/i18n/contentPresentation';
import { array, at, object } from '../../shared/json';
import { button, element, heading, numberField, selectField, type EditorEnvironment } from '../ui';
import { mapMetrics, type MapObject } from './objects';
import { REACTIVE_PROP_SCATTER_DEFAULTS, reactivePropKindIds, reactivePropKindLabel, reactivePropVariantOptions } from './reactivePropLabels';
import { uniqueId } from '../../shared/json';

const powerUpOptions = Object.keys(TIMED_POWERUP_PEDESTAL_CONFIGS).map(value => ({ value, label: getPowerUpName(value, 'de') }));

export function trackControls(env: EditorEnvironment, item?: MapObject): HTMLElement {
  const draft = env.session.draft, box = element('div');
  const mode = String(draft.trackMode ?? 'rails'), position = draft.trackPosition ?? 'center';
  const fixed = typeof position === 'object';
  box.append(heading('Gleise'), selectField('Gleismodus', mode, [
    { value: 'rails', label: 'Gleise vorhanden' }, { value: 'none', label: 'Keine Gleise' },
    { value: 'void-fire', label: 'Void-Korridor ohne Schienen' },
  ], value => { env.session.change(['trackMode'], value); env.changed(); }));
  if (mode !== 'none') {
    box.append(selectField('Gleisposition', fixed ? 'grid' : String(position), [
      { value: 'left', label: 'Links (automatisch)' }, { value: 'center', label: 'Mitte (automatisch)' },
      { value: 'right', label: 'Rechts (automatisch)' }, { value: 'grid', label: 'Feste Rasterspalte' },
    ], value => {
      env.session.change(['trackPosition'], value === 'grid' ? { kind: 'grid', gridX: Math.round(item?.x ?? mapMetrics(draft).gridCols / 2) } : value); env.changed();
    }));
    if (fixed) box.append(numberField(env, 'Linke Gleisspalte X', ['trackPosition', 'gridX'], { min: 0, max: mapMetrics(draft).gridCols - 2 }));
    box.append(element('p', 'muted', 'Zwei Zellen breit über die gesamte Höhe. Automatische Positionen werden nach „Aktualisieren“ sichtbar. Ziehen legt eine feste Spalte fest.'));
  }
  if (array(draft.mapEvents).some(event => event.type === 'train')) box.append(element('p', 'muted', 'Diese Map enthält Zugereignisse und benötigt den Modus „Gleise vorhanden“.'));
  return box;
}

export function addPowerUpControls(env: EditorEnvironment): HTMLElement {
  const box = element('div'); let defId = powerUpOptions[0].value;
  box.append(heading('Power-Ups'), selectField('Neues Power-Up', defId, powerUpOptions, value => { defId = value; }),
    button('Power-Up hinzufügen', () => {
      const config = TIMED_POWERUP_PEDESTAL_CONFIGS[defId], index = array(env.session.draft.powerUps).length;
      env.session.splice(['powerUps'], index, 0, [{ defId, region: 'middle', respawnMs: config.respawnMs, spawnOnArenaStart: config.spawnOnArenaStart }]);
      env.session.selection = `powerup:${env.session.key(['powerUps'], index)}`; env.changed();
    }));
  return box;
}

export function powerUpControls(env: EditorEnvironment, item: MapObject): HTMLElement {
  const box = element('div'), path = item.powerUpPath!, config = object(at(env.session.draft, path));
  const linked = path[0] === 'bases', fixed = linked || config.anchor !== undefined;
  box.append(selectField('Power-Up-Art', String(config.defId), powerUpOptions, value => {
    env.session.change([...path, 'defId'], value); env.changed();
  }));
  if (!linked) {
    box.append(selectField('Platzierung', fixed ? 'fixed' : 'automatic', [
      { value: 'automatic', label: 'Automatisch in Region' }, { value: 'fixed', label: 'Feste Position' },
    ], value => {
      env.session.change(item.path, value === 'fixed' ? { gridX: item.x, gridY: item.y } : undefined); env.changed();
    }));
    if (!fixed) {
      box.append(selectField('Region', String(config.region), [
        { value: 'front', label: 'Vorne' }, { value: 'middle', label: 'Mitte' }, { value: 'rear', label: 'Hinten' },
      ], value => { env.session.change([...path, 'region'], value); env.changed(); }));
      box.append(element('p', 'muted', item.hidden ? 'Für die tatsächliche Position die Vorschau aktualisieren. Eine feste Position kann direkt eingegeben werden.' : 'Die Vorschau zeigt die generierte Position. Ziehen wandelt sie in eine feste Position um.'));
    }
  }
  if (fixed) {
    box.append(numberField(env, linked ? 'Versatz X zur Basis' : 'X (Zelle)', [...item.path, 'gridX']),
      numberField(env, linked ? 'Versatz Y zur Basis' : 'Y (Zelle)', [...item.path, 'gridY']));
    if (linked) box.append(element('p', 'muted', 'Dieses Power-Up gehört zur Basis und bewegt sich mit ihr. Die Werte sind lokale Zellversätze.'));
  }
  if (!linked) box.append(button('Power-Up löschen', () => {
    env.session.splice(['powerUps'], Number(path[1]), 1); env.session.selection = null; env.changed();
  }, 'danger'));
  return box;
}

/** Kind for the next anchor; a session-local choice of the editor, never part of the map. */
let nextAnchorKind = 'explosive_barrel';

/** Reactive map props: anchors on fixed cells (any kind) and one seeded scatter per kind. */
export function addReactivePropControls(env: EditorEnvironment): HTMLElement {
  const box = element('div'), draft = env.session.draft, scatter = array(object(draft.reactiveProps).scatter);
  box.append(heading('Reaktive Map-Objekte'),
    selectField('Kind für neuen Anker', nextAnchorKind, reactivePropKindIds().map(value => ({ value, label: reactivePropKindLabel(value) })),
      value => { nextAnchorKind = value; env.changed(); }),
    button('Anker hinzufügen', () => {
      const metrics = mapMetrics(env.session.draft);
      env.session.transact(`${reactivePropKindLabel(nextAnchorKind)}-Anker anlegen`, next => {
        const props = object(next.reactiveProps ??= {}); const anchors = (props.anchors ??= []) as unknown[];
        anchors.push({ id: uniqueId(array(anchors), nextAnchorKind.split('_').at(-1) ?? 'prop'), kind: nextAnchorKind,
          gridX: Math.floor(metrics.gridCols / 2), gridY: Math.floor(metrics.gridRows / 2) });
      });
      env.session.selection = `prop:${env.session.key(['reactiveProps', 'anchors'], array(object(env.session.draft.reactiveProps).anchors).length - 1)}`;
      env.changed();
    }));
  for (const kind of reactivePropKindIds()) {
    const index = scatter.findIndex(entry => entry.kind === kind);
    const label = reactivePropKindLabel(kind);
    if (index < 0) {
      box.append(button(`Strategisch streuen: ${label}`, () => {
        env.session.transact(`${label}-Streuung anlegen`, next => {
          const props = object(next.reactiveProps ??= {}); const list = (props.scatter ??= []) as unknown[];
          list.push({ kind, placement: 'chokepoints', ...REACTIVE_PROP_SCATTER_DEFAULTS[kind] });
        }); env.changed();
      }));
      continue;
    }
    box.append(element('h4', '', `Streuung: ${label}`),
      selectField('Platzierung', String(scatter[index].placement ?? 'open'), [
        { value: 'chokepoints', label: 'Strategisch: Engstellen auf Gegnerrouten' },
        { value: 'open', label: 'Frei auf offenem Boden' },
      ], value => { env.session.change(['reactiveProps', 'scatter', index, 'placement'], value === 'open' ? undefined : value); env.changed(); }),
      selectField('Variante', String(scatter[index].variant ?? ''), reactivePropVariantOptions(kind), value => {
        env.session.change(['reactiveProps', 'scatter', index, 'variant'], value || undefined); env.changed();
      }),
      numberField(env, 'Gruppen', ['reactiveProps', 'scatter', index, 'clusters'], { min: 0, max: 64 }),
      numberField(env, 'Mindestabstand (Zellen)', ['reactiveProps', 'scatter', index, 'minSpacingCells'], { min: 2, max: 64 }),
      button(`Streuung entfernen: ${label}`, () => {
        env.session.splice(['reactiveProps', 'scatter'], index, 1); env.changed();
      }, 'danger'));
  }
  box.append(element('p', 'muted', 'Strategisch: Gruppen an der Wand neben Engstellen zwischen Spawnquellen und Basis; die Route bleibt mindestens drei Zellen breit. Frei: Gruppen auf offenem Boden. Positionen hängen vom Seed ab und zeigt die Vorschau.'));
  return box;
}

export function reactivePropControls(env: EditorEnvironment, item: MapObject): HTMLElement {
  const box = element('div'), value = object(at(env.session.draft, item.path));
  box.append(selectField('Kind', String(value.kind ?? 'explosive_barrel'), reactivePropKindIds().map(kind => ({ value: kind, label: reactivePropKindLabel(kind) })), next => {
    env.session.transact('Kind des Ankers ändern', draft => {
      const anchor = object(at(draft, item.path)); anchor.kind = next; delete anchor.variant;
    }); env.changed();
  }), selectField('Variante', String(value.variant ?? ''), reactivePropVariantOptions(value.kind), next => {
    env.session.change([...item.path, 'variant'], next || undefined); env.changed();
  }), numberField(env, 'X (Zelle)', [...item.path, 'gridX']), numberField(env, 'Y (Zelle)', [...item.path, 'gridY']),
  element('p', 'muted', 'Der Generator hält die Zelle felsfrei; auf Basis, Gleis oder Podest lehnt er den Anker ab.'),
  button('Anker löschen', () => {
    env.session.splice(['reactiveProps', 'anchors'], Number(item.path[2]), 1); env.session.selection = null; env.changed();
  }, 'danger'));
  return box;
}
