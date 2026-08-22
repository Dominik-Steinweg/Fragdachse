import * as Phaser from 'phaser';

/**
 * Ein gemeinsamer Atem-Treiber je Szene fuer den pulsierenden Glow bzw. die Aura der lebendigen
 * Balken.
 *
 * Vorher trug jede `LivingBarEffect`-Instanz einen eigenen endlosen Tween
 * (`yoyo`, `repeat: -1`, 2000 ms). Im Upgrade-Overlay liefen davon bis zu zwanzig gleichzeitig,
 * obwohl alle dieselbe Sinuskurve beschreiben. Hier ersetzt eine Schleife alle Tweens; die Phase
 * je Ziel haelt den Versatz, den die unabhaengig gestarteten Tweens vorher zufaellig hatten.
 */

const PERIOD_MS = 2000;

interface BreathTarget {
  readonly target: Record<string, number>;
  readonly property: string;
  readonly from: number;
  readonly to: number;
  readonly phase: number;
}

const drivers = new WeakMap<Phaser.Scene, LivingBreathDriver>();

export class LivingBreathDriver {
  private readonly targets = new Map<object, BreathTarget>();
  private elapsedMs = 0;
  private readonly onUpdate: (time: number, delta: number) => void;
  private readonly onShutdown: () => void;

  private constructor(private readonly scene: Phaser.Scene) {
    this.onUpdate = (_time: number, delta: number) => this.update(delta);
    this.onShutdown = () => this.destroy();
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown);
  }

  static get(scene: Phaser.Scene): LivingBreathDriver {
    let driver = drivers.get(scene);
    if (!driver) {
      driver = new LivingBreathDriver(scene);
      drivers.set(scene, driver);
    }
    return driver;
  }

  /**
   * Meldet ein Ziel an. `from`/`to` entsprechen den Endpunkten des frueheren Tweens; die Kurve ist
   * dieselbe Sinus-Ein-Aus-Bewegung.
   */
  register(target: object, property: string, from: number, to: number): void {
    this.targets.set(target, {
      target: target as Record<string, number>,
      property,
      from,
      to,
      // Ohne Versatz pulsten alle Balken eines Bildschirms im Gleichtakt. Der Zaehler haelt den
      // Versatz stabil, solange dasselbe Ziel angemeldet bleibt.
      phase: (this.targets.size * 0.37) % 1,
    });
    this.apply(this.targets.get(target)!);
  }

  unregister(target: object): void {
    this.targets.delete(target);
  }

  private update(deltaMs: number): void {
    if (this.targets.size === 0) return;
    this.elapsedMs += deltaMs;
    for (const entry of this.targets.values()) this.apply(entry);
  }

  private apply(entry: BreathTarget): void {
    const t = ((this.elapsedMs / PERIOD_MS) + entry.phase) % 1;
    // `yoyo` mit `Sine.easeInOut` ist ueber eine volle Periode exakt eine gehobene Kosinuswelle.
    const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    entry.target[entry.property] = entry.from + (entry.to - entry.from) * wave;
  }

  private destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown);
    this.targets.clear();
    drivers.delete(this.scene);
  }
}
