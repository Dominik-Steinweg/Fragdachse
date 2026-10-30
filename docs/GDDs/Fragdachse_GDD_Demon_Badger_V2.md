# Fragdachse – GDD Demon Badger V2

- Version: 2.0
- Datum: 2026-10-30
- Status: umgesetzt auf `main` (Verhalten, Netz, Darstellung, eigene Töne aus dem Tonstudio, vom User
  abgehört und veröffentlicht); Spieltest offen
- Ersetzt: [Demon Badger V1](Fragdachse_GDD_Demon_Badger_V1.md)
- Gegner-ID: `demon-badger` (Wire-Kind-Index 1 unverändert)

## 1. Rolle

Eine Glaskanone mit sichtbarem Countdown (20 LP, schnell, brandgefährlich). Der Dämonen-Dachs belagert:
Jede Void-Flammen-Salve, die er spuckt, heizt ihn auf; nach der fünften schmilzt er an Ort und Stelle durch
und stirbt in der Explosion. Er zündet nie „im Nichts“, sondern nur dort, wo er gekämpft hat, und der
Fortschritt ist am Körper ablesbar. Konter: die heißesten zuerst töten, aus der Zone gehen, Köder.

Abgrenzung: Die Kabummtula jagt Spieler und springt plötzlich (Konter: ausweichen). Der Dämonen-Dachs
kündigt sich über fünf Stufen an und explodiert stehend (Konter: Reihenfolge beim Töten).

Geprüfte und verworfene Alternativen: zeitliches Laden mit Zielbedingung (bleibt undurchschaubar), Hitze
durch erlittenen Schaden (bestraft Schießen), zyklische Kernschmelze ohne Tod (Dauerdruck ohne Ende),
Explosion beim Tod („lebendes Fass“, hemmt das Töten), Sturmlauf bei voller Hitze (Kabummtula-Kopie).

## 2. Hitzestufen und Kernschmelze

Alle Werte in `src/config/coopDefenseEnemies.json`, Block `heatBurst`.

| Thema | Regel |
|---|---|
| Start | kalt (Stufe 0), Tempo 140 |
| Stufe | +1 je ausgegebener Spucksalve mit mindestens einer Flamme (Spieler- und Belagerungswaffe); die Klaue zählt nicht. Bleibt bis zum Tod |
| Tempo | ×(1 + 0,5 · Stufe/5), Stufe 4 = ×1,4 (196 px/s) |
| Spuckpause | je Stufe 1,4 / 1,2 / 1,0 / 0,8 / 0,6 s × feste Körperstreuung 0,9–1,1 (Hash der ID); gilt für beide Spuckwaffen gemeinsam |
| Kernschmelze | nach der fünften Salve steht er sofort, blickt aufs Ziel, greift nicht mehr an. Die Warnung beginnt nach der Pause der letzten Stufe (der Takt der Salven läuft in die Explosion), dauert 1,4 s, Zone r 220 bleibt am Körper (Rückstoß schiebt sie mit); Zug-Ausweichen hat Vorrang |
| Explosion | r 220, 45 in der Mitte bis 12 am Rand, Rückstoß nur für Spieler; Köder voll, Basen ×3, Bauwerke ×0,6, Zug ×0,3; nie Felsen, nie Gegner; 8 Feuerbrocken im Suchradius 220 (Void-Bodenfeuer, Basisbrand) |
| Tod in der Explosion | ohne Kill-Belohnung, Todeseffekt und Leiche (`hostRemoveWithoutKill`) |
| Getötet | ab Stufe 1 harmloses Verpuffen (r 20–56 nach Stufe); in der Warnung getötet = entschärft |
| Teleport/Hänger | eine laufende Warnung startet bei Teleport oder > 250 ms verpasster Explosion einmal neu |
| Verbündet (Nekromantie) | zählt seine Salven über die Nekromantie, schmilzt genauso durch, trifft nur Gegner, Verbündetenpalette, keine rote Zone |

Fairness (Vertragstest): `telegraphMs ≥ 250 ms + (Radius + 16) / 280 px/s` (1,4 s ≥ 1,09 s).

Rudel: Es gibt kein Kaskaden-Raster mehr. Gemeinsam ankommende Dachse laufen über ihre unterschiedlichen
Spuckpausen auseinander (ein Achterrudel verteilt seine Kernschmelzen über rund 0,7 s); dazu kommen die
unterschiedlichen Laufwege.

## 3. Darstellung

- **Glutzonen:** Das Emissions-Sheet `emission-heat-zones.png` (Kodierung `srgb-zone-alpha-coverage`)
  ordnet jeder Glutrille eine Stufe zu: 1 Kopf (Stirnriss, Schädelhörner, Kehle), 2 Schultern
  (Schulterhörner, Schulternähte), 3 Wirbel, 4 Flanken (Plattenränder, Flankenschuppen), 5 Schwanz. Erzeugt
  als Zonen-Pass aus dem archivierten `db-v2-r2`-Blend (Zuordnung im Katalogeintrag `emissionZones`), ohne
  neue Beauty- oder Schattenmesh-Revision.
- **GPU-Schicht** `HeatEmissionGpuLayer`: alle Dachse eines Sheets in einem Draw-Call; Zonen bis zur Stufe
  leuchten in der Stufenfarbe (Glutrot → Rot → Heißrot → violette Ränder → Violett), die neue Zone flammt
  heiß-rotviolett auf, durch die Kernschmelze öffnen sich Glutrisse (Voronoi-Muster im Körperrahmen, per
  Beauty-Alpha auf die Silhouette begrenzt). Bei Tag bleiben die Rillen weitgehend hell (sie liegen auf
  dunkler Kruste und können nicht weiß ausbrennen).
- **GPU-Partikel** `DemonHeatGpuRenderer`: Glutfunken aus der gerade gezündeten Zone, wenige Funken aus
  den leuchtenden Zonen, Funkenspur ab Stufe 3 im Lauf, eingesogener Void-Dunst in der Warnung,
  Kernschmelze als Druckwelle aus tiefviolettem Dunst bis an den Rand mit dunklem Void-Rauch danach (statt
  der früheren Energiekugel, die zu Weiß stapelte), Verpuffen als sterbende Glut mit Rauch.
- **Licht und Halo** folgen nur der Stufe; das Aufflammen bleibt auf den Rillen (ein Licht im Körper
  würde dessen Relief von innen anleuchten). Das rote Warnlicht ist schwächer, damit ein Rudel nicht zu
  einer roten Fläche verschmilzt.
- Void-Bodenfeuer und fliegende Feuerbrocken beginnen nicht mehr bei fast weißem Lavendel (gilt für alle
  Void-Feuer).

## 4. Töne

| Key | Einsatz | Stand |
|---|---|---|
| `sfx_demon_badger_heat_step` | jeder Stufensprung, lauter mit der Hitze (0,55–1,0), keine Tonhöhenleiter | veröffentlicht |
| `sfx_demon_badger_warning` | Beginn der Warnung (auf 1,4 s geschnitten) | veröffentlicht |
| `sfx_demon_badger_meltdown` | Explosion (`enemy.demon-badger.heat_burst`) | veröffentlicht |
| `sfx_demon_badger_fizzle` | Verpuffen (`enemy.demon-badger.heat_fizzle`) | veröffentlicht |
| `sfx_demon_badger_spit` | jede Flamme der Salve (`shotAudio`) | veröffentlicht |

Rezepte (Absicht, Prompt, Medium über ComfyUI) stehen im Studio-Katalog. Nach jeder Studio-Veröffentlichung
`npm run assets:runtime` ausführen (der Build tut es selbst): Ein Platzhalter, der eine Byte-Kopie war, steht
sonst noch als Alias im Laufzeit-Manifest. Der Dev-Server umgeht solche veralteten Einträge und warnt.

## 5. Messungen (2026-10-30, Map 04, Basis in der Messung unzerstörbar)

Basisschaden mit normalen HP (Türme aktiv) und ungestoppt (HP 1000):

| Dachse | V1 (10–40 s) | V2 normal, gesamt / 10–40 s | V2 ungestoppt, gesamt / 10–40 s |
|---|---|---|---|
| 1 | ≈ 440 | 66 / 0 (von Türmen getötet) | 343 / 169 (1 Kernschmelze) |
| 6 | ≈ 975 | 242 / 58 (keine Kernschmelze) | 874 / 541 (6 Kernschmelzen) |
| 12 | ≈ 1880 | 1067 / 502 (6 Kernschmelzen) | – |

V2 ist endlich: Der Druck kommt in Spitzen, ein durchgekommener Dachs trifft die Basis mit rund 68 je
Kernschmelze plus Spucken und Brand. Insgesamt liegt der Basisschaden unter V1; Wellenzahlen und
Dawn-Kosten (2) sind unverändert und werden nach dem Spieltest angepasst.

Perf-Paar (Headless, 24 Dachse, ms je Frame): Aufheizen V2 8,1–8,3 gegen V1 8,2; nach den
Kernschmelzen 7,8–8,1 gegen V1 8,0–8,2.

## 6. Technik

- Host: `CoopDefenseEnemyHeatBurstSystem` (Stufe je gemeldeter Salve, Tempo, Halten, Explosion,
  Entfernung) über den Salven-Port `EnemySalvoHooks` des Angriffssystems und der Nekromantie; die Pause
  sperrt alle Salvenwaffen des Körpers.
- Repliziert: `EnemyHeatBurstState { revision, stage, stageAt, telegraphAt, burstAt }`, Feld
  `FIELD_HEAT_BURST`, Protokoll 59. Phase (`heat`, `telegraph`, `burst`) und Hitze leiten Host und Clients
  aus Stufe und Zeitstempeln ab.
- Aufnahmen: `tools/capture-kit/examples/demon-badger.json` (Stufen, Kernschmelze, Verpuffen) und
  `demon-badger-pack.json` (echte Belagerung).

## 7. Offen

- Spieltest: Lesbarkeit der Stufen im Getümmel, überlappende Warnzonen vieler Dachse vor der Basis, Druck
  auf die Basis, Wellenzahlen, Dawn-Kosten.
