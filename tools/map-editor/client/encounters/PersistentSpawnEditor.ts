import { COOP_DEFENSE_ENEMY_KINDS, getCoopDefenseEnemyConfig } from '../../../../src/config/coopDefenseEnemies';
import { getEnemyName } from '../../../../src/i18n/contentPresentation';
import { DEFAULT_SPAWN_FRONT, SPAWN_FRONTS } from '../../../../src/utils/spawnFront';
import { array, object, type JsonObject, type Path } from '../../shared/json';
import { persistentSpawnXp } from '../../shared/persistentSpawnXp';
import { FRONT_LABELS, setPersistentSpawnSource } from '../../shared/spawns';
import { button, element, heading, numberField, selectField, type EditorEnvironment } from '../ui';

export function persistentSpawnEditor(env: EditorEnvironment, index: number, spawn: JsonObject): HTMLElement {
  const draft = env.session.draft, path: Path = ['persistentSpawns', index], box = element('section', 'card persistent-card');
  const xp = persistentSpawnXp(spawn, draft.balanceReferenceDurationSec);
  box.append(heading(`∞ ${spawn.id}`, 'Permanente Quelle · wiederholt sich ab ihrer Startzeit'));
  box.append(element('p', 'persistent-metric', `Bis Planende: ${xp.count} Gegner · ${xp.xp} XP${xp.complete ? '' : ' (unvollständig)'}${xp.dynamic ? ' + dynamisch' : ''}`));
  const fields = element('div', 'group-fields');
  const kinds = COOP_DEFENSE_ENEMY_KINDS.filter(kind => !getCoopDefenseEnemyConfig(kind).isBoss);
  const bases = array(draft.bases).filter(base => base.role === 'spawn-point' && base.spawnCenter);
  const source = object(spawn.source);
  fields.append(selectField('Gegnerart', String(spawn.enemyKind), kinds.map(value => ({ value, label: getEnemyName(value, 'de') })), value => {
    env.session.change([...path, 'enemyKind'], value); env.changed();
  }), numberField(env, 'Menge pro Spawn', [...path, 'countPerTick'], { min: 1 }),
    numberField(env, 'Intervall (s)', [...path, 'intervalMs'], { min: 0.001, scale: 1000, step: 0.001, write: value => env.session.change([...path, 'intervalMs'], Math.round(value!)) }),
    numberField(env, 'Start nach (s)', [...path, 'startAtMs'], { fallback: 0, min: 0, scale: 1000, step: 0.001, optional: true, write: value => env.session.change([...path, 'startAtMs'], value === undefined ? undefined : Math.round(value)) }),
    selectField('Spawn-Quelle', String(source.type), [{ value: 'map', label: 'Kartenrand / Front' }, { value: 'base', label: 'Spawn-Basis', disabled: !bases.length }], value => {
      env.session.transact('Spawn-Quelle ändern', draft => setPersistentSpawnSource(draft, index, value as 'map' | 'base', String(bases[0]?.id ?? ''))); env.changed();
    }));
  if (source.type === 'base') {
    const options = bases.map(base => ({ value: String(base.id), label: String(base.id) }));
    if (!options.some(o => o.value === source.baseId)) options.unshift({ value: String(source.baseId ?? ''), label: `${source.baseId ?? 'Keine Basis'} (ungültig)` });
    fields.append(selectField('Spawn-Basis', String(source.baseId ?? ''), options, value => {
      env.session.change([...path, 'source', 'baseId'], value); env.changed();
    }));
  } else fields.append(selectField('Front', String(spawn.front ?? DEFAULT_SPAWN_FRONT), SPAWN_FRONTS.map(value => ({ value, label: `${FRONT_LABELS[value]}${spawn.front === undefined && value === DEFAULT_SPAWN_FRONT ? ' (Standard)' : ''}` })), value => {
    env.session.change([...path, 'front'], value); env.changed();
  }));
  box.append(fields);
  box.append(element('p', 'muted', source.type === 'base'
    ? 'Spawnt am Spawnzentrum der Basis, solange sie aktiv ist. Die XP-Planung nimmt eine durchgehend aktive Basis an.'
    : 'Spawnt aus der gewählten Front. Diese ist auf der Karte unter „Aktive Spawnfronten“ markiert.'));
  const baseIndex = array(draft.bases).findIndex(base => base.id === source.baseId);
  box.append(button(source.type === 'base' ? 'Spawn-Basis auf Karte zeigen' : 'Front auf Karte zeigen', () => {
    env.openMap(source.type === 'base' ? ['bases', baseIndex, 'anchor'] : [...path, 'front']);
  }, '', source.type === 'base' && baseIndex < 0));
  return box;
}
