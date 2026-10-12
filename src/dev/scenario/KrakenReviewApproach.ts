import type { KrakenEffectLook } from './KrakenReviewEffectTimeline';

type Point = { x: number; y: number };
const radians = Math.PI / 180;
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** The review pond is star-shaped. Trace its actual water contour toward a dry target,
 * then retain a submerged body footprint. No navigation or gameplay authority lives here. */
export function planKrakenApproach(center: Point, target: Point, waterAt: (x: number, y: number) => number,
  look: KrakenEffectLook['approach'], mouthOffset: number, initialDegrees: number) {
  const distance = Math.hypot(target.x - center.x, target.y - center.y);
  if (distance < 1 || waterAt(target.x, target.y) > 0 || waterAt(center.x, center.y) <= 0) throw Error('approach requires a land target and a submerged start');
  const dx = (target.x - center.x) / distance, dy = (target.y - center.y) / distance;
  let boundary = 0;
  while (boundary < distance && waterAt(center.x + dx * boundary, center.y + dy * boundary) > 0) boundary += .5;
  let travel = Math.max(0, boundary - mouthOffset - look.shoreDistance);
  const fits = (d: number) => Array.from({ length: 24 }, (_, i) => i * Math.PI / 12).every(a =>
    waterAt(center.x + dx * d + Math.cos(a) * look.bodyRadius, center.y + dy * d + Math.sin(a) * look.bodyRadius) > 0);
  while (travel > 0 && !fits(travel)) travel = Math.max(0, travel - .5);
  if (!fits(travel)) throw Error('approach body footprint does not fit the pond');
  const angle = Math.atan2(dy, dx), startAngle = initialDegrees * radians;
  const turn = angleDelta(startAngle, angle);
  const swimDuration = travel / look.speed;
  const duration = Math.max(swimDuration, Math.abs(turn) / (look.turnRate * radians));
  return { target, shore: { x: center.x + dx * boundary, y: center.y + dy * boundary }, duration,
    sample(seconds: number) {
      const d = Math.min(travel, Math.max(0, seconds) * look.speed);
      const rotated = Math.sign(turn) * Math.min(Math.abs(turn), Math.max(0, seconds) * look.turnRate * radians);
      return { x: center.x + dx * d, y: center.y + dy * d, angle: startAngle + rotated,
        attacking: seconds >= duration, attackTime: Math.max(0, seconds - duration) };
    } };
}
