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
  { clip: 'd3_sparring', in: 0, out: 276, grade: DOC_DAY },
  { clip: 'd3_sparring', in: 300, out: 456, grade: 'eq=contrast=1.06:saturation=1.12:gamma=1.2' },
  { clip: 'd5_burrow_train', in: 0, out: 264, grade: 'eq=contrast=1.06:saturation=1.08:gamma=1.22' },
  { clip: 'd6_night', in: 48, out: 300, grade: DOC_NIGHT },
  { clip: 'd7_bfg2', in: 0, out: 700, grade: DOC_NIGHT, sfxGain: 1 },
  { clip: 'd9_horde', in: 40, out: 294, grade: DOC_NIGHT },
  // ── Action: day ── (drop at 38.0 s)
  { clip: 'a1_minirocket', in: 20, out: 140 },
  { clip: 'a2_plasmaburner', in: 30, out: 150 },
  { clip: 'a3_leafblower', in: 40, out: 160 },
  { clip: 'a4_timebubble', in: 40, out: 160 },
  { clip: 'a5_drones', in: 40, out: 280 },
  { clip: 'a6_p90', in: 20, out: 140 },
  { clip: 'a1_minirocket', in: 140, out: 200 },
  { clip: 'a2_plasmaburner', in: 140, out: 200 },
  { clip: 'a4_timebubble', in: 160, out: 240 },
  { clip: 'a6_p90', in: 140, out: 180 },
  // ── Action: night ── (56.0 s)
  { clip: 'n1_plasma', in: 30, out: 150, grade: NIGHT },
  { clip: 'n2_flamer2', in: 40, out: 220, grade: NIGHT },
  { clip: 'n5_plasma2', in: 40, out: 70, grade: NIGHT },
  { clip: 'n3_holy2', in: 0, out: 210, grade: NIGHT },
  { clip: 'n6_flamer3', in: 40, out: 160, grade: NIGHT },
  { clip: 'n5_plasma2', in: 80, out: 200, grade: NIGHT },
  { clip: 'n1_plasma', in: 150, out: 180, grade: NIGHT },
  { clip: 'n6_flamer3', in: 160, out: 190, grade: NIGHT },
  { clip: 'n5_plasma2', in: 170, out: 200, grade: NIGHT },
  { clip: 'n2_flamer2', in: 10, out: 55, grade: NIGHT },
  { clip: 'n4_nuke2', in: 0, out: 405, grade: NIGHT },
].map(e => ({ grade: DAY, ...e }));
export const END_CARD = 8.0;

let t = 0;
for (const e of EDL) { e.at = t; t += (e.out - e.in) / FPS; }
export const END_AT = t;
export const TOTAL = t + END_CARD;
