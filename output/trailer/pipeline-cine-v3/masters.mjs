// Resolves master files: 'v2:<shot>' reuses a master of the October V2 trailer pipeline.
export const ROOT = 'C:/Fragdachse/output/trailer/pipeline-cine-v3';
const V2 = 'C:/Fragdachse/output/trailer/pipeline-cine-2026-10';
export const DRAFT = !!process.env.DRAFT;
const dir = DRAFT ? 'masters-draft' : 'masters';
export const master = shot => shot.startsWith('v2:') ? `${V2}/${dir}/${shot.slice(3)}` : `${ROOT}/${dir}/${shot}`;
