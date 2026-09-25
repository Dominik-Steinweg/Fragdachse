/** Shared offline validation for both newly authored and migrated runtime metadata. */
export function validateEyeAnchors(anchors, frameCount, asset, expectedBlendSha256) {
  if (!anchors || anchors.version !== 1 || !Array.isArray(anchors.frames) || anchors.frames.length !== frameCount) {
    throw new Error('Missing or incomplete eye anchor frames');
  }
  for (const frame of anchors.frames) for (const side of ['left', 'right']) {
    const eye = frame?.[side];
    if (!eye || !['x', 'y', 'width', 'height', 'rotation'].every(key => Number.isFinite(eye[key]))
        || eye.x <= 0 || eye.x >= 1 || eye.y <= 0 || eye.y >= 1
        || eye.width <= 0 || eye.width >= .25 || eye.height <= 0 || eye.height >= .25) {
      throw new Error('Invalid normalized eye ellipse');
    }
  }
  if (asset) {
    const source = anchors.source;
    if (!source || source.revision !== asset.revision || source.variant !== asset.variant
        || source.sheetSha256 !== asset.hashes.sheet || source.idleSha256 !== asset.hashes.idle
        || !/^[a-f0-9]{64}$/.test(source.blendSha256)
        || (expectedBlendSha256 !== undefined && source.blendSha256 !== expectedBlendSha256)) {
      throw new Error('Eye anchors belong to a different asset revision');
    }
  }
  return anchors;
}
