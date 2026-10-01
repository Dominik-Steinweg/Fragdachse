/** Alpha-based presentation contract, independent of authored transparent margins.
 * Original crowns use a 192px display square and a 96px fade radius. Measure
 * opaque area and the central 144px hiding disc; sparse centres cannot be fixed
 * by scaling and are deliberately excluded from the runtime selection. */
export const CANOPY_COVERAGE = { alpha: 192, size: 512, coreRadius: 192, coreMinimum: .98, maxScale: 1.7 };
export function canopyCoverage(data, scale = 1) {
  const { size, alpha, coreRadius } = CANOPY_COVERAGE;
  let opaque = 0, covered = 0, samples = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= alpha) opaque++;
  for (let y = -coreRadius; y <= coreRadius; y += 2) for (let x = -coreRadius; x <= coreRadius; x += 2) {
    if (x*x+y*y >= coreRadius*coreRadius) continue;
    samples++;
    const px = Math.floor(size/2+x/scale), py = Math.floor(size/2+y/scale);
    if (data[(py*size+px)*4+3] >= alpha) covered++;
  }
  return { opaqueFraction: opaque/(size*size), displayedOpaqueFraction: opaque/(size*size)*scale*scale, coreCoverage: covered/samples };
}
export function normalizeCanopyCoverage(data, minimumArea) {
  const source = canopyCoverage(data);
  let scale = Math.ceil(Math.max(1,Math.sqrt(minimumArea/source.opaqueFraction))*100)/100;
  let coverage = canopyCoverage(data, scale);
  while (coverage.coreCoverage < CANOPY_COVERAGE.coreMinimum && scale < CANOPY_COVERAGE.maxScale) {
    scale = Math.round((scale+.01)*100)/100; coverage = canopyCoverage(data, scale);
  }
  return { displayScale: scale, runtimeEligible: scale <= CANOPY_COVERAGE.maxScale && coverage.coreCoverage >= CANOPY_COVERAGE.coreMinimum,
    coverage };
}
