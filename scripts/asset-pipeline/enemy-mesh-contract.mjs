/** Enemy-only contract. No dependency on the immutable 37-pose player manifest. */
export const ENEMY_MESH_SCHEMA = 'fd-projected-enemy-mesh';
export const ENEMY_MESH_BUDGET = Object.freeze({ minVertices: 1000, maxVertices: 2000, maxTriangles: 4000 });
export const ENEMY_MESH_VIEWS = Object.freeze([20, 28, 35, 45, 60].flatMap(elevation =>
  Array.from({ length: 16 }, (_, i) => Object.freeze({ azimuth: i * 22.5, elevation }))));
export const ENEMY_LEGS = Object.freeze(['front_left', 'front_right', 'rear_left', 'rear_right']);
export const shaPattern = /^[a-f0-9]{64}$/;

export function relativeMember(value) {
  if (typeof value !== 'string' || !value || /[\\:\0]/.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe enemy bundle member');
  return value;
}

export function enemyCoordinates(render) {
  if (render.category !== 'enemy' || render.forward !== 'north'
    || JSON.stringify(render.pivot) !== '[0.5,0.5]') throw Error('Enemy requires centered north-facing source');
  const canvasWorldPx = render.targetSize * (render.displayScale ?? 1);
  if (![canvasWorldPx, render.orthoScale].every(v => Number.isFinite(v) && v > 0)) throw Error('Enemy scale missing');
  return { axes: 'X-right,Y-south,Z-up', conversion: [1, -1, 1], groundZBlender: 0,
    pivot: [0.5, 0.5], canvasWorldPx, orthoScaleBlender: render.orthoScale,
    worldPxPerBlenderUnit: canvasWorldPx / render.orthoScale,
    heightPolicy: 'evaluated geometry includes attack root Z; never add the jump twice' };
}

export function enemyPoses(render) {
  if (render.frames?.length !== 31 || render.idleFrame !== 0) throw Error('Expected 31 enemy poses');
  const clips = render.clips;
  if (clips?.length !== 2) throw Error('Expected move and claw clips');
  const move = clips.find(c => c.name === 'move'), claw = clips.find(c => c.name === 'claw');
  if (!move?.loop || claw?.loop !== false || move.frames.length !== 12 || claw.frames.length !== 18
    || JSON.stringify(move.frames) !== JSON.stringify(Array.from({ length: 12 }, (_, i) => i + 1))
    || JSON.stringify(claw.frames) !== JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 13))
    || claw.markers?.strike !== 8 || claw.markers?.impact !== 11) throw Error('Unsupported enemy clip mapping');
  return render.frames.map((frame, index) => {
    if (frame.index !== index || !Number.isFinite(frame.blenderFrame) || !shaPattern.test(frame.sha256))
      throw Error('Invalid enemy pose provenance');
    relativeMember(frame.file);
    const clip = clips.find(c => c.frames.includes(index));
    return { index, blenderFrame: frame.blenderFrame, clip: clip?.name ?? 'rest',
      clipFrame: clip?.frames.indexOf(index) ?? 0, sourceBeautySha256: frame.sha256 };
  });
}

/** Quarter samples include the move loop seam, never interpolate between different clips. */
export function enemyReviewSamples(render) {
  const poses = enemyPoses(render), result = poses.map(p => ({ ...p, sampleId: `p${p.index}`, exported: true }));
  for (const clip of render.clips) {
    const frames = clip.frames.map(i => poses[i]);
    for (let i = 0; i < frames.length - (clip.loop ? 0 : 1); i++) {
      const a = frames[i].blenderFrame;
      const b = i + 1 < frames.length ? frames[i + 1].blenderFrame : clip.timelineEnd;
      if (!(b > a)) throw Error('Missing increasing source timeline or loop closure');
      for (const fraction of [0.25, 0.5, 0.75]) result.push({ sampleId: `${clip.name}-${i}+${fraction}`,
        blenderFrame: a + (b - a) * fraction, clip: clip.name, clipFrame: i + fraction, exported: false });
    }
  }
  return result;
}

export function validateEnemyMeshManifest(m) {
  if (m.schema !== ENEMY_MESH_SCHEMA || m.version !== 1 || !/^enemy-mesh-[a-z0-9-]+$/.test(m.revision))
    throw Error('Invalid enemy mesh manifest');
  if (!['diagnostic', 'awaiting-visual-review', 'reviewed-not-imported'].includes(m.status)) throw Error('Invalid enemy mesh status');
  if (m.poses?.length !== 31 || m.poses.some((p, i) => p.index !== i || !Number.isFinite(p.blenderFrame)
    || p.clip !== (i === 0 ? 'rest' : i < 13 ? 'move' : 'claw')
    || p.clipFrame !== (i === 0 ? 0 : i < 13 ? i - 1 : i - 13) || !shaPattern.test(p.sourceBeautySha256)))
    throw Error('Incomplete enemy poses');
  const c = m.coordinates;
  if (c?.axes !== 'X-right,Y-south,Z-up' || JSON.stringify(c.pivot) !== '[0.5,0.5]'
    || ![c.canvasWorldPx, c.orthoScaleBlender, c.worldPxPerBlenderUnit].every(v => Number.isFinite(v) && v > 0)
    || Math.abs(c.worldPxPerBlenderUnit - c.canvasWorldPx / c.orthoScaleBlender) > 1e-9) throw Error('Invalid enemy coordinates');
  const mesh = m.mesh;
  if (mesh?.id !== m.id || !Number.isInteger(mesh.vertexCount) || mesh.vertexCount < 1000 || mesh.vertexCount > 2000
    || !Number.isInteger(mesh.triangleCount) || mesh.triangleCount < 1 || mesh.triangleCount > 4000
    || mesh.encoding !== 'uint16-le-xyz-bounds'
    || JSON.stringify(mesh.poseIndices) !== JSON.stringify(m.poses.map(p => p.index))) throw Error('Enemy topology/budget mismatch');
  if (!mesh.bounds || !['min', 'max'].every(k => Array.isArray(mesh.bounds[k]) && mesh.bounds[k].length === 3
    && mesh.bounds[k].every(Number.isFinite)) || mesh.bounds.min.some((v, i) => v > mesh.bounds.max[i])) throw Error('Enemy bounds invalid');
  for (const part of ['positions', 'indices']) {
    relativeMember(mesh[part]?.file);
    if (!shaPattern.test(mesh[part].sha256)) throw Error('Unbound enemy binary');
  }
  if (mesh.positions.bytes !== 31 * mesh.vertexCount * 6 || mesh.indices.bytes !== mesh.triangleCount * 6
    || mesh.topologySha256 !== mesh.indices.sha256) throw Error('Enemy binary size/topology mismatch');
  if (m.contacts?.length !== 31) throw Error('Missing pose contact anchors');
  const legs = m.contacts[0]?.feet?.length === 2 ? ['left_leg', 'right_leg'] : ENEMY_LEGS;
  for (const [i, contact] of m.contacts.entries()) {
    if (contact.pose !== i || !Array.isArray(contact.feet) || contact.feet.length !== legs.length
      || contact.feet.some((f, j) => f.leg !== legs[j] || !Array.isArray(f.position) || f.position.length !== 3
        || !f.position.every(Number.isFinite) || !Number.isFinite(f.groundWeight) || f.groundWeight < 0 || f.groundWeight > 1))
      throw Error('Invalid enemy ground contact');
  }
  if (!m.sourceFiles || !Object.keys(m.sourceFiles).length) throw Error('Missing enemy provenance');
  for (const [file, hash] of Object.entries(m.sourceFiles)) {
    relativeMember(file); if (!shaPattern.test(hash)) throw Error('Invalid enemy source hash');
  }
  return m;
}

/** Separate decoder keeps malformed buffers out of both the reviewer and future importer. */
export function decodeEnemyMesh(mesh, positionBytes, indexBytes) {
  if (positionBytes.byteLength !== mesh.positions.bytes || indexBytes.byteLength !== mesh.indices.bytes)
    throw Error('Enemy binary byte count mismatch');
  const p = new DataView(positionBytes.buffer, positionBytes.byteOffset, positionBytes.byteLength);
  const i = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
  const positions = new Float32Array(mesh.vertexCount * 31 * 3), indices = new Uint16Array(mesh.triangleCount * 3);
  for (let n = 0; n < positions.length; n++) {
    const axis = n % 3;
    positions[n] = mesh.bounds.min[axis] + p.getUint16(n * 2, true) / 65535 * (mesh.bounds.max[axis] - mesh.bounds.min[axis]);
  }
  for (let n = 0; n < indices.length; n++) {
    const value = i.getUint16(n * 2, true);
    if (value >= mesh.vertexCount) throw Error('Enemy index outside fixed topology');
    indices[n] = value;
  }
  return { positions, indices };
}
