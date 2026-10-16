/** Shared offline validation for both newly authored and migrated runtime metadata. */
const MAX_EXTRA_EYES = 6;

function validEye(eye) {
  return eye && ['x', 'y', 'width', 'height', 'rotation'].every(key => Number.isFinite(eye[key]))
    && eye.x > 0 && eye.x < 1 && eye.y > 0 && eye.y < 1
    && eye.width > 0 && eye.width < .25 && eye.height > 0 && eye.height < .25;
}

/**
 * Every frame has the main `left`/`right` pair. Further eyes (the four-eyed kraken brood) follow
 * as optional `extra` = [left 1, right 1, left 2, right 2, ...]: complete pairs, the same count in every frame.
 */
export function validateEyeAnchors(anchors, frameCount, asset, expectedBlendSha256) {
  if (!anchors || anchors.version !== 1 || !Array.isArray(anchors.frames) || anchors.frames.length !== frameCount) {
    throw new Error('Missing or incomplete eye anchor frames');
  }
  const extraCount = anchors.frames[0]?.extra?.length ?? 0;
  for (const frame of anchors.frames) {
    for (const side of ['left', 'right']) if (!validEye(frame?.[side])) throw new Error('Invalid normalized eye ellipse');
    if (frame.extra === undefined ? extraCount !== 0
        : !Array.isArray(frame.extra) || frame.extra.length !== extraCount || extraCount < 2 || extraCount % 2
          || extraCount > MAX_EXTRA_EYES) {
      throw new Error('Extra eyes must be complete left/right pairs with the same count in every frame');
    }
    if (frame.extra?.some(eye => !validEye(eye))) throw new Error('Invalid normalized eye ellipse');
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
