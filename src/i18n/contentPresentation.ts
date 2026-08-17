import type { Locale } from './types';

export interface LocalizedText {
  readonly de: string;
  readonly en: string;
}

const LOADOUT_NAMES: Readonly<Record<string, LocalizedText>> = Object.freeze({
  GLOCK: { de: 'Glock', en: 'Glock' },
  ASMD_PRIM: { de: 'ASMD Primär', en: 'ASMD Primary' },
  BITE: { de: 'Dachsbiss', en: 'Badger Bite' },
  PLASMA: { de: 'Plasma Gun', en: 'Plasma Gun' },
  HYDRA: { de: 'Hydra Gun', en: 'Hydra Gun' },
  XBOW: { de: 'XXX-BOW', en: 'XXX-BOW' },
  LEAF_BLOWER: { de: 'Laubbläser', en: 'Leaf Blower' },
  PLASMA_BURNER: { de: 'Plasmabrenner', en: 'Plasma Burner' },
  OVERCHARGE_CORE: { de: 'Verstärkungsmatrix', en: 'Reinforcement Matrix' },
  ENERGY_INJECTOR: { de: 'Energieinjektor', en: 'Energy Injector' },
  P90: { de: 'P90', en: 'P90' },
  AK47: { de: 'AK-47', en: 'AK-47' },
  SHOTGUN: { de: 'Schrotflinte', en: 'Shotgun' },
  AWP: { de: 'AWP', en: 'AWP' },
  NEGEV: { de: 'Negev', en: 'Negev' },
  ROCKET_LAUNCHER: { de: 'Raketenwerfer', en: 'Rocket Launcher' },
  MINI_ROCKET_LAUNCHER: { de: 'Mini-Raketen', en: 'Mini Rockets' },
  FLAMETHROWER: { de: 'Flammenwerfer', en: 'Flamethrower' },
  TESLA_DOME: { de: 'Tesla-Kuppel', en: 'Tesla Dome' },
  MINI_TESLA_DOME: { de: 'Mini-Kuppel', en: 'Mini Dome' },
  ENERGY_SHIELD: { de: 'Energie-Schild', en: 'Energy Shield' },
  HE_GRENADE: { de: 'HE-Granate', en: 'HE Grenade' },
  SMOKE_GRENADE: { de: 'Smoke-Granate', en: 'Smoke Grenade' },
  MOLOTOV_GRENADE: { de: 'Molotowcocktail', en: 'Molotov' },
  HOLY_HAND_GRENADE: { de: 'Heilige Handgranate', en: 'Holy Hand Grenade' },
  TIME_BUBBLE: { de: 'Zeitblase', en: 'Time Bubble' },
  BFG: { de: 'BFG', en: 'BFG' },
  NUKE: { de: 'Atombombe', en: 'Nuke' },
  STINK_CLOUD: { de: 'Stinkwolke', en: 'Stink Cloud' },
  TRANSLOCATOR: { de: 'Translocator', en: 'Translocator' },
  ZEUS_TASER: { de: 'Zeus', en: 'Zeus' },
  DECOY: { de: 'Decoy', en: 'Decoy' },
  ROCK_BARRIER: { de: 'Felsbarriere', en: 'Rock Barrier' },
  SPORE_TURRET: { de: 'Sporenturm', en: 'Spore Turret' },
  ARMAGEDDON: { de: 'Armageddon', en: 'Armageddon' },
  GAUSS_RIFLE: { de: 'Gauss-Gewehr', en: 'Gauss Rifle' },
  VOID_HUNTER_GAUSS: { de: 'Leeren-Gauss', en: 'Void Gauss' },
  AIRSTRIKE: { de: 'Luftangriff', en: 'Airstrike' },
  HONEY_BADGER_RAGE: { de: 'Honigdachs-Wut', en: 'Honey Badger Rage' },
  DACHS_TUNNEL: { de: 'Dachstunnel', en: 'Badger Tunnel' },
});

const CLASS_TEXT: Readonly<Record<string, { name: LocalizedText; role: LocalizedText; description: LocalizedText; tooltip: readonly LocalizedText[] }>> = Object.freeze({
  dachs_nukem: {
    name: { de: 'Dachs Nukem', en: 'Dachs Nukem' },
    role: { de: 'Offensiv', en: 'Offense' },
    description: {
      de: '+50 % Schaden, 10 % Krit-Chance, 200 % Krit-Schaden und +20 % Laufgeschwindigkeit.',
      en: '+50% damage, 10% crit chance, 200% crit damage and +20% movement speed.',
    },
    tooltip: [
      { de: 'Loadout: Waffe 1, Waffe 2, Utility, Ultimate.', en: 'Loadout: Weapon 1, Weapon 2, Utility, Ultimate.' },
      { de: 'Stärke: schnelles Töten auf Distanz und hohe Mobilität.', en: 'Strength: fast ranged kills and high mobility.' },
    ],
  },
  dachs_of_steel: {
    name: { de: 'Dachs of Steel', en: 'Dachs of Steel' },
    role: { de: 'Tank', en: 'Tank' },
    description: {
      de: 'Doppelte Lebenspunkte und Rüstung, +10 HP/s und Rüstung aus eigenen Felszerstörungen.',
      en: 'Double health and armor, +10 HP/s, plus armor from destroying rocks yourself.',
    },
    tooltip: [
      { de: 'Loadout: Waffe 1, Waffe 2, Utility, Ultimate.', en: 'Loadout: Weapon 1, Weapon 2, Utility, Ultimate.' },
      { de: 'Stärke: hält Gegnerwellen direkt an der Basis auf.', en: 'Strength: stops enemy waves at the base.' },
    ],
  },
  inspector_gadachs: {
    name: { de: 'Inspector Gadachs', en: 'Inspector Gadachs' },
    role: { de: 'Ingenieur', en: 'Engineer' },
    description: {
      de: 'Baut dauerhafte Konstruktionen mit einer festen Baukapazität.',
      en: 'Builds permanent structures using a fixed build-capacity budget.',
    },
    tooltip: [
      { de: 'Loadout: Waffe 1, Plasmabrenner auf RMB, mehrere Utility-Slots, Ultimate.', en: 'Loadout: Weapon 1, Plasma Burner on RMB, multiple Utility slots, Ultimate.' },
      { de: 'Konstrukte belegen Baukapazität (100 Punkte) statt Adrenalin.', en: 'Structures use build capacity (100 points) instead of adrenaline.' },
      { de: 'R hält das Utility-Rad offen, E setzt die Auswahl ein.', en: 'Hold R to open the Utility wheel, press E to place the selection.' },
      { de: 'Stärke: stellt bleibende Verteidigung auf und verstärkt sie im Ernstfall.', en: 'Strength: builds lasting defenses and reinforces them under pressure.' },
    ],
  },
});

const CONSTRUCTION_NAMES: Readonly<Record<string, LocalizedText>> = Object.freeze({
  rocket_turret: { de: 'Raketenturm', en: 'Rocket Turret' },
  machine_gun_turret: { de: 'Maschinengewehrturm', en: 'Machine-Gun Turret' },
  flame_turret: { de: 'Flammenwerferturm', en: 'Flamethrower Turret' },
  tesla_turret: { de: 'Tesla-Turm', en: 'Tesla Turret' },
  gravity_turret: { de: 'Gravitationsturm', en: 'Gravity Turret' },
  slow_bubble_turret: { de: 'Zeitblasen-Turm', en: 'Slow-Bubble Turret' },
  medic_pedestal: { de: 'Medik-Podest', en: 'Medic Pedestal' },
  armor_pedestal: { de: 'Rüstungs-Podest', en: 'Armor Pedestal' },
});

const CONSTRUCTION_DESCRIPTIONS: Readonly<Record<string, LocalizedText>> = Object.freeze({
  rocket_turret: { de: 'Verschießt zwei schnell lenkende Raketen und lädt danach länger nach.', en: 'Fires two fast-steering rockets, then takes longer to reload.' },
  machine_gun_turret: { de: 'Bekämpft einzelne Ziele mit hoher Feuerrate.', en: 'Focuses single targets with a high rate of fire.' },
  flame_turret: { de: 'Entzündet Gegner in kurzer Reichweite kontinuierlich.', en: 'Sets nearby enemies on fire continuously.' },
  tesla_turret: { de: 'Erzeugt bei nahen Gegnern eine kleine Teslakuppel mit kontinuierlichem Schaden.', en: 'Creates a small Tesla dome that continuously shocks nearby enemies.' },
  gravity_turret: { de: 'Erzeugt am Einschlag ein schwarzes Loch, das Gegner anzieht.', en: 'Creates a black hole on impact that pulls enemies in.' },
  slow_bubble_turret: { de: 'Erzeugt am Einschlag eine Zeitblase, die alle Einheiten verlangsamt.', en: 'Creates a time bubble on impact that slows every unit.' },
  medic_pedestal: { de: 'Stellt regelmäßig ein Medipack bereit.', en: 'Regularly supplies a medkit.' },
  armor_pedestal: { de: 'Stellt regelmäßig ein Rüstungs-Power-up bereit.', en: 'Regularly supplies an armor power-up.' },
});

const POWERUP_NAMES: Readonly<Record<string, LocalizedText>> = Object.freeze({
  HEALTH_PACK: { de: 'Medipack', en: 'Medkit' },
  ARMOR: { de: 'Rüstung', en: 'Armor' },
  ADRENALINE: { de: 'Adrenalin-Spritze', en: 'Adrenaline Shot' },
  DOUBLE_DAMAGE: { de: 'Doppelter Schaden', en: 'Double Damage' },
  DECOY_STEALTH: { de: 'Unsichtbarkeit', en: 'Invisibility' },
  SHIELD_OVERCHARGE: { de: 'Schildladung', en: 'Shield Overcharge' },
  AK47_FOCUS: { de: 'Einschießen', en: 'AK-47 Focus' },
  AK47_FIRE_SUPERIORITY: { de: 'Durchbruchmunition', en: 'Breakthrough Ammunition' },
  NEGEV_KILLSTREAK: { de: 'Negev-Killstreak', en: 'Negev Killstreak' },
  MOVEMENT_CHARGE: { de: 'Kinetische Ladung', en: 'Kinetic Charge' },
  GLUTWANDERER: { de: 'Glutwanderer', en: 'Ember Walker' },
  SURROUNDED: { de: 'Umzingelt', en: 'Surrounded' },
  TEAM_REGENERATION_SURGE: { de: 'Team-Regenerationsschub', en: 'Team Regen Surge' },
  NUKE: { de: 'Atombombe', en: 'Nuke' },
  HOLY_HAND_GRENADE: { de: 'Heilige Handgranate', en: 'Holy Hand Grenade' },
  BFG: { de: 'BFG', en: 'BFG' },
});

const MAP_NAMES: Readonly<Record<string, LocalizedText>> = Object.freeze({
  '0': { de: 'Map 0 – Testmap', en: 'Map 0 – Test Range' },
  '1': { de: 'Map 1 – Feuertaufe', en: 'Map 1 – Baptism by Fire' },
  '2': { de: 'Map 2 – Zweite Front', en: 'Map 2 – Second Front' },
  '3': { de: 'Map 3 – Rastlos', en: 'Map 3 – No Rest for the Badger' },
  '4': { de: 'Map 4 – Adrenalinrausch', en: 'Map 4 – Adrenaline Rush' },
  '5': { de: 'Map 5 – Grufttitan', en: 'Map 5 – Grave Titan' },
  '6': { de: 'Map 6 – Sporenfront', en: 'Map 6 – Spore Front' },
  '7': { de: 'Map 7 – Medic!', en: 'Map 7 – Medic!' },
  '8': { de: 'Map 8 – Dimensionsbruch', en: 'Map 8 – Dimension Break' },
  '9': { de: 'Map 9 – Letzter Stand', en: 'Map 9 – Last Stand' },
  '10': { de: 'Map 10 – Flammenkoloss', en: 'Map 10 – Inferno Colossus' },
  '11': { de: 'Map 11 – Bombergeschwader', en: 'Map 11 – Bomber Squadron' },
  '12': { de: 'Map 12 – Gegenschlag', en: 'Map 12 – Counterstrike' },
  '13': { de: 'Map 13 – Brutbomben', en: 'Map 13 – Brood Bombs' },
  '14': { de: 'Map 14 – Brandschneise', en: 'Map 14 – Firebreak' },
  '15': { de: 'Map 15 – Leerenjäger', en: 'Map 15 – Void Hunter' },
  '16': { de: 'Map 16 – Zeitzünder', en: 'Map 16 – Time Bomb' },
  '17': { de: 'Map 17 – Bierrettung', en: 'Map 17 – Save the Beer' },
});

const MAP_TUTORIALS: Readonly<Record<string, LocalizedText>> = Object.freeze({
  '1': { de: 'Schützt die Basis vor den Angriffen. Nach jeder abgewehrten Welle gibt es eine kurze Pause. Sind alle Angriffe besiegt, gewinnt ihr die Map. Abschüsse geben XP; Level-Ups bringen Skill-Punkte.', en: 'Protect the base from the attacks. Each cleared wave is followed by a short break. Clear every assault to win the map. Kills grant XP; level-ups grant skill points.' },
  '2': { de: 'Angriffe können aus verschiedenen Richtungen kommen. Achtet auf West- und Ostfront und wechselt rechtzeitig die Seite.', en: 'Attacks can come from different directions. Watch the west and east fronts and switch sides before the pressure shifts.' },
  '3': { de: 'Nicht alle Gegner greifen die Basis an. Manche jagen gezielt euch – erkennt gefährliche Gegner früh und setzt Prioritäten.', en: 'Not every enemy attacks the base. Some hunt you directly—spot dangerous targets early and set your priorities.' },
  '4': { de: 'Diese Map hat zwei Basen. Solange eine davon steht, könnt ihr weiterkämpfen. Zweitbasen können Türme und Power-up-Podeste tragen – verteidigt sie, wenn ihr ihre Unterstützung behalten wollt.', en: 'This map has two bases. As long as one survives, the fight continues. Secondary bases can host turrets and power-up pedestals—defend them if you want to keep their support.' },
  '5': { de: 'Boss-Maps enden erst, wenn der Boss fällt. Der erste Sieg bringt einen Boss-Punkt. Nach dieser Map werden Dachs Nukem und Dachs of Steel freigeschaltet. Inspector bleibt gesperrt.', en: 'Boss maps end only when the boss falls. Your first victory grants a boss point. This map unlocks Dachs Nukem and Dachs of Steel; Inspector stays locked.' },
  '6': { de: 'Große Arenen werden aus mehreren Richtungen angegriffen. Nutzt die Ruhefenster, um zwischen den Fronten zu wechseln – ihr müsst nicht überall gleichzeitig stehen.', en: 'Large arenas are attacked from several directions. Use the quiet windows to move between fronts—you do not need to hold every front at once.' },
  '7': { de: 'Seuchenheiler halten andere Gegner länger im Kampf. Schaltet Supportziele früh aus, bevor ihr die restliche Welle bekämpft.', en: 'Plague Medics keep other enemies in the fight longer. Take out support targets early before dealing with the rest of the wave.' },
  '8': { de: 'Weites offenes Gelände: Vor der Hauptbasis steht nur noch eine zerfallene Bastion mit vier Türmen. Wird sie als HOLD-Ziel markiert, muss die Mauerlinie bis zum angegebenen Angriff überleben – danach wird sie repariert.', en: 'Open ground: only a crumbling four-turret bastion stands before the main base. When marked as a HOLD target, keep the wall line alive until the named assault—then it is repaired.' },
  '9': { de: 'Keine Basis. Kein Rückzug. Überlebt 120 Sekunden. Die Gegner jagen ausschließlich euch; jeder Spieler hat nur zwei Respawns.', en: 'No base. No retreat. Survive for 120 seconds. Enemies hunt you exclusively, and each player gets only two respawns.' },
  '11': { de: 'Feindliche Luftangriffe werden vor dem Einschlag markiert. Bleibt in Bewegung und verlasst die Zielzonen rechtzeitig.', en: 'Enemy airstrikes are marked before impact. Keep moving and leave the target zones in time.' },
  '12': { de: 'Verteidigen allein reicht nicht mehr. Die Map endet erst, wenn die rote Feindbasis zerstört ist. Nutzt die Pausen zwischen Gegenangriffen, um vorzurücken.', en: 'Defense alone is no longer enough. The map ends only when the red enemy base is destroyed. Use the pauses between counterattacks to push forward.' },
  '13': { de: 'Wurf-Dachse schleudern Brutbomben, aus denen neue Gegner schlüpfen. Optionale Brutnester erzeugen zusätzlichen Druck – zerstört ihr sie, wird der weitere Angriff leichter.', en: 'Thrower Badgers hurl brood bombs that hatch into new enemies. Optional brood nests add pressure—destroy them to make the remaining assault easier.' },
  '14': { de: 'Das Void-Feuer bleibt auf dem Boden gefährlich. Nutzt die Felskorridore und haltet die Stellung, bis der Survival-Timer abläuft.', en: 'Voidfire remains dangerous on the ground. Use the rock corridors and hold your position until the survival timer runs out.' },
  '16': { de: 'Zeitzünder jagen Spieler und bewaffnete Konstrukte und sprengen sich in ihrer Nähe. Haltet Abstand und stoppt sie, bevor sie eure Verteidigungslinie erreichen.', en: 'Timebombs hunt players and armed structures, then detonate nearby. Keep your distance and stop them before they reach your defense line.' },
  '17': { de: 'Auf dem Weg zur Feindbasis liegt Bier. Tragt es einzeln zur markierten Abgabe zurück. Jede gerettete Flasche verbessert eure Belohnung – das Bier ist optional, die Feindbasis bleibt das Hauptziel.', en: 'Beer is scattered on the way to the enemy base. Carry it back to the marked drop-off one bottle at a time. Each rescued bottle improves your reward—the beer is optional, the enemy base remains the main objective.' },
});

const SECONDARY_OBJECTIVE_TEXT: Readonly<Record<string, { title: LocalizedText; reward: LocalizedText }>> = Object.freeze({
  'destroy-brood-front': { title: { de: 'BRUTNESTER ZERSTÖREN', en: 'DESTROY BROOD NESTS' }, reward: { de: 'WENIGER GEGNERDRUCK · BONUS-XP', en: 'LESS ENEMY PRESSURE · BONUS XP' } },
  'hold-forward-outpost': { title: { de: 'AUSSENPOSTEN HALTEN', en: 'HOLD THE OUTPOST' }, reward: { de: 'RAKETENTÜRME WERDEN REPARIERT', en: 'ROCKET TURRETS ARE REPAIRED' } },
  'hold-supply-base': { title: { de: 'VERSORGUNGSBASIS HALTEN', en: 'HOLD THE SUPPLY BASE' }, reward: { de: 'MISSIONS-PODEST: HEILIGE HANDGRANATE', en: 'MISSION PEDESTAL: HOLY HAND GRENADE' } },
  'carry-supply-beer': { title: { de: 'BIER RETTEN', en: 'RESCUE THE BEER' }, reward: { de: 'JE FLASCHE: EPISCHE GARANTIE BEI SIEG · REGEN', en: 'EACH BOTTLE: EPIC DROP GUARANTEE ON VICTORY · REGEN' } },
  'destroy-brutbomben-front': { title: { de: 'BRUTNESTER ZERSTÖREN', en: 'DESTROY BROOD NESTS' }, reward: { de: 'WENIGER ZUSATZDRUCK · BONUS-XP', en: 'LESS EXTRA PRESSURE · BONUS XP' } },
  'hold-dimension-bastion': { title: { de: 'BASTION HALTEN', en: 'HOLD THE BASTION' }, reward: { de: 'DIE BASTION WIRD REPARIERT', en: 'THE BASTION IS REPAIRED' } },
  'hold-zeitzunder-middle-outpost': { title: { de: 'ZEITZÜNDER-POSTEN HALTEN', en: 'HOLD THE TIMEBOMB OUTPOST' }, reward: { de: 'DER POSTEN WIRD REPARIERT', en: 'THE OUTPOST IS REPAIRED' } },
  'carry-beer-to-rear-base': { title: { de: 'BIER ZUR BASIS BRINGEN', en: 'DELIVER BEER TO THE BASE' }, reward: { de: 'TEAMBUFF UND ITEM-CHANCE', en: 'TEAM BUFF AND ITEM CHANCE' } },
});

const ENEMY_NAMES: Readonly<Record<string, LocalizedText>> = Object.freeze({
  'grave-titan': { de: 'Grufttitan', en: 'Grave Titan' },
  'spore-warden': { de: 'Sporenpanzer', en: 'Spore Warden' },
  'plague-medic': { de: 'Seuchenheiler', en: 'Plague Medic' },
  'void-stalker': { de: 'Leerenpirscher', en: 'Void Stalker' },
  'stink-broodmother': { de: 'Faulnisbrüterin', en: 'Stink Broodmother' },
  'alien-badger': { de: 'Alien-Dachs', en: 'Alien Badger' },
  'thrower-badger': { de: 'Wurf-Dachs', en: 'Thrower Badger' },
  'inferno-colossus': { de: 'Flammenkoloss', en: 'Inferno Colossus' },
  'pyro-badger': { de: 'Pyro-Dachs', en: 'Pyro Badger' },
  'void-hunter': { de: 'Leerenjäger', en: 'Void Hunter' },
});

const SOURCE_NAMES: Readonly<Record<string, LocalizedText>> = Object.freeze({
  'weapon.SHOTGUN.lightning': { de: 'Schrotflinten-Blitz', en: 'Shotgun Lightning' },
  'weapon.NEGEV.killstreak': { de: 'Negev-Killstreak', en: 'Negev Killstreak' },
  'weapon.AWP.fire_trail': { de: 'AWP-Brandspur', en: 'AWP Fire Trail' },
  'ground_fire.armageddon': { de: 'Armageddon-Brand', en: 'Armageddon Fire' },
  'ground_fire.rocket': { de: 'Raketenbrand', en: 'Rocket Fire' },
  'ground_fire.flamethrower': { de: 'Brennender Boden', en: 'Burning Ground' },
  'ground_fire.base_destruction': { de: 'Basisbrand', en: 'Base Fire' },
  'ground_fire.dash_trail': { de: 'Brennende Dash-Spur', en: 'Burning Dash Trail' },
  'ground_fire.fire_decay': { de: 'Brandzerfall', en: 'Fire Decay' },
  'ground_fire.player_death': { de: 'Brennender Boden', en: 'Burning Ground' },
  'ground_fire.player_fire': { de: 'Brennender Boden', en: 'Burning Ground' },
  'ground_fire.molotov': { de: 'Molotow-Brand', en: 'Molotov Fire' },
  'ground_fire.wildfire': { de: 'Lauffeuer', en: 'Wildfire' },
  'weapon.unknown': { de: 'Waffe', en: 'Weapon' },
  'weapon.fireball_fire': { de: 'Feuerball-Brand', en: 'Fireball Burn' },
  'weapon.fireball_launcher': { de: 'Feuerball-Werfer', en: 'Fireball Launcher' },
  'environment.rock_collapse': { de: 'Explosiver Einsturz', en: 'Explosive Collapse' },
  'ground_fire.player_death_burst': { de: 'Brandexplosion', en: 'Fire Burst' },
  'ground_fire.kamikaze_napalm': { de: 'Kamikaze-Napalm', en: 'Kamikaze Napalm' },
  'ground_fire.void_hunter': { de: 'Leerenbrand', en: 'Voidfire' },
  'ground_fire.timebomb_void': { de: 'Zeitbomben-Brand', en: 'Timebomb Fire' },
  'enemy.void_hunter.nuke': { de: 'Leeren-Atombombe', en: 'Void Nuke' },
  'enemy.inferno_colossus.void_fire': { de: 'Lila Höllenbrand', en: 'Violet Hellfire' },
  'enemy.inferno_colossus.void_trail': { de: 'Lila Höllenspur', en: 'Violet Helltrail' },
  'enemy.timebomb.fire': { de: 'Zeitbomben-Brand', en: 'Timebomb Fire' },
  'enemy.void_hunter.armageddon': { de: 'Leeren-Armageddon', en: 'Void Armageddon' },
  'environment.train': { de: 'Zug RB 54', en: 'RB 54 Train' },
  'environment.train_push': { de: 'In den Zug geschubst', en: 'Pushed into the train' },
  'environment.explosion': { de: 'Explosion', en: 'Explosion' },
  'environment.telefrag': { de: 'Telefrag', en: 'Telefrag' },
  'environment.dash': { de: 'Dash-Aufprall', en: 'Dash Impact' },
  'environment.slime_trail': { de: 'Schleimspur', en: 'Slime Trail' },
  'environment.guardian_spirit': { de: 'Schutzgeist', en: 'Guardian Spirit' },
  'environment.translocator': { de: 'Translocator', en: 'Translocator' },
  'environment.reflector': { de: 'Reflektor', en: 'Reflector' },
  'environment.meteor': { de: 'Meteor', en: 'Meteor' },
  'environment.airstrike': { de: 'Luftangriff', en: 'Airstrike' },
  'environment.decoy_explosion': { de: 'Sprengattrappe', en: 'Decoy Explosion' },
  'environment.detonation': { de: 'Detonation', en: 'Detonation' },
  'environment.void_meteor': { de: 'Leeren-Meteor', en: 'Void Meteor' },
  'environment.reflector_dome': { de: 'Reflexkuppel', en: 'Reflector Dome' },
  'weapon.leaf_blower_deflect': { de: 'Gegenwind', en: 'Headwind' },
  'weapon.grenade': { de: 'Granate', en: 'Grenade' },
  'weapon.cluster_charge': { de: 'Clusterladung', en: 'Cluster Charge' },
  'weapon.stink_cloud': { de: 'Stinkwolke', en: 'Stink Cloud' },
  'ultimate.thunderstorm': { de: 'Gewittersturm', en: 'Thunderstorm' },
  'weapon.ak47.explosive': { de: 'Explosive Zielerfassung', en: 'Explosive Targeting' },
  'weapon.gauss.discharge': { de: 'Magnetische Entladung', en: 'Magnetic Discharge' },
  'weapon.plasma.swarm': { de: 'Plasma-Schwarm', en: 'Plasma Swarm' },
  'source.unknown': { de: 'Unbekannte Quelle', en: 'Unknown Source' },
});

function fallbackText(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function localizedText(text: LocalizedText, locale: Locale): string {
  return text[locale];
}

export function getLoadoutItemName(id: string, locale: Locale): string {
  return localizedText(LOADOUT_NAMES[id] ?? { de: fallbackText(id), en: fallbackText(id) }, locale);
}

export function getClassRole(id: string, locale: Locale): string {
  return localizedText(CLASS_TEXT[id]?.role ?? { de: fallbackText(id), en: fallbackText(id) }, locale);
}

export function getClassName(id: string, locale: Locale): string {
  return localizedText(CLASS_TEXT[id]?.name ?? { de: fallbackText(id), en: fallbackText(id) }, locale);
}

export function getClassTooltipLines(id: string, locale: Locale): readonly string[] {
  return CLASS_TEXT[id]?.tooltip.map((line) => localizedText(line, locale)) ?? [];
}

export function getClassDescription(id: string, locale: Locale): string {
  return localizedText(CLASS_TEXT[id]?.description ?? { de: '', en: '' }, locale);
}

export function getConstructionName(id: string, locale: Locale): string {
  return localizedText(CONSTRUCTION_NAMES[id] ?? { de: fallbackText(id), en: fallbackText(id) }, locale);
}

export function getConstructionDescription(id: string, locale: Locale): string {
  return localizedText(CONSTRUCTION_DESCRIPTIONS[id] ?? { de: '', en: '' }, locale);
}

export function getPowerUpName(id: string, locale: Locale): string {
  return localizedText(POWERUP_NAMES[id] ?? { de: fallbackText(id), en: fallbackText(id) }, locale);
}

export function getMapName(id: string, locale: Locale): string {
  return localizedText(MAP_NAMES[id] ?? { de: `Map ${id}`, en: `Map ${id}` }, locale);
}

export function getMapTutorial(id: string, locale: Locale): string | undefined {
  const tutorial = MAP_TUTORIALS[id];
  return tutorial ? localizedText(tutorial, locale) : undefined;
}

export function getSecondaryObjectiveTitle(id: string, locale: Locale): string | undefined {
  const text = SECONDARY_OBJECTIVE_TEXT[id]?.title;
  return text ? localizedText(text, locale) : undefined;
}

export function getSecondaryObjectiveReward(id: string, locale: Locale): string | undefined {
  const text = SECONDARY_OBJECTIVE_TEXT[id]?.reward;
  return text ? localizedText(text, locale) : undefined;
}

export function getEnemyName(id: string, locale: Locale): string {
  return localizedText(ENEMY_NAMES[id] ?? { de: fallbackText(id), en: fallbackText(id) }, locale);
}

export function getSourceName(id: string, locale: Locale): string {
  const imbued = id.endsWith(':imbued');
  const swarmExplosion = id.endsWith(':swarm-explosion');
  const baseId = imbued || swarmExplosion ? id.slice(0, id.lastIndexOf(':')) : id;
  const direct = SOURCE_NAMES[baseId];
  const powerUp = baseId.startsWith('powerup.') ? POWERUP_NAMES[baseId.slice('powerup.'.length)] : undefined;
  const loadout = LOADOUT_NAMES[baseId];
  const baseName = direct
    ? localizedText(direct, locale)
    : powerUp
      ? localizedText(powerUp, locale)
      : loadout
        ? localizedText(loadout, locale)
        : localizedText(SOURCE_NAMES[baseId] ?? { de: fallbackText(baseId), en: fallbackText(baseId) }, locale);
  if (imbued) return `${baseName} · ${locale === 'de' ? 'entzündet' : 'imbued'}`;
  if (swarmExplosion) return `${baseName} · ${locale === 'de' ? 'Schwarm-Explosion' : 'swarm explosion'}`;
  return baseName;
}

export function getContentDisplayName(id: string, locale: Locale): string {
  if (id.startsWith('construction.')) return getConstructionName(id.slice('construction.'.length), locale);
  if (id.startsWith('powerup.')) return getPowerUpName(id.slice('powerup.'.length), locale);
  if (id.startsWith('enemy.')) return getEnemyName(id.slice('enemy.'.length), locale);
  if (id.startsWith('source.')) return getSourceName(id.slice('source.'.length), locale);
  if (POWERUP_NAMES[id]) return getPowerUpName(id, locale);
  return getLoadoutItemName(id, locale);
}

export function getContentTranslationKeys(): readonly string[] {
  return [
    ...Object.keys(LOADOUT_NAMES).map((id) => `loadout.${id}.name`),
    ...Object.keys(CLASS_TEXT).flatMap((id) => [`class.${id}.name`, `class.${id}.role`, `class.${id}.description`]),
    ...Object.keys(CONSTRUCTION_NAMES).map((id) => `construction.${id}.name`),
    ...Object.keys(POWERUP_NAMES).map((id) => `powerup.${id}.name`),
    ...Object.keys(MAP_NAMES).map((id) => `map.${id}.name`),
    ...Object.keys(ENEMY_NAMES).map((id) => `enemy.${id}.name`),
  ];
}

export function getContentTranslation(key: string, locale: Locale): string | undefined {
  const loadout = /^loadout\.([^.]+)\.name$/.exec(key);
  if (loadout) return getLoadoutItemName(loadout[1], locale);
  const role = /^class\.([^.]+)\.role$/.exec(key);
  if (role) return getClassRole(role[1], locale);
  const name = /^class\.([^.]+)\.name$/.exec(key);
  if (name) return getClassName(name[1], locale);
  const description = /^class\.([^.]+)\.description$/.exec(key);
  if (description) return getClassDescription(description[1], locale);
  const construction = /^construction\.([^.]+)\.name$/.exec(key);
  if (construction) return getConstructionName(construction[1], locale);
  const powerUp = /^powerup\.([^.]+)\.name$/.exec(key);
  if (powerUp) return getPowerUpName(powerUp[1], locale);
  const map = /^map\.([^.]+)\.name$/.exec(key);
  if (map) return getMapName(map[1], locale);
  const enemy = /^enemy\.([^.]+)\.name$/.exec(key);
  if (enemy) return getEnemyName(enemy[1], locale);
  return undefined;
}
