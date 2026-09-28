// Trailer 2 edit decision list (60 fps). Clip frame ranges are [in, out).
export const FPS = 60;
const DAY = 'eq=contrast=1.07:saturation=1.18:gamma=0.98';
const DOC_DAY = 'eq=contrast=1.06:saturation=1.12:gamma=1.12:brightness=0.015';
const DOC_NIGHT = 'eq=contrast=1.05:saturation=1.1:gamma=1.28:brightness=0.01';
const NIGHT = 'eq=contrast=1.06:saturation=1.15:gamma=1.14';
export const EDL = [
  // ── Documentary ──
  { clip: 'd1_establish', in: 30, out: 186, grade: DOC_DAY },
  { clip: 'd2_portrait', in: 60, out: 282, grade: DOC_DAY },
  { clip: 'd3_sparring2', in: 0, out: 276, grade: DOC_DAY },
  { clip: 'd3_sparring2', in: 300, out: 456, grade: 'eq=contrast=1.06:saturation=1.12:gamma=1.2' },
  { clip: 'd5_burrow_train2', in: 0, out: 264, grade: 'eq=contrast=1.06:saturation=1.08:gamma=1.22' },
  { clip: 'd6_night', in: 48, out: 300, grade: DOC_NIGHT },
  { clip: 'd7_bfg2', in: 0, out: 700, grade: DOC_NIGHT },
  { clip: 'd9_horde_h', in: 40, out: 294, grade: DOC_NIGHT },
  // ── Action: day ── (drop at 38.0 s)
  { clip: 'a1_minirocket2', in: 30, out: 150 },
  { clip: 'a2_plasmaburner2', in: 60, out: 180 },
  { clip: 'a5_drones3', in: 40, out: 160 },
  { clip: 'a3_leafblower_h', in: 60, out: 100 },
  { clip: 'a4_timebubble_h', in: 80, out: 120 },
  { clip: 'a6_p90_h', in: 60, out: 100 },
  // ── Action: night ── (46.0 s)
  { clip: 'n5_plasma2_h', in: 60, out: 180, grade: NIGHT },
  { clip: 'n2_flamer4', in: 40, out: 130, grade: NIGHT },
  { clip: 'n3_holy3', in: 5, out: 275, grade: NIGHT },
  { clip: 'n4_nuke3', in: 45, out: 405, grade: NIGHT },
].map(e => ({ grade: DAY, ...e }));
export const END_CARD = 8.0;

let t = 0;
for (const e of EDL) { e.at = t; t += (e.out - e.in) / FPS; }
export const END_AT = t;
export const TOTAL = t + END_CARD;
