import type { CoopDefenseMapAuthoringConfig } from './coopDefenseMapAuthoring';

export type MapReferenceKind = 'encounter' | 'event' | 'checkpoint' | 'defense' | 'base' | 'wall' | 'objective';
export interface MapReference { kind: MapReferenceKind; id: string; path: string }

/** Reference projection, including sources the editor is not allowed to edit. */
export function collectCoopDefenseMapReferences(map: CoopDefenseMapAuthoringConfig): MapReference[] {
  const refs: MapReference[] = [];
  const add = (kind: MapReferenceKind, id: string | undefined, path: string) => {
    if (id !== undefined) refs.push({ kind, id, path });
  };
  const trigger = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    const t = value as Record<string, unknown>;
    for (const [field, kind] of Object.entries({ encounterId: 'encounter', eventId: 'event', checkpointId: 'checkpoint',
      defenseId: 'defense', baseId: 'base', wallId: 'wall' } as const)) {
      if (typeof t[field] === 'string') add(kind, t[field] as string, `${path}/${field}`);
    }
  };
  map.encounters?.forEach((e, i) => trigger(e.start, `/encounters/${i}/start`));
  map.mapEvents?.forEach((e, i) => trigger(e.start, `/mapEvents/${i}/start`));
  map.secondaryObjectives?.forEach((o, i) => {
    for (const field of ['start', 'focusUntil', 'holdUntil'] as const) trigger(o[field], `/secondaryObjectives/${i}/${field}`);
    o.targets?.forEach((id, n) => add('base', id, `/secondaryObjectives/${i}/targets/${n}`));
  });
  map.missionProgress?.checkpoints?.forEach((c, i) => trigger(c.completeOn, `/missionProgress/checkpoints/${i}/completeOn`));
  map.missionProgress?.barriers?.forEach((b, i) => trigger(b.openOn, `/missionProgress/barriers/${i}/openOn`));
  map.missionProgress?.mandatoryDefenses?.forEach((d, i) => {
    add('checkpoint', d.checkpointId, `/missionProgress/mandatoryDefenses/${i}/checkpointId`);
    add('objective', d.objectiveId, `/missionProgress/mandatoryDefenses/${i}/objectiveId`);
  });
  map.tutorialSteps?.forEach((s, i) => add('checkpoint', s.checkpointId, `/tutorialSteps/${i}/checkpointId`));
  add('checkpoint', map.persistentBasePreview?.checkpointId, '/persistentBasePreview/checkpointId');
  map.persistentSpawns?.forEach((s, i) => { if (s.source.type === 'base') add('base', s.source.baseId, `/persistentSpawns/${i}/source/baseId`); });
  return refs;
}

export function getCoopDefenseReferenceTargets(map: CoopDefenseMapAuthoringConfig): Record<MapReferenceKind, readonly string[]> {
  return {
    encounter: map.encounters?.map(e => e.id) ?? [], event: map.mapEvents?.map(e => e.id) ?? [],
    checkpoint: map.missionProgress?.checkpoints?.map(e => e.id) ?? [],
    defense: map.missionProgress?.mandatoryDefenses?.map(e => e.id) ?? [],
    base: [...(map.bases?.map(e => e.id) ?? []), ...(map.persistentBase ? [map.persistentBase.baseId] : [])],
    wall: map.rockWalls?.map(e => e.id) ?? [], objective: map.secondaryObjectives?.map(e => e.id) ?? [],
  };
}
