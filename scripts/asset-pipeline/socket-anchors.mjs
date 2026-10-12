const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bodySockets = ['mouth', ...Array.from({ length: 6 }, (_, i) => `egg${i + 1}`)];
// The water body also carries the six detachable dorsal spines (base and tip per spine).
const spineSockets = [...Array.from({ length: 6 }, (_, i) => `spine${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `spine${i + 1}Tip`)];
export function requiredSockets(id) {
  return id === 'abyssal-kraken' ? [...bodySockets, ...spineSockets] : id === 'abyssal-kraken-land' ? bodySockets
    : id === 'abyssal-kraken-tentacle' ? ['waterEntry'] : id === 'abyssal-kraken-spine' ? ['base', 'tip'] : [];
}

export function validateSocketFrames(frames, count, required = []) {
  if (!Array.isArray(frames) || frames.length !== count || !frames.length || !object(frames[0])) throw new Error('Socket frame count mismatch');
  const names = Object.keys(frames[0]).sort();
  if (required.some(name => !names.includes(name)) || names.some(name => !name || ['eyeLeft', 'eyeRight'].includes(name))) throw new Error('Missing required sockets or eye sockets in generic output');
  for (const frame of frames) {
    if (!object(frame) || JSON.stringify(Object.keys(frame).sort()) !== JSON.stringify(names)) throw new Error('Socket names differ between frames');
    for (const point of Object.values(frame)) {
      if (!object(point) || Object.keys(point).sort().join(',') !== 'x,y,z'
        || ![point.x, point.y, point.z].every(Number.isFinite) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('Invalid socket point');
    }
  }
}

/** AP0's static view is the separate rest pose, never a clip release position. */
export const restSockets = (frames, idleFrame) => Object.fromEntries(Object.entries(frames[idleFrame]).map(([name, p]) => [name, [p.x, p.y]]));

export function validateSocketManifest(m) {
  const required = requiredSockets(m.id);
  if (m.id === 'abyssal-kraken-egg' && !Number.isInteger(m.clips.find(c => c.name === 'hatch')?.markers?.spawn)) throw new Error('Missing hatch spawn marker');
  if (m.socketFrames === undefined && m.sockets === undefined && !required.length) return;
  validateSocketFrames(m.socketFrames, m.frames.length, required);
  for (const [i, frame] of m.frames.entries()) if (frame.sockets !== undefined
    && JSON.stringify(frame.sockets) !== JSON.stringify(m.socketFrames[i])) throw new Error('Frame sockets differ from socketFrames');
  const rest = restSockets(m.socketFrames, m.idleFrame);
  if (!object(m.sockets) || Object.keys(m.sockets).length !== Object.keys(rest).length
    || Object.entries(rest).some(([name, p]) => JSON.stringify(p) !== JSON.stringify(m.sockets[name]))) throw new Error('Rest sockets differ from idle frame');
  if (required.includes('mouth')) {
    const clip = m.clips.find(c => c.name === 'egg-throw');
    if (!clip || bodySockets.slice(1).some((_, i) => !Number.isInteger(clip.markers?.[`release-${i + 1}`]))) throw new Error('Missing egg socket release-k markers');
  }
}
