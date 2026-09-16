import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import { fireflyGlowStrength, snakeTongueExtension, writeFishMemberPose, writeSnakeBodyPose } from './AmbientWildlifeAppearance';
import type { WildlifeAnimal } from './AmbientWildlifeModel';

/** Wildlife-local retained mesh. Topology, ellipse samples and line thickness are built once. */
export class WildlifeMesh {
  xy: number[] = [];
  channels: number[] = [];
  rgb: number[] = [];
  readonly alpha: number[] = [];
  opacityPower: number[] = [];
  indices: number[] = [];
  // Each channel is a local translation and scale, reused at every animation sample.
  readonly poses: { x: number; y: number; sx: number; sy: number }[] = [];
  private channel = 0;
  private color = 0;
  private fillAlpha = 1;
  private power = 0;

  /** Palette/size twins share immutable geometry, but never mutable animation channels. */
  shareGeometry(source: WildlifeMesh): void {
    this.xy = source.xy; this.channels = source.channels; this.rgb = source.rgb;
    this.opacityPower = source.opacityPower; this.indices = source.indices;
  }

  pose(x = 0, y = 0, sx = 1, sy = 1): number {
    this.channel = this.poses.length;
    this.poses.push({ x, y, sx, sy });
    return this.channel;
  }

  use(channel: number): void { this.channel = channel; }
  fill(color: number, alpha: number, opacityPower = 0): void {
    this.color = color; this.fillAlpha = alpha; this.power = opacityPower;
  }

  vertex(x: number, y: number, channel = this.channel): number {
    const index = this.channels.length;
    this.xy.push(x, y); this.channels.push(channel);
    this.rgb.push(this.color); this.alpha.push(this.fillAlpha); this.opacityPower.push(this.power);
    return index;
  }

  ellipse(x: number, y: number, width: number, height: number, count: number): void {
    const base = this.channels.length;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      this.vertex(x + Math.cos(angle) * width / 2, y + Math.sin(angle) * height / 2);
    }
    for (let i = 1; i < count - 1; i++) this.indices.push(base, base + i, base + i + 1);
  }

  triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
    endChannel = this.channel): void {
    this.indices.push(this.vertex(x0, y0), this.vertex(x1, y1, endChannel), this.vertex(x2, y2, endChannel));
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number,
    startChannel = this.channel, endChannel = startChannel): void {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const dx = (y1 - y0) * width / (2 * length), dy = (x0 - x1) * width / (2 * length);
    const a = this.vertex(x0 + dx, y0 + dy, startChannel);
    const b = this.vertex(x0 - dx, y0 - dy, startChannel);
    const c = this.vertex(x1 - dx, y1 - dy, endChannel);
    const d = this.vertex(x1 + dx, y1 + dy, endChannel);
    this.indices.push(a, b, c, c, d, a);
  }
}

export interface WildlifeVisual {
  readonly animal: WildlifeAnimal;
  readonly mesh: WildlifeMesh;
  sample(time: number): void;
}

function butterflyVisual(animal: WildlifeAnimal): WildlifeVisual {
  const mesh = new WildlifeMesh();
  mesh.pose();
  mesh.fill(0x24372a, .17); mesh.ellipse(-1, 2, 3.4, 1.6, 8);
  const wings = mesh.pose();
  const moth = animal.kind === 'moth';
  const colors = moth ? TUNING.mothColors : TUNING.butterflyColors;
  const size = animal.appearance.length / TUNING.butterfly.size;
  const width = TUNING.butterfly.size * .48;
  for (let side = -1; side <= 1; side += 2) {
    mesh.fill(0x555047, .7); mesh.ellipse(.5, side * width * .52, 3.5, width, 8);
    mesh.fill(colors[animal.appearance.colorIndex], .95);
    mesh.ellipse(.65, side * width * .55, 2.9, width * .8, 8);
    mesh.ellipse(-1.2, side * width * .43, 1.9, width * .72, 8);
    mesh.fill(moth ? 0xc1b7a2 : 0xfff5d9, moth ? .3 : .62);
    mesh.ellipse(1, side * width * .7, .8, width * .25, 6);
    if (moth) {
      mesh.fill(0x5e574d, .5); mesh.ellipse(.15, side * width * .62, .6, width * .3, 6);
    }
  }
  const body = mesh.pose();
  mesh.fill(0x454139, .95); mesh.line(-1.6, 0, 1.8, 0, .55);
  for (let i = 0; i < mesh.xy.length; i++) mesh.xy[i] *= size;
  mesh.opacityPower.fill(1);
  return { animal, mesh, sample: () => {
    mesh.poses[wings].sy = .28 + .72 * (.5 - .5 * Math.cos(animal.animation * 2));
    mesh.poses[wings].y = mesh.poses[body].y = Math.sin(animal.animation * .19) * .75;
  } };
}

function fireflyVisual(animal: WildlifeAnimal): WildlifeVisual {
  const mesh = new WildlifeMesh();
  mesh.pose();
  // A soft visible halo supplements the ground illumination in the shared lightmap.
  const haloEnd = 6;
  for (let i = 0; i < haloEnd; i++) {
    const radius = TUNING.fireflyGlowRadius * (1 - i / (haloEnd + 1));
    mesh.fill(0xb9e641, .022 + i * .006, 1);
    mesh.ellipse(-.7, 0, radius * 2, radius * 2, 16);
  }
  const haloVertices = mesh.alpha.length;
  const wings = mesh.pose();
  mesh.fill(0xb8bf94, .32, 1);
  mesh.ellipse(.2, -.7, 2, .9, 8); mesh.ellipse(.2, .7, 2, .9, 8);
  mesh.pose();
  mesh.fill(0x525b35, .9, 1); mesh.ellipse(.2, 0, animal.appearance.length, .9, 10);
  mesh.fill(0xc8ed43, .95, 1); mesh.ellipse(-.7, 0, 1.5, 1.2, 10);
  mesh.fill(0xdff569, 1, 1); mesh.ellipse(-.8, 0, .7, .65, 8);
  const baseAlpha = mesh.alpha.slice(0, haloVertices);
  return { animal, mesh, sample: time => {
    const pulse = fireflyGlowStrength(time, animal.variation, animal.phaseOffset);
    for (let i = 0; i < haloVertices; i++) mesh.alpha[i] = baseAlpha[i] * pulse;
    mesh.poses[wings].sy = .4 + .6 * Math.abs(Math.sin(animal.animation));
  } };
}

function snakeVisual(animal: WildlifeAnimal): WildlifeVisual {
  const mesh = new WildlifeMesh(), tuning = TUNING.snakeVisual;
  const colors = TUNING.snakeColors[animal.appearance.colorIndex];
  const segments = tuning.segments;
  const waveT: number[] = [], widths: number[] = [];
  const pose = { x: 0, y: 0, halfWidth: 0 };
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    writeSnakeBodyPose(animal.appearance, 0, t, pose);
    waveT.push(t); widths.push(pose.halfWidth); mesh.pose();
  }
  // The ribbon is monotone along x: fixed adjacent cross-sections tile it at every phase.
  // The tail has one tip; every other cross-section has an upper and lower vertex.
  const ribbon = (upper: number, lower: number, shadowX = 0, shadowY = 0): void => {
    const top: number[] = [], bottom: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const x = -i / segments * animal.appearance.length + shadowX;
      top.push(mesh.vertex(x, upper * widths[i] + shadowY, i));
      if (i < segments) bottom.push(mesh.vertex(x, lower * widths[i] + shadowY, i));
    }
    for (let i = 0; i < segments - 1; i++) {
      mesh.indices.push(top[i], top[i + 1], bottom[i + 1], top[i], bottom[i + 1], bottom[i]);
    }
    mesh.indices.push(top[segments - 1], top[segments], bottom[segments - 1]);
  };
  mesh.fill(0x20271d, .25); ribbon(1, -1, .5, .65);
  mesh.fill(colors.body, .98); ribbon(1, -1);
  mesh.fill(colors.highlight, .3); ribbon(.15, -.35);
  for (let i = 1; i < 11; i++) {
    const t = i / 12;
    writeSnakeBodyPose(animal.appearance, 0, t, pose);
    waveT.push(t); mesh.pose();
    mesh.fill(colors.pattern, .55);
    mesh.ellipse(pose.x, pose.halfWidth * .35, .85, pose.halfWidth * .7, 8);
  }
  const headScale = tuning.scale, widthScale = animal.appearance.widthScale;
  const root = 1.45, tip = root + tuning.tongueLength, fork = tip - .65;
  const tongueStart = mesh.pose(0, 0, headScale, widthScale);
  const tongueFork = mesh.pose(0, 0, headScale, widthScale);
  const tongueTop = mesh.pose(0, 0, headScale, widthScale);
  const tongueBottom = mesh.pose(0, 0, headScale, widthScale);
  mesh.fill(tuning.tongueColor, .95);
  const tongueVertexStart = mesh.channels.length;
  mesh.line(root, 0, fork, 0, tuning.tongueWidth, tongueStart, tongueFork);
  mesh.line(fork, 0, tip, -.36, tuning.tongueWidth, tongueFork, tongueTop);
  mesh.line(fork, 0, tip, .36, tuning.tongueWidth, tongueFork, tongueBottom);
  const tongueVertexEnd = mesh.channels.length;
  mesh.pose(0, 0, headScale, widthScale);
  mesh.fill(colors.head, 1); mesh.ellipse(.15, 0, 2.8, 1.65, 16);
  mesh.fill(colors.highlight, .3); mesh.ellipse(.3, -.15, 1.8, .65, 12);
  mesh.fill(0x20291c, .95);
  mesh.ellipse(.85, -.57, .35, .33, 8); mesh.ellipse(.85, .57, .35, .33, 8);
  const amplitudes = waveT.map(t => Math.sin(t * Math.PI * .8) * tuning.waveAmplitude * widthScale);
  return { animal, mesh, sample: time => {
    for (let i = 0; i < waveT.length; i++) {
      mesh.poses[i].y = Math.sin(animal.animation - waveT[i] * tuning.waveLength) * amplitudes[i];
    }
    const extension = snakeTongueExtension(time, animal.variation);
    mesh.poses[tongueFork].x = (fork - root) * (extension - 1) * headScale;
    mesh.poses[tongueTop].x = mesh.poses[tongueBottom].x = (tip - root) * (extension - 1) * headScale;
    mesh.poses[tongueTop].y = -.36 * (extension - 1) * widthScale;
    mesh.poses[tongueBottom].y = .36 * (extension - 1) * widthScale;
    for (let i = tongueVertexStart; i < tongueVertexEnd; i++) mesh.alpha[i] = extension > 0 ? .95 : 0;
  } };
}

function fishVisual(animal: WildlifeAnimal): WildlifeVisual {
  const mesh = new WildlifeMesh(), appearance = animal.appearance;
  const colors = TUNING.fishColors[appearance.colorIndex];
  const pose = { x: 0, y: 0, length: 0 };
  for (let i = 0; i < appearance.count; i++) {
    writeFishMemberPose(appearance, 0, animal.variation, i, pose);
    const body = mesh.pose(0, 0, TUNING.visualScale, TUNING.visualScale * appearance.widthScale);
    const tail = mesh.pose(0, 0, TUNING.visualScale, TUNING.visualScale * appearance.widthScale);
    mesh.use(body);
    mesh.fill(colors.body, .72, 1); mesh.ellipse(0, 0, pose.length * .72, 1.3, 8);
    mesh.triangle(-pose.length * .22, 0, -pose.length * .62, -.8, -pose.length * .62, .8, tail);
    mesh.fill(colors.back, .55, 2); mesh.line(-pose.length * .15, -.3, pose.length * .25, -.3, .4);
  }
  return { animal, mesh, sample: () => {
    for (let i = 0; i < appearance.count; i++) {
      writeFishMemberPose(appearance, animal.animation, animal.variation, i, pose);
      const body = mesh.poses[i * 2], tail = mesh.poses[i * 2 + 1];
      body.x = tail.x = pose.x; body.y = pose.y;
      tail.y = pose.y + Math.sin(animal.animation + i * .8) * .7 * tail.sy;
    }
  } };
}

/** Called during ArenaBuilder's covered World construction, never on visibility changes. */
export function prepareWildlifeVisual(animal: WildlifeAnimal): WildlifeVisual {
  return animal.kind === 'butterfly' || animal.kind === 'moth' ? butterflyVisual(animal)
    : animal.kind === 'firefly' ? fireflyVisual(animal)
    : animal.kind === 'snake' ? snakeVisual(animal) : fishVisual(animal);
}

/** Small construction-local cache: insect palettes and the authored snake sizes/palettes.
 * Fish have individual lengths and formation seeds; their meshes are still retained, not cached.
 */
export function prepareWildlifeVisuals(animals: readonly WildlifeAnimal[]): WildlifeVisual[] {
  const templates = new Map<string, WildlifeMesh>();
  return animals.map(animal => {
    const visual = prepareWildlifeVisual(animal);
    if (animal.kind !== 'fish') {
      const a = animal.appearance, key = `${animal.kind}:${a.colorIndex}:${a.length}:${a.widthScale}`;
      const template = templates.get(key);
      if (template) visual.mesh.shareGeometry(template);
      else templates.set(key, visual.mesh);
    }
    return visual;
  });
}
