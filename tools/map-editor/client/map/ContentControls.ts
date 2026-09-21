import { TIMED_POWERUP_PEDESTAL_CONFIGS } from '../../../../src/powerups/PowerUpConfig';
import { getPowerUpName } from '../../../../src/i18n/contentPresentation';
import { array, at, object } from '../../shared/json';
import { button, element, heading, numberField, selectField, type EditorEnvironment } from '../ui';
import { mapMetrics, type MapObject } from './objects';

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
