// Edit decision list: trailer time T (s) at 60 fps; clip frame ranges [in, out).
export const FPS = 60;
const GRADE = 'eq=contrast=1.07:saturation=1.2:gamma=0.97';
export const EDL = [
  { clip: 'cold_open', in: 0, out: 510, grade: 'eq=contrast=1.05:saturation=1.12:gamma=1.16:brightness=0.01' },
  { clip: 'rocket_drop', in: 2, out: 122 },
  { clip: 'negev', in: 40, out: 160 },
  { clip: 'turrets', in: 20, out: 140 },
  { clip: 'tesla', in: 40, out: 160 },
  { clip: 'boss', in: 100, out: 220 },
  { clip: 'holy', in: 21, out: 141 },
  { clip: 'shotgun', in: 35, out: 65 },
  { clip: 'flamer', in: 70, out: 100 },
  { clip: 'hydra', in: 50, out: 80 },
  { clip: 'shotgun', in: 78, out: 108 },
  { clip: 'armageddon', in: 70, out: 190 },
  { clip: 'airstrike', in: 29, out: 149 },
  { clip: 'mass_horde', in: 150, out: 300 },
  { clip: 'nuke', in: 5, out: 35 },
  { clip: 'nuke', in: 137, out: 317 },
].map(e => ({ grade: GRADE, ...e }));
// Title: native 4K lobby capture, digitally pushed in post.
export const TITLE = { clip: 'lobby_title_4k', in: 30, out: 450 };

let t = 0;
for (const e of EDL) { e.at = t; t += (e.out - e.in) / FPS; }
TITLE.at = t;
export const TOTAL = t + (TITLE.out - TITLE.in) / FPS;
