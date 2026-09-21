import { COOP_DEFENSE_ENEMY_KINDS, getCoopDefenseEnemyConfig, resolveCoopDefenseEnemySpawnConfig } from '../../../../src/config/coopDefenseEnemies';
import { resolveEnemyLifecycleTotals } from '../../../../src/config/coopDefenseEnemyLifecycle';
import { DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS, type CoopDefenseMapAuthoringConfig } from '../../../../src/config/coopDefenseMapAuthoring';
import { collectCoopDefenseMapReferences, getCoopDefenseReferenceTargets } from '../../../../src/config/coopDefenseMapReferences';
import { getEnemyName } from '../../../../src/i18n/contentPresentation';
import { DEFAULT_SPAWN_FRONT, SPAWN_FRONTS } from '../../../../src/utils/spawnFront';
import { array, at, clone, object, set, uniqueId, type JsonObject, type Path } from '../../shared/json';
import { validateDocument } from '../../shared/validation';
import { button, confirmEdit, element, heading, numberField, selectField, type EditorEnvironment } from '../ui';

export function encounterXp(encounter: JsonObject): { xp: number; direct: number; follow: number; count: number; complete: boolean; dynamic: boolean } {
  const result = { xp: 0, direct: 0, follow: 0, count: 0, complete: true, dynamic: false };
  for (const group of array(encounter.groups)) {
    const life = resolveEnemyLifecycleTotals(String(group.enemyKind));
    let count = Number(group.count);
    if (!Number.isInteger(count) || count < 0 || !life.complete) result.complete = false;
    if (!Number.isFinite(count)) continue;
    try { count = resolveCoopDefenseEnemySpawnConfig(String(group.enemyKind), { intervalMs: 1, countPerTick: count }, 1).countPerTick; } catch { result.complete = false; }
    result.count += count; result.xp += count * life.xp; result.direct += count * life.directXp; result.follow += count * life.followXp; result.dynamic ||= life.dynamic;
  }
  return result;
}

export class EncounterView {
  selectedId: string | null = null;
  search = '';
  expanded = new Set<string>();
  private current: HTMLElement | null = null;
  constructor(private readonly env: EditorEnvironment) {}
  render(): HTMLElement {
    const scrolls = [...(this.current?.querySelectorAll<HTMLElement>('[data-scroll]') ?? [])].map(e => e.scrollTop);
    const env = this.env, draft = env.session.draft, encounters = array(draft.encounters);
    if (!encounters.some(e => e.id === this.selectedId)) this.selectedId = String(encounters[0]?.id ?? '') || null;
    const root = element('div', 'encounter-content');
    root.append(heading('Encounter', 'Dokumentreihenfolge · konfigurierte Mengen · Referenz: 1 Spieler'));
    const actions = element('div', 'toolbar');
    actions.append(button('+ Encounter', () => {
      const id = uniqueId(encounters, 'encounter');
      env.session.splice(['encounters'], encounters.length, 0, [{ id, start: encounters.length ? { type: 'after-previous' } : { type: 'time', atMs: 0 }, groups: [] }]);
      this.selectedId = id; env.changed();
    })); root.append(actions);
    const table = element('table', 'encounter-table');
    const thead = element('thead'); const head = element('tr');
    for (const label of ['Encounter', 'Startbedingung', 'Pause danach (s)', 'Gegner', 'Feste XP', 'Aktionen']) head.append(element('th', '', label));
    thead.append(head); table.append(thead); const body = element('tbody');
    encounters.forEach((encounter, index) => {
      const row = element('tr', encounter.id === this.selectedId ? 'selected' : ''); const xp = encounterXp(encounter);
      const id = element('td'); id.append(button(`${index + 1}. ${encounter.id}`, () => { this.selectedId = String(encounter.id); env.changed(); }, 'text-button')); row.append(id);
      const start = element('td'); start.append(this.triggerEditor(index, object(encounter.start))); row.append(start);
      const pause = element('td'); const effective = index < encounters.length - 1 && (draft.objective === 'repel-assault' || object(encounters[index + 1]?.start).type === 'after-previous');
      pause.append(numberField(env, 'Pause', ['encounters', index, 'restAfterMs'], { fallback: 0, min: 0, step: 0.001, scale: 1000, optional: true, disabled: !effective }));
      if (!effective) pause.append(element('small', 'muted', 'In dieser Reihenfolge unwirksam')); row.append(pause);
      row.append(element('td', 'numeric', String(xp.count)), element('td', 'numeric', `${xp.complete ? xp.xp : `${xp.xp} (unvollständig)`}${xp.dynamic ? ' + dynamisch' : ''}`));
      const ops = element('td', 'row-actions');
      ops.append(button('↑', () => this.reorder(index, index - 1), '', index === 0), button('↓', () => this.reorder(index, index + 1), '', index === encounters.length - 1),
        button('Kopie', async () => {
          const copy = clone(encounter); copy.id = uniqueId(encounters, String(encounter.id));
          const candidate = [...encounters]; candidate.splice(index + 1, 0, copy);
          const changes = this.previousChanges(encounters, candidate);
          if (changes && !await confirmEdit(changes + '\n\nKopie an dieser Position einfügen?')) return;
          env.session.splice(['encounters'], index + 1, 0, [copy]); this.selectedId = String(copy.id); env.changed();
        }),
        button('Löschen', () => this.remove(index), 'danger')); row.append(ops); body.append(row);
    }); table.append(body);
    const overview = element('div', 'encounter-overview'); overview.dataset.scroll = ''; overview.append(table); root.append(overview);
    const index = encounters.findIndex(e => e.id === this.selectedId);
    const detail = element('div', 'encounter-detail');
    if (index >= 0) detail.append(this.enemyList(index, encounters[index]));
    detail.append(this.summary(encounters));
    for (const card of detail.querySelectorAll<HTMLElement>('.card')) card.dataset.scroll = '';
    root.append(detail); this.current = root;
    queueMicrotask(() => { root.querySelectorAll<HTMLElement>('[data-scroll]').forEach((e, i) => { e.scrollTop = scrolls[i] ?? 0; }); });
    return root;
  }
  private triggerEditor(index: number, start: JsonObject): HTMLElement {
    const { env } = this; const path: Path = ['encounters', index, 'start']; const box = element('div');
    const labels: Record<string, string> = { time: 'Zeit', 'after-previous': 'Vorheriger Encounter', 'after-encounter': 'Encounter abgeschlossen', 'after-checkpoint': 'Checkpoint aktiviert', 'after-defense': 'Defense aufgelöst (auch fehlgeschlagen)', 'after-event': 'Endliches Ereignis abgeschlossen', 'boss-phase': 'Bossphase', 'base-destroyed': 'Basis zerstört' };
    box.append(selectField('Start', String(start.type), Object.entries(labels).map(([value, label]) => ({ value, label, disabled: value === 'after-previous' && index === 0 || value === 'boss-phase' && object(env.session.draft.boss).enemyKind !== 'void-hunter' })), type => {
      const value: JsonObject = { type };
      if (type === 'time') value.atMs = 0;
      else if (type === 'boss-phase') value.phase = 2;
      else if (type !== 'after-previous') value[this.referenceField(type)] = '';
      env.session.change(path, value); env.changed();
    }));
    if (start.type === 'time') box.append(numberField(env, 'Start nach (s)', [...path, 'atMs'], { min: 0, scale: 1000, step: 0.001 }));
    else if (start.type === 'boss-phase') box.append(element('small', 'muted', 'Phase 2 · Void Hunter'));
    else if (start.type !== 'after-previous') {
      const field = this.referenceField(String(start.type)); const kind = field.replace('Id', '') as keyof ReturnType<typeof getCoopDefenseReferenceTargets>;
      const targets = getCoopDefenseReferenceTargets(env.session.draft as unknown as CoopDefenseMapAuthoringConfig);
      let options = targets[kind] ?? [];
      if (kind === 'event') options = array(env.session.draft.mapEvents).filter(e => (e.type === 'train' && e.repeatAfterExitMs === undefined) || (e.type === 'airstrike' && e.pattern !== 'player-hunt') || (e.type === 'ground-hazard' && e.durationMs !== undefined)).map(e => String(e.id));
      const ownId = array(env.session.draft.encounters)[index]?.id;
      box.append(selectField('Referenz', String(start[field] ?? ''), [{ value: '', label: 'Ziel auswählen' }, ...options.filter(id => kind !== 'encounter' || id !== ownId).map(id => ({ value: id, label: id }))], value => { env.session.change([...path, field], value); env.changed(); }));
    }
    return box;
  }
  private referenceField(type: string): string { return ({ 'after-encounter': 'encounterId', 'after-checkpoint': 'checkpointId', 'after-defense': 'defenseId', 'after-event': 'eventId', 'base-destroyed': 'baseId' } as Record<string, string>)[type] ?? ''; }
  private async reorder(index: number, target: number): Promise<void> {
    const { env } = this; const candidate = clone(env.session.draft), list = array(candidate.encounters);
    const [entry] = list.splice(index, 1); list.splice(target, 0, entry);
    const issues = validateDocument(candidate).issues.filter(i => i.severity === 'error');
    if (issues.length) return env.message(issues.map(i => `${i.path}: ${i.message}`).join('\n'));
    const changes = this.previousChanges(array(env.session.draft.encounters), list);
    if (changes && !await confirmEdit(changes + '\n\nReihenfolge übernehmen?')) return;
    env.session.change(['encounters'], list, 'Encounter umordnen'); env.changed();
  }
  private previousChanges(before: JsonObject[], after: JsonObject[]): string {
    return after.flatMap((e, i) => {
      const oldIndex = before.findIndex(old => old.id === e.id);
      return oldIndex >= 0 && object(e.start).type === 'after-previous' && before[oldIndex - 1]?.id !== after[i - 1]?.id
        ? [`${e.id}: Vorgänger ${before[oldIndex - 1]?.id ?? 'keiner'} → ${after[i - 1]?.id ?? 'keiner'}`] : [];
    }).join('\n');
  }
  private async remove(index: number): Promise<void> {
    const { env } = this, list = array(env.session.draft.encounters), id = String(list[index].id);
    const refs = collectCoopDefenseMapReferences(env.session.draft as unknown as CoopDefenseMapAuthoringConfig).filter(r => r.kind === 'encounter' && r.id === id && !r.path.startsWith(`/encounters/${index}/`));
    if (refs.length) return env.message(`Encounter wird noch referenziert:\n${refs.map(r => r.path).join('\n')}`);
    const after = list.filter((_, i) => i !== index), changes = this.previousChanges(list, after);
    if (changes && !await confirmEdit(changes + '\n\nEncounter trotzdem löschen?')) return;
    env.session.splice(['encounters'], index, 1); env.changed();
  }
  private enemyList(index: number, encounter: JsonObject): HTMLElement {
    const { env } = this, box = element('section', 'card'); box.append(heading(String(encounter.id), 'Vorhandene Gegnerarten · Mehrere Gruppen bleiben getrennt'));
    const filters = element('div', 'toolbar'); const search = element('input'); search.type = 'search'; search.placeholder = 'Gegner suchen'; search.value = this.search;
    search.onchange = () => { this.search = search.value; env.changed(); };
    search.onkeydown = event => { if (event.key === 'Enter') { this.search = search.value; env.changed(); } };
    filters.append(search); box.append(filters);
    const groups = array(encounter.groups);
    const available = COOP_DEFENSE_ENEMY_KINDS.filter(kind => !getCoopDefenseEnemyConfig(kind).isBoss && !groups.some(g => g.enemyKind === kind));
    let addition = available[0];
    if (addition) {
      const add = element('div', 'toolbar');
      add.append(selectField('Neue Gegnerart', addition, available.map(value => ({ value, label: getEnemyName(value, 'de') })), value => { addition = value as typeof addition; }),
        button('Gegnerart hinzufügen', () => {
          env.session.splice(['encounters', index, 'groups'], groups.length, 0, [{ enemyKind: addition, count: 1 }]);
          this.search = ''; this.expanded.add(addition); env.changed();
        })); box.append(add);
    }
    if (!groups.length) box.append(element('p', 'muted', 'Noch keine Gegnerarten. Über die Auswahl eine Art hinzufügen.'));
    const list = element('div', 'enemy-list');
    for (const kind of COOP_DEFENSE_ENEMY_KINDS.filter(kind => groups.some(g => g.enemyKind === kind))) {
      const config = getCoopDefenseEnemyConfig(kind), name = getEnemyName(kind, 'de');
      const indices = groups.flatMap((g, i) => g.enemyKind === kind ? [i] : []);
      if (this.search && !`${name} ${kind}`.toLowerCase().includes(this.search.toLowerCase())) continue;
      const row = element('div', 'enemy-row'); const life = resolveEnemyLifecycleTotals(kind);
      const total = indices.reduce((sum, i) => sum + Number(groups[i].count), 0);
      row.append(element('strong', '', name), element('small', 'muted', kind));
      if (indices.length > 1) row.append(element('span', 'numeric', `${total} · ${indices.length} Spawn-Gruppen`));
      else row.append(numberField(env, 'Menge', ['enemy-count', encounter.id as string, kind], { read: total, min: 0, disabled: config.isBoss, write: value => {
        const count = value ?? 0;
        if (indices.length) { if (count === 0) env.session.splice(['encounters', index, 'groups'], indices[0], 1); else env.session.change(['encounters', index, 'groups', indices[0], 'count'], count); }
        else if (count > 0) env.session.splice(['encounters', index, 'groups'], groups.length, 0, [{ enemyKind: kind, count }]);
      } }));
      row.append(element('span', 'numeric', `${config.xp} direkt / Gegner`), element('span', 'numeric', `${total * life.xp} XP (${total * life.followXp} Folge)${life.dynamic ? ' + dynamisch' : ''}`));
      if (config.isBoss) row.append(element('small', 'muted', 'Nur im Boss-Slot'));
      else row.append(button(`${this.expanded.has(kind) ? '−' : '+'} Gruppen`, () => { this.expanded.has(kind) ? this.expanded.delete(kind) : this.expanded.add(kind); env.changed(); }));
      row.append(button('Gegnerart löschen', () => {
        env.session.removeIndices(['encounters', index, 'groups'], indices); this.expanded.delete(kind); env.changed();
      }, 'danger'));
      list.append(row);
      if (this.expanded.has(kind) && !config.isBoss) {
        indices.forEach(groupIndex => list.append(this.groupEditor(index, groupIndex, groups[groupIndex])));
        list.append(button(`+ ${name}: weitere Gruppe (Standardfront ${DEFAULT_SPAWN_FRONT})`, () => {
          env.session.splice(['encounters', index, 'groups'], groups.length, 0, [{ enemyKind: kind, count: 1 }]); env.changed();
        }, 'text-button'));
      }
    }
    box.append(list); return box;
  }
  private groupEditor(encounter: number, index: number, group: JsonObject): HTMLElement {
    const { env } = this, path: Path = ['encounters', encounter, 'groups', index], row = element('div', 'group-row');
    row.append(numberField(env, `Gruppe ${index + 1}: Menge`, [...path, 'count'], { min: 1 }),
      numberField(env, 'Verzögerung (s)', [...path, 'delayMs'], { fallback: 0, min: 0, scale: 1000, step: 0.001, optional: true }),
      numberField(env, 'Spawnfenster (s)', [...path, 'spawnStaggerMs'], { fallback: DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS, min: 0, scale: 1000, step: 0.001, optional: true }),
      selectField('Spawnvorgabe', group.spawnArea ? 'area' : String(group.front ?? DEFAULT_SPAWN_FRONT), [{ value: 'area', label: 'Rechteckiges Gebiet' }, ...SPAWN_FRONTS.map(value => ({ value, label: `${value}${group.front === undefined && value === DEFAULT_SPAWN_FRONT ? ' (Standard)' : ''}` }))], value => {
        env.session.transact('Spawnvorgabe ändern', d => {
          set(d, [...path, 'front'], value === 'area' ? undefined : value);
          set(d, [...path, 'spawnArea'], value === 'area' ? { gridX: 0, gridY: 0, widthCells: 4, heightCells: 4 } : undefined);
        }); env.changed();
      }));
    if (group.spawnArea) row.append(button('Spawngebiet auf Karte bearbeiten', () => env.openMap([...path, 'spawnArea'])));
    row.append(button('Gruppe entfernen', () => { env.session.splice(['encounters', encounter, 'groups'], index, 1); env.changed(); }, 'danger')); return row;
  }
  private summary(encounters: JsonObject[]): HTMLElement {
    const { env } = this, draft = env.session.draft, box = element('section', 'card');
    box.append(heading('XP-Potenzial & Boss', '1 Spieler · keine garantierte individuelle Ausbeute'));
    const values = encounters.map(encounterXp), sum = values.reduce((total, e) => total + e.xp, 0);
    box.append(element('p', 'metric', `Encounter: ${sum} XP${values.every(e => e.complete) ? '' : ' · unvollständig'}`));
    const selected = encounters.find(e => e.id === this.selectedId);
    if (selected) { const xp = encounterXp(selected); box.append(element('p', '', `Auswahl: ${xp.xp} XP · ${xp.direct} direkt + ${xp.follow} feste Folge-XP`)); }
    const boss = object(draft.boss);
    if (draft.boss) {
      const life = resolveEnemyLifecycleTotals(String(boss.enemyKind)); box.append(element('p', '', `Boss separat: ${life.xp} XP${life.complete ? '' : ' · unvollständig'}`));
      box.append(selectField('Bossart', String(boss.enemyKind), COOP_DEFENSE_ENEMY_KINDS.filter(k => getCoopDefenseEnemyConfig(k).isBoss).map(value => ({ value, label: getEnemyName(value, 'de') })), value => { env.session.change(['boss', 'enemyKind'], value); env.changed(); }),
        numberField(env, 'Boss-Start (s)', ['boss', 'spawnAtMs'], { min: 0, scale: 1000, step: 0.001 }),
        button('Boss entfernen (Missionsziel benötigt weiterhin einen Boss)', () => { env.session.change(['boss'], undefined); env.changed(); }, 'danger'));
    } else box.append(button('+ Boss', () => { env.session.change(['boss'], { enemyKind: COOP_DEFENSE_ENEMY_KINDS.find(k => getCoopDefenseEnemyConfig(k).isBoss)!, spawnAtMs: 0 }); env.changed(); }, '', draft.objective !== 'defeat-boss'));
    const rewards = array(draft.secondaryObjectives).reduce((sum, o) => sum + Number(object(o.rewards).xpPerTarget ?? 0) * Number(o.targetGoal ?? array(o.targets).length), 0);
    box.append(element('p', '', `Weitere feste XP: ${rewards} · Nebenzielbelohnungen, bedingt erreichbar`));
    const dynamic = [...new Set(encounters.flatMap(e => array(e.groups)).filter(g => resolveEnemyLifecycleTotals(String(g.enemyKind)).dynamic).map(g => String(g.enemyKind)))];
    if (draft.boss && resolveEnemyLifecycleTotals(String(boss.enemyKind)).dynamic) dynamic.push(`Boss ${boss.enemyKind}`);
    box.append(element('p', 'muted', `Dynamische Zusatz-XP: ${dynamic.length ? dynamic.join(', ') : 'keine Beschwörer in Encountern/Boss'}; ${array(draft.persistentSpawns).length} permanente Quellen. Keine exakte Hochrechnung.`));
    return box;
  }
}
