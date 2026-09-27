import type { DevScenarioController } from './controller';
import { defaultScenario, buildScenarioProfile, parseScenario, scenarioMaps } from './config';
import { COOP_DEFENSE_CLASS_IDS } from '../../config/coopDefenseClasses';
import { COOP_DEFENSE_ENEMY_KINDS, type CoopDefenseEnemyKind } from '../../config/coopDefenseEnemies';
import { COOP_DEFENSE_CONSTRUCTION_IDS } from '../../config/coopDefenseConstructions';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS, isCoopDefenseUpgradeAvailableForClass } from '../../utils/coopDefenseUpgrades';
import { getSelectableLoadoutItems, describeLoadoutTool } from '../../loadout/LoadoutCatalog';
import { UTILITY_CONFIGS } from '../../loadout/LoadoutConfig';
import { COOP_DEFENSE_ITEM_SLOTS, COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS } from '../../config/coopDefenseItems';
import { rollCoopDefenseItem } from '../../utils/coopDefenseItems';
import type { CoopDefenseClassId, ConstructionId, CoopDefenseItemSlot, LoadoutToolRef } from '../../types';

/** Semantic DOM is intentional: browser agents can operate every action without canvas coordinates. */
export function createScenarioPanel(controller: DevScenarioController) {
  const root = document.createElement('aside'); root.id = 'dev-scenario-panel'; root.setAttribute('aria-label', 'Dev-Szenario');
  root.innerHTML = `<style>
  #dev-scenario-panel { position:fixed; z-index:10000; right:10px; top:10px; width:350px; max-height:calc(100vh - 20px); overflow:auto; padding:14px; box-sizing:border-box; background:#14202aee; border:1px solid #657583; border-radius:8px; color:#eef3f6; font:13px system-ui,sans-serif }
  #dev-scenario-panel summary { cursor:pointer; font-weight:650; padding:6px 0 }
  #dev-scenario-panel label { display:block; margin:7px 0 }
  #dev-scenario-panel select,#dev-scenario-panel input,#dev-scenario-panel textarea { display:block; width:100%; box-sizing:border-box; background:#0c151e; color:#fff; border:1px solid #697985; padding:5px; border-radius:3px }
  #dev-scenario-panel input[type=checkbox] { display:inline; width:auto; margin-right:8px }
  #dev-scenario-panel button,#dev-scenario-panel a { display:inline-block; padding:6px 8px; margin:3px 3px 3px 0; border:1px solid #7c919f; border-radius:4px; background:#263f51; color:#fff; cursor:pointer }
  #dev-scenario-panel pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; font-size:11px }
  #dev-scenario-panel textarea { height:190px; font:11px ui-monospace,monospace }
  #dev-scenario-panel hr { border:0; border-top:1px solid #41515d } #dev-scenario-panel .hint { color:#bccbd5; font-size:12px }
  #dev-scenario-panel img { max-width:none } #dev-scenario-panel .capture { max-height:70vh; overflow:auto }
  </style><details open id="dev-shell"><summary>Dev-Szenario · isolierter Spielstand</summary><p class="hint">Offline-Host · Änderungen betreffen nur diesen Tab. Steuerung über Grid-Koordinaten (32 px/Zelle).</p><output role="status" id="dev-status"></output><div id="dev-content"></div></details>`;
  document.body.append(root);
  for (const name of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel']) root.addEventListener(name, event => event.stopPropagation());
  const content = root.querySelector<HTMLDivElement>('#dev-content')!;
  const controls: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {};
  const run = (action: () => void) => { try { action(); } catch (error) { controller.fail(error); } refresh(); };
  function section(title: string, open = false): HTMLDetailsElement {
    const element = document.createElement('details'); element.open = open;
    const summary = document.createElement('summary'); summary.textContent = title; element.append(summary); content.append(element); return element;
  }
  function button(parent: HTMLElement, title: string, action: () => void): void {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = title;
    element.onclick = () => run(action); parent.append(element);
  }
  function field(parent: HTMLElement, name: string, key: string, type = 'text'): HTMLInputElement {
    const label = document.createElement('label'); label.append(name);
    const input = document.createElement('input'); input.type = type; input.id = `dev-${key}`; input.name = key;
    label.append(input); parent.append(label); controls[key] = input; return input;
  }
  function select(parent: HTMLElement, name: string, key: string, values: readonly string[]): HTMLSelectElement {
    const label = document.createElement('label'); label.append(name);
    const input = document.createElement('select'); input.id = `dev-${key}`; input.name = key;
    fill(input, values); label.htmlFor = input.id; parent.append(label, input); controls[key] = input; return input;
  }
  function fill(input: HTMLSelectElement, values: readonly string[]): void {
    input.replaceChildren(...values.map(value => new Option(value, value)));
  }
  function hint(parent: HTMLElement, text: string): void { const p = document.createElement('p'); p.className = 'hint'; p.textContent = text; parent.append(p); }
  const setup = section('1 · Map und Ausrüstung', true);
  const map = select(setup, 'Map', 'mapId', scenarioMaps().map(value => value.mapId));
  map.onchange = () => { controller.config.mapId = map.value; syncJson(); };
  const cls = select(setup, 'Klasse', 'classId', COOP_DEFENSE_CLASS_IDS);
  cls.onchange = () => run(() => {
    const previous = controller.config;
    controller.config = { ...defaultScenario(cls.value as CoopDefenseClassId), mapId: previous.mapId, seed: previous.seed };
    sync(); controller.message = 'Klasse geändert: Ausrüstung und Aufbau zurückgesetzt.';
  });
  const seed = field(setup, 'Welt-Seed', 'seed', 'number'); seed.onchange = () => { controller.config.seed = Number(seed.value); syncJson(); };
  for (const slot of ['weapon1', 'weapon2', 'ultimate'] as const) {
    const input = select(setup, slot, slot, []);
    input.onchange = () => { controller.config[slot] = input.value; syncJson(); };
  }
  hint(setup, 'Alle zulässigen Freischaltungen sind verfügbar. Stärke-Upgrades werden explizit gewählt. Änderungen am Setup benötigen einen Neustart.');
  button(setup, 'Szenario starten / neu aufbauen', () => controller.start(controller.config));

  const equipment = section('2 · Werkzeuge, Upgrades und Items');
  const tool = select(equipment, 'Werkzeug hinzufügen', 'tool', [...COOP_DEFENSE_CONSTRUCTION_IDS.map(id => `construction:${id}`), ...Object.keys(UTILITY_CONFIGS).map(id => `utility:${id}`)]);
  const equipped = document.createElement('p'); equipment.append(equipped);
  button(equipment, 'Werkzeug hinzufügen', () => {
    const [kind, id] = tool.value.split(':');
    const tools = [...controller.config.tools, { kind, id } as LoadoutToolRef];
    buildScenarioProfile(controller.config.classId, controller.config.upgrades, tools);
    controller.config.tools = tools; sync();
  });
  button(equipment, 'Werkzeuge leeren', () => { controller.config.tools = []; sync(); });
  const upgrade = select(equipment, 'Upgrade', 'upgrade', []);
  const level = field(equipment, 'Upgrade-Stufe', 'level', 'number'); level.value = '1';
  button(equipment, 'Upgrade setzen', () => {
    const levels = { ...controller.config.upgrades, [upgrade.value]: Number(level.value) };
    buildScenarioProfile(controller.config.classId, levels, controller.config.tools);
    controller.config.upgrades = levels; sync();
  });
  button(equipment, 'Stärke-Upgrades zurücksetzen', () => { controller.config.upgrades = {}; sync(); });
  const itemSlot = select(equipment, 'Item-Slot', 'itemSlot', COOP_DEFENSE_ITEM_SLOTS);
  const itemLevel = field(equipment, 'Item-Level', 'itemLevel', 'number'); itemLevel.value = '20';
  button(equipment, 'Item erzeugen / Slot ersetzen', () => {
    const n = Number(itemLevel.value); if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('Item-Level: 1…100.');
    const item = rollCoopDefenseItem(itemSlot.value as CoopDefenseItemSlot, n, controller.config.classId);
    controller.config.items = [...controller.config.items.filter(value => value.slot !== item.slot), item]; sync();
  });
  button(equipment, 'Items entfernen', () => { controller.config.items = []; sync(); });
  hint(equipment, 'Konkrete Affixe und Werte sind im JSON editierbar. Der Bericht enthält das tatsächlich übernommene Loadout.');

  const actions = section('3 · Ziel, Bewegung und Kampf', true);
  const gx = field(actions, 'Ziel Grid X', 'gridX', 'number'), gy = field(actions, 'Ziel Grid Y', 'gridY', 'number');
  const target = () => { controller.aim = { gridX: Number(gx.value), gridY: Number(gy.value) }; };
  gx.onchange = target; gy.onchange = target;
  button(actions, 'Spielerposition als Ziel', () => { const player = controller.snapshot().player as { x: number; y: number } | null; if (player) { controller.aim = controller.grid(player); syncTarget(); } });
  button(actions, 'Freie Zelle suchen', () => { target(); controller.findFree(); syncTarget(); });
  button(actions, 'Zum Ziel teleportieren', () => { target(); controller.teleport(); syncJson(); });
  const duration = field(actions, 'Bewegung in ms', 'moveMs', 'number'); duration.value = '1000';
  for (const [name, dx, dy] of [['Links', -1, 0], ['Rechts', 1, 0], ['Oben', 0, -1], ['Unten', 0, 1]] as const) button(actions, name, () => controller.move(dx, dy, Number(duration.value)));
  for (const slot of ['weapon1', 'weapon2'] as const) {
    button(actions, `${slot} einmal`, () => { target(); controller.fire(slot, false); });
    button(actions, `${slot} halten`, () => { target(); controller.fire(slot, true); });
  }
  button(actions, 'Utility auslösen', () => { target(); controller.utility(); });
  button(actions, 'Ultimate drücken', () => { target(); controller.ultimate('press'); });
  button(actions, 'Ultimate loslassen', () => { target(); controller.ultimate('release'); });
  button(actions, 'Alle Aktionen stoppen', () => controller.stop());

  const objects = section('4 · Gegner und Bauwerke');
  const enemy = select(objects, 'Gegnerart', 'enemy', COOP_DEFENSE_ENEMY_KINDS);
  const pinned = field(objects, 'Position festhalten (bewegungsfixierter Gegner)', 'pinned', 'checkbox');
  const hp = field(objects, 'Gegner-HP (leer = normale HP)', 'enemyHp', 'number');
  button(objects, 'Gegner am Ziel erzeugen', () => { target(); controller.spawn(enemy.value as CoopDefenseEnemyKind, pinned.checked, hp.value === '' ? null : Number(hp.value)); syncJson(); });
  button(objects, 'Alle Gegner entfernen', () => { controller.clearEnemies(); syncJson(); });
  const construction = select(objects, 'Bauwerk', 'construction', COOP_DEFENSE_CONSTRUCTION_IDS);
  button(objects, 'Bauwerk am Ziel errichten', () => { target(); controller.build(construction.value as ConstructionId); syncJson(); });
  hint(objects, 'Gegner behalten KI und Angriffe; „Position festhalten“ deaktiviert diese nicht. Bauwerke verwenden echte Platzierungs-, Cooldown- und Kapazitätsregeln.');

  const simulation = section('5 · Zeit, Ressourcen und Kamera');
  for (const [key, title] of [['suppressWaves', 'Authored Encounter unterdrücken'], ['refillAdrenaline', 'Adrenalin pro Frame auffüllen'], ['refillHp', 'HP pro Frame auffüllen']] as const) {
    const check = field(simulation, title, key, 'checkbox');
    check.onchange = () => { controller.config[key] = check.checked; syncJson(); controller.saveLink(); };
  }
  const time = field(simulation, 'Tagesminute (0…1439)', 'timeOfDay', 'number');
  button(simulation, 'Tageszeit setzen', () => { const value = Number(time.value); if (!Number.isFinite(value) || value < 0 || value > 1439) throw new Error('Tagesminute: 0…1439.'); controller.config.timeOfDay = value; controller.saveLink(); syncJson(); });
  const speed = select(simulation, 'Simulationsgeschwindigkeit', 'speed', ['0.1', '0.25', '0.5', '1', '2']); speed.value = '1';
  speed.onchange = () => { controller.clock.speed = Number(speed.value); };
  button(simulation, 'Pause', () => controller.pause());
  button(simulation, 'Weiter', () => controller.resume());
  button(simulation, '1 Frame', () => controller.step());
  button(simulation, '10 Frames', () => controller.step(10));
  const zoom = select(simulation, 'Kamera-Zoom', 'zoom', ['0.5', '1', '1.5', '2', '3', '4']); zoom.value = '1';
  zoom.onchange = () => { controller.zoom = Number(zoom.value); };
  const focus = field(simulation, 'Kamera am Ziel statt am Spieler', 'focus', 'checkbox'); focus.onchange = () => { controller.cameraAtTarget = focus.checked; };
  hint(simulation, 'Pause hält Spielschleife und Gameplay-Uhr an. Worker und Browser-Timer bleiben asynchron. HP-Auffüllen schützt nicht vor tödlichem Einzeltreffer.');

  const exchange = section('6 · Szenario-JSON, Link und Bericht');
  const label = document.createElement('label'); label.textContent = 'Szenario JSON';
  const json = document.createElement('textarea'); json.id = 'dev-json'; label.append(json); exchange.append(label);
  const syncJson = () => { json.value = JSON.stringify(controller.config, null, 2); };
  button(exchange, 'JSON prüfen und übernehmen', () => { controller.config = parseScenario(JSON.parse(json.value)); sync(); controller.message = 'Konfiguration geprüft. Zum Anwenden Szenario starten.'; });
  button(exchange, 'Szenario-Link aktualisieren', () => { parseScenario(controller.config); controller.saveLink(); link.value = location.href; });
  const link = field(exchange, 'Szenario-Link (Reload stellt Aufbau wieder her)', 'link'); link.readOnly = true;
  function download(name: string, data: unknown): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  button(exchange, 'Szenario JSON herunterladen', () => download('dev-scenario.json', controller.config));
  button(exchange, 'Bericht herunterladen', () => download('dev-scenario-report.json', controller.snapshot()));
  button(exchange, 'Katalog herunterladen', () => download('dev-scenario-catalog.json', { upgrades: COOP_DEFENSE_UPGRADE_DEFINITIONS, affixes: COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS, enemies: COOP_DEFENSE_ENEMY_KINDS, constructions: COOP_DEFENSE_CONSTRUCTION_IDS }));
  const report = document.createElement('pre'); report.id = 'dev-report'; report.setAttribute('aria-label', 'Szenario-Zustand'); exchange.append(report);
  button(exchange, 'Bericht anzeigen', () => { report.textContent = JSON.stringify(controller.snapshot(), null, 2); });

  const captures = section('7 · Screenshot in Originalauflösung');
  const capture = document.createElement('div'); capture.className = 'capture';
  const savedCapture = document.createElement('output'); savedCapture.id = 'dev-capture-path';
  button(captures, 'PNG im Workspace speichern', () => controller.capture(url => {
    void (async () => {
      const png = await (await fetch(url)).blob();
      const response = await fetch('/__dev-scenario-capture', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'PNG konnte nicht gespeichert werden.');
      savedCapture.textContent = result.path;
    })().catch(error => { controller.fail(error); refresh(); });
  }));
  captures.append(savedCapture);
  button(captures, 'PNG aufnehmen', () => controller.capture(url => {
    capture.replaceChildren(); const a = document.createElement('a'); a.href = url; a.download = 'dev-scenario.png'; a.textContent = 'PNG herunterladen';
    const image = document.createElement('img'); image.src = url; image.alt = 'Szenario-Aufnahme in Originalauflösung'; capture.append(a, image);
  }));
  hint(captures, 'Die Vorschau ist scrollbar und zeigt jeden Bildpixel. Bei Pause rendert die Aufnahme genau einen zusätzlichen Simulationsframe.'); captures.append(capture);

  function syncTarget(): void { gx.value = String(controller.aim.gridX); gy.value = String(controller.aim.gridY); }
  function sync(): void {
    const config = controller.config; map.value = config.mapId; cls.value = config.classId; seed.value = String(config.seed);
    const profile = buildScenarioProfile(config.classId, config.upgrades, config.tools);
    for (const slot of ['weapon1', 'weapon2', 'ultimate'] as const) {
      fill(controls[slot] as HTMLSelectElement, getSelectableLoadoutItems(slot, 'coop_defense', profile, config.classId).map(item => item.id)); controls[slot].value = config[slot];
    }
    fill(upgrade, Object.keys(COOP_DEFENSE_UPGRADE_DEFINITIONS).filter(id => isCoopDefenseUpgradeAvailableForClass(id, config.classId)));
    equipped.textContent = config.tools.map(tool => describeLoadoutTool(tool).displayName).join(', ') || 'Keine Werkzeuge';
    for (const key of ['suppressWaves', 'refillAdrenaline', 'refillHp'] as const) (controls[key] as HTMLInputElement).checked = config[key];
    time.value = String(config.timeOfDay); syncJson(); syncTarget(); link.value = location.href;
  }
  function refresh(): void {
    root.querySelector('#dev-status')!.textContent = `${controller.state} · ${controller.clock.paused ? 'PAUSE' : `${controller.clock.speed}×`} · ${controller.message}`;
    link.value = location.href;
  }
  sync(); refresh();
  return { sync, syncTarget, refresh, destroy: () => root.remove() };
}
