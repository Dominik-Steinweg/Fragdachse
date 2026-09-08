# Smoke-Rework: manuelle Spielabnahme

Status: Die Browserprüfung des Smoke-Renderers wurde am 08.09.2026 durchgeführt; Ergebnisse
und Performancevergleich stehen in Abschnitt 7. Die vollständige Live-Spielabnahme mit Host
und Client sowie die Bewertung des Spielgefühls bleiben offen. Die folgenden Gameplay-Kästchen
werden durch Renderer- oder automatisierte Prüfungen nicht automatisch abgenommen.

## Vorbereitung

- Einen Coop/PvE-Durchlauf als Host und einen zweiten Teilnehmer als Client verwenden.
- Baseline zunächst nur mit freigeschalteter Rauchgranate prüfen; danach die Ausbauten gezielt
  ergänzen. Die beiden Boss-Voraussetzungen sind jeweils L2 I und R2.
- Einen offenen Bereich, eine Engstelle mit festen Hindernissen und einen Bosskampf auswählen.
- Vergleichbar testen: gleiche Gegnerart, gleiche Waffe, einmal ohne und einmal mit Rauch.
- Sichtprüfung bei hoher und niedriger Grafikqualität, unterschiedlichen Fenstergrößen und
  verfügbarem Kamera-Zoom durchführen. Keine zusätzliche Browser-Infrastruktur erforderlich.

Aktuelles Tuning steht in [utilities-grenades.json](../src/loadout/content/data/utilities-grenades.json)
und im [Upgradebaum](../src/config/coopDefenseUpgrades.json). Die gemeinsame Verwundbarkeit wird
weiterhin von [TargetStatusSystem.ts](../src/systems/TargetStatusSystem.ts) aufgelöst.

## 1. Baseline und Lesbarkeit

- [ ] Der Wurf hat 10 s Cooldown. Die Wolke breitet sich über 500 ms auf 144 px Radius aus,
  steht anschließend 9 s und klingt danach 2 s rein optisch aus.
- [ ] Gegner sind schon im expandierenden Bereich betroffen; außerhalb besteht keine
  Verwirrung. Während des optischen Ausklangs neu eintretende Gegner bleiben unbeeinflusst.
- [ ] Richtungsentscheidungen wirken für ungefähr eine Sekunde zusammenhängend. Keine
  hektischen Richtungswechsel, zusätzliche Verlangsamung oder künstliches Festhalten.
- [ ] Im Kern sind Bewegung und Konturen nur schwach zu erahnen; die eigene Figur wird
  nicht freigestellt. Dunkle rollende Rauchformen, kompakte weiche Ränder und 96 % maximale
  Deckkraft ersetzen den transparenten Nebel. HUD und wichtige Statusanzeigen bleiben lesbar.
- [ ] Spieler können ihre Bewegung und ihr Ziel uneingeschränkt steuern.

## 2. R1, R2, Austritt und Wiedereintritt

- [ ] R1 I bis III lenkt stärker ab und hält Gegner im Mittel länger innerhalb der Wolke,
  besonders nahe dem Rand. Gegner finden weiterhin begehbare Wege aus Engstellen.
- [ ] Nach Austritt bleibt die Störung kurz bestehen. Die Bewegung erholt sich am Ende weich,
  während die Erfassungsreichweite kontinuierlich zurückkehrt. Wiedereintritt wirkt sofort.
- [ ] R2 zeigt die vorhandene Verwundbarkeitsanzeige. Schaden steigt während Verwirrung und
  Nachwirkung; ohne andere Quelle endet dieser Bonus genau mit der Nachwirkung.
- [ ] Eine zusätzlich von anderer Quelle aufgebrachte Verwundbarkeit bleibt nach Ablauf von
  Smoke-R2 bestehen. Gleichzeitig aktive Quellen vervielfachen den Bonus nicht.
- [ ] Bei überlappenden unterschiedlich ausgebauten Wolken addiert sich die Verwirrung nicht;
  ein schwächerer, länger verbleibender R2-Beitrag geht trotzdem nicht verloren.

## 3. Wahrnehmung, Hindernisse und Bosskampf

- [ ] Feindliche Fernkämpfer erfassen durch wirksamen Rauch keine neuen entfernten Ziele.
  Nahsicht bleibt möglich; nach Austritt kommt die normale Reichweite allmählich zurück.
- [ ] Eine bereits begonnene Salve, ein Nahkampfausholen oder ein angekündigter Brandsatz läuft
  weiter. Bei Sichtverlust bleibt der zuletzt sichtbare Zielpunkt stehen; ein anderes sichtbares
  Ziel lenkt den angekündigten Brandsatz nicht um.
- [ ] Bereits fliegende Geschosse und bestehende Brand-/Flächeneffekte verschwinden nicht.
- [ ] Verbündete Türme und freundliche zielsuchende Waffen erfassen Ziele weiterhin regulär.
- [ ] Ein vollständig vom Wolkenzentrum abgeschirmter Gegner erhält weder neue Verwirrung
  noch Gewittertreffer. Nach Umgehen oder Zerstören des Hindernisses setzt die Wirkung ein.
- [ ] Auch teilweise abgeschirmte Sichtlinien stimmen: Ein freier Rauchabschnitt unterbricht
  die Fernsicht; ein vollständig abgeschirmter Rauchabschnitt tut das nicht.
- [ ] Bosse zeigen weniger Bewegungsabweichung und kürzere Nachwirkung, sehen im Nahbereich
  weiter und werden nicht zusätzlich zum Wolkeninneren gelenkt. Angekündigte Spezialangriffe
  bleiben bestehen. R2, Stromschaden und Aufladung wirken weiterhin.

## 4. Gewittersturm, BL1 und BL2

- [ ] Gewitter verursacht periodischen Schaden; kurze elektrische Akzente zeigen Aufladung.
  Verwirrungsanzeige, Aufladung, fliegende Entladungen und Wachstumsimpulse sind unterscheidbar.
- [ ] Nach gültigem freundlichem Treffer entstehen mit BL1 I/II/III jeweils 1/2/3 Entladungen.
  Auch Brand-, Gift- und Flächenticks können auslösen; Gewitter und BL1 erzeugen keine
  endlosen Entladungsketten. Schnelle Treffer mehrerer Spieler teilen den Gegner-Cooldown.
- [ ] Entladungen starten in zufälliger Richtung geradeaus, lenken erst verzögert und schwach
  ein und bevorzugen Ziele in Flugrichtung. Sie kollidieren mit Hindernissen und verschwinden
  beim Treffer oder nach verbrauchter Reichweite.
- [ ] Die Anfangsphase schützt den Ursprung gegen seine eigenen Entladungen. Eine spätere
  Rückkehr ist möglich; verschiedene Projektile dürfen dasselbe Ziel treffen.
- [ ] Ein tödlicher freundlicher Treffer kann zugleich BL1 und BL2 auslösen. Ein tödlicher
  erster Gewittertreffer kann bereits BL2 auslösen.
- [ ] BL2 erweitert ausschließlich die zugeordnete noch wirksame Wolke: pro Kill +1 s und
  +5 % des beim Wurf aufgelösten Radius, maximal 2/4/6 Auslösungen. Schnelle Kills verschieben
  das Wachstumsziel ohne sichtbaren Sprung.
- [ ] Ein kurz nach Wolkenende getöteter aufgeladener Gegner kann noch BL1 auslösen; die
  beendete Wolke wird durch BL2 nicht wiederbelebt.
- [ ] Ein nach dem Wurf geändertes Loadout verändert die bereits geworfene Wolke nicht.

## 5. Überlappung und maximale Combo

- [ ] Mehrere Gewitterwolken verursachen unabhängig Schaden. Die erste Aufladung bestimmt
  Entladung und Wachstum, bis sie abläuft; nur ihre eigene Wolke erneuert die Zuordnung.
- [ ] Große Gruppen in mehreren voll ausgebauten Wolken zusammen mit periodischen
  Schadensquellen testen. Keine verlorenen Treffer, mehrfachen Todes-Procs oder global
  abgeschnittenen Entladungen; Wachstum bleibt pro Wolke begrenzt.
- [ ] Auch mehrere überlappende Wolken behalten geringe Restdurchsicht. Statussignale bleiben
  lesbar, Figuren sind im Kern nur schwach zu erahnen.
- [ ] Bildrate und Eingabereaktion bei maximaler Combo beobachten; Grafikqualität vergleichen.
  Reduzierte Kosmetik darf tatsächliche Projektile und Treffer nicht verschwinden lassen.

## 6. Host, Client, PvP und Lifecycle

- [ ] Host und Client sehen dieselben Wolkenphasen, Radien, Wachstumsschritte und Statusenden.
- [ ] Ein später beitretender Client übernimmt die aktuelle Wolke ohne vergangene
  Wachstumsimpulse nachzuspielen. Nach kurzen Verbindungsstörungen stimmt der Folgezustand.
- [ ] Nach Gegner-Tod, neuer Runde/Activity und World-Wechsel bleiben keine alten
  Verwirrungs-/Aufladungsanzeigen oder Combo-Reaktionen an neuen Gegnern hängen.
- [ ] Bereits geworfene Wolken behalten bei Besitzer-Austritt ihre Herkunft und ihren Ausbau.
- [ ] PvP verwendet dieselbe Rauchdarstellung; menschliche Gegner erhalten weder erzwungene
  Bewegungsabweichung noch Zielstörung.
- [ ] Upgradebaum in Deutsch und Englisch öffnen: beide Äste, gemeinsame Boss-Voraussetzungen,
  beide Folge-Upgrades, Punktkosten, vorhandene Icons und aufgelöste Zahlen sind verständlich.

## 7. Rendererprüfung vom 08.09.2026

Geprüft wurde im sichtbaren In-App-Browser mit Phaser 4.2.1/WebGL. Eine temporäre lokale
Vergleichsszene verwendete jeweils den echten alten bzw. neuen `SmokeSystem` und identische
Wolken-Snapshots. Die Vergleichshilfen werden nicht als neue Test-Infrastruktur ausgeliefert.

- [x] Alte Darstellung vor der Änderung erfasst: deutliche Durchsicht, flächiger Nebeleindruck.
- [x] Einzelwolke und Gewitter auf gleichzeitig hellem und dunklem Untergrund: dichter Kern,
  weicher kompakter Rand, bewegte Rauchformen, lokale blauweiße Aufhellungen und feine Blitze.
- [x] Sechs überlappende Wolken mit bewegten Figuren: hohe gemeinsame Deckkraft ohne
  vollständige Blickdichte; keine Vervielfachung der abschließenden Deckkraft.
- [x] Maximale Größe (L1 III + sechs BL2-Procs), Wachstumsübergang und sichtbarer Wachstumsimpuls.
  Ein beim Vergrößern gefundener Mittelpunktversatz wurde korrigiert und im Renderer-Test geschützt.
- [x] Verwirrungs- und Aufladungsmarker über der Wolke; die Figur im Zentrum bleibt verdeckt.
- [x] Hohe, mittlere und niedrige Qualität, Kamera-Zoom 1 / 0,65 sowie Renderflächenwechsel
  1920 × 1080 / 1280 × 720: keine verschobene Wolkenmitte oder stehen gebliebenen Renderflächen.
- [x] Optischer Ausklang bis zur vollständig verschwundenen Wolke; temporären
  Browser-Viewport nach der Prüfung zurückgesetzt.
- [x] Hauptspiel und Testgelände starten; Smoke ist in der PvP-Utility-Auswahl verfügbar.
- [ ] Live-Wurf und Zweispieler-Sichtprüfung: Der gehaltene Wurf ließ sich über die verwendete
  Browser-Tastatursteuerung nicht zuverlässig auslösen. Kein erfolgreich geprüfter Live-Wurf
  behauptet; Host-/Client-Darstellung im laufenden Kampf bleibt offen.
- [ ] Spielgefühl, Bosskampf und maximale echte Gegner-Combo: weiterhin vom Spieler abzunehmen.

### Messverfahren und Grenzen

1920 × 1080 Backing Store, Zoom 1, Grafikqualität „high“, dieselbe Kamera und Figurenverteilung.
Je Fall 2 s Aufwärmen und 8 s Messung. Standardfälle enthalten 20 bewegte Sprites; der Lastfall
enthält 600 Sprites und sechs Gewitterwolken, ohne Gegner-KI oder Combat-Simulation.
Framezeiten stammen aus aufeinanderfolgenden `performance.now()`-Messungen in `Scene.update`.
CPU-Submission misst `prerender` bis `postrender`; sie ist **keine GPU-Zeit**.

Die RenderTexture-Auflösung ist Teil der Änderung: alt 50 %, neu 75 % in hoher Qualität;
die Spielauflösung bleibt gleich. Der neue Renderer verwendet einen Shader-Draw-Call je
sichtbarer Wolke und keine Blur-/Bloom-Kette je Wolke. Das folgt dem
[Phaser-4-Shader-Guide](https://phaser.io/tutorials/phaser-4-shader-guide), der Shader als
einzelne, nicht gebatchte Draw Calls beschreibt. Ein Geschwindigkeitsgewinn wird nicht vorausgesetzt.

Alle Zeiten in Millisekunden, jeweils **Median / 95. Perzentil**:

| Fall | Radius | Frame alt | Frame neu | CPU-Submission alt | CPU-Submission neu |
|---|---:|---:|---:|---:|---:|
| Einzelwolke | 144 | 6,1 / 6,2 | 6,1 / 6,2 | 0,1 / 0,2 | 0,2 / 0,3 |
| Gewitter | 144 | 6,1 / 6,2 | 6,1 / 6,2 | 0,2 / 0,3 | 0,2 / 0,2 |
| Sechs Gewitterwolken | 144 | 6,0 / 6,3 | 6,1 / 6,2 | 0,2 / 0,3 | 0,2 / 0,3 |
| Maximale Größe | 144 × 1,69 | 6,1 / 6,2 | 6,1 / 6,2 | 0,2 / 0,3 | 0,2 / 0,3 |
| 600 Figuren, sechs Gewitterwolken | 144 | 6,0 / 6,3 | 6,1 / 6,2 | 0,4 / 0,6 | 0,4 / 0,6 |
| Sechs Gewitterwolken | 240 | 6,1 / 6,3 | 6,1 / 6,2 | 0,2 / 0,3 | 0,2 / 0,2 |

Je Fall wurden 1.320 / 1.318 / 1.321 / 1.319 / 1.321 / 1.321 Frames im alten
Vergleich erfasst; im abschließenden neuen Durchlauf
1.318 / 1.319 / 1.321 / 1.321 / 1.321 / 1.321.
Der tatsächliche Wechsel mit sechs Wolken von **alt 240 px** auf **neu 144 px** ergibt
6,1 / 6,3 ms gegenüber 6,1 / 6,2 ms; die CPU-Submission bleibt bei 0,2 / 0,3 ms.

Der Bildschirmtakt dominiert die Framezeiten. Unterschiede von 0,1 ms sind kein Nachweis eines
GPU-Gewinns. In diesem Renderer-Szenario ist keine relevante Verschlechterung sichtbar;
Aussagen über schwächere GPUs oder komplette Spielszenen mit 600 Gegnern sind daraus nicht ableitbar.
GPU-Zeit wurde nicht zuverlässig gemessen und wird nicht ausgewiesen.

### Automatische Abschlussprüfung

- `npm run check`: bestanden (3.129 Core-Tests, 33 Architekturtests, TypeScript und Vite-Build).
- Integrationssuite: bestanden (344 Tests), einschließlich `SmokeNetwork` und `SmokeCombat`.
- `SmokeCombos`, `SmokeProgression` und `ProgressionCoverageSmoke`: bestanden.
- Erweiterte Rendererprüfungen schützen gemeinsame Deckkraft, Qualitätswechsel, Culling,
  Mittelpunkt beim Wachstum, ausbleibende alte Wachstumsimpulse und Shader-/Licht-Cleanup.
- Die Diagnose führt Smoke jetzt als `smokeClouds` mit Shader- und Renderflächenobjekten;
  die entfernten klassischen Partikelemitter und Blitz-Graphics werden nicht weiter gezählt.
- `git diff --check`: bestanden. Die temporären Vergleichsdateien wurden entfernt.

## Korrektur der blockartigen Rauchdarstellung (08.09.2026)

Die vorstehende Vergleichsszene verwendete die kurze Scene-Laufzeit. Sie deckte damit
die im Hauptspiel übergebene synchronisierte Unix-Zeit nicht ab. Die Performancewerte
gelten nur für dieses isolierte Renderer-Szenario, nicht als Nachweis einer fehlerfreien
Zeitübergabe im Hauptspiel.

Ursache: Absolute Unix-Sekunden verloren beim Übertragen in GPU-Floats die für
Noise-Koordinaten und elektrische Verzweigungen nötige Genauigkeit. Die Darstellung
zerfiel dadurch in große rechteckige Flächen. Der Renderer zieht nun vor der Übergabe
an die GPU den ersten empfangenen Zeitstempel jeder Wolke ab. Dieser Bezug bleibt
beim Culling erhalten und wird bei Entfernung beziehungsweise World-Teardown gelöscht.
Gameplay-Zeitstempel und Netzwerkzustände bleiben unverändert.

- [x] Fehler im sichtbaren Browser im echten Arena-Testgelände mit der bisherigen
  Unix-Zeitübergabe reproduziert: dieselben rechteckigen Flächen wie im Fehlerbericht.
- [x] Normale Wolke und Gewitterwolke mit korrigierter Zeit im selben Arena-Renderer
  geprüft: zusammenhängende Rauchformen ohne rechteckige Flächen; Wolkenende entfernt
  die Darstellung. Erzeugung über temporäre Prüftasten direkt in der World-Smoke-Runtime
  mit `bridge.getSynchronizedNow()`, anschließend reguläre Host-Aktualisierung und Darstellung.
- [x] Temporäre Prüftasten wieder entfernt; keine Änderungen am Spielerprofil.
- [x] Renderer-Regressionsprüfung mit kurzem Zeitursprung und realistischem Unix-Zeitstempel:
  Millisekunden bleiben nach Float-Konvertierung unterscheidbar; Culling behält den
  Zeitbezug, wiederverwendete IDs erhalten nach Teardown einen neuen Bezug.
- [x] `npm run check` nach der Korrektur bestanden: 3.130 Core-Tests, 33 Architekturtests,
  TypeScript und Vite-Build. Ergänzte Rendererprüfungen danach nochmals bestanden (3 Tests).
- [ ] Live-Wurf und verbundener zweiter Client bleiben ungeprüft; diese Fehlerkorrektur
  ersetzt nicht die oben offene Spielabnahme.

## Rauchstruktur und Bewegung (08.09.2026, zweite optische Überarbeitung)

- Dunklere Rauchballen mit stärkerem Hell-Dunkel-Kontrast, mittleren gegenläufigen
  Verwirbelungen und zusätzlichem feinem Noise. Oberflächenbeleuchtung folgt den
  größeren Ballen; feine Details beeinflussen die Dichte und Farbe.
- Bewegte Ausbuchtungen und transparente Einbuchtungen ersetzen den gleichmäßigen
  Kreisrand. Der Kern bleibt dicht, die äußeren Rauchlagen werden durchlässiger.
- Wetterleuchten bleibt lokal; sichtbare Entladungen sind auf eine sehr schwache,
  schmale und teilweise verdeckte Linie ohne dekorative Verzweigungen reduziert.
- Feine Details werden abhängig von Qualitätsstufe und Pixelgröße ausgeblendet.
  Weiterhin ein Shader je sichtbarer Wolke, keine zusätzliche Blur-/Bloom-Kette.
- Im sichtbaren Browser in der echten Arena geprüft: normale Wolke über mehrere
  Animationszeitpunkte, Gewitter und sechs hinzugefügte überlappende Gewitterwolken.
  Bewegte innere Struktur, unregelmäßige Silhouette und lokales Wetterleuchten sichtbar.
  Die temporäre Prüferzeugung verwendete für längere Beobachtung 30 Sekunden Standzeit;
  die ausgelieferte Gameplay-Dauer wurde nicht geändert. Prüftasten wieder entfernt.
- `SmokeRenderer` und `SmokeSystem`: 4 Tests bestanden; `npm run build` und
  `git diff --check` bestanden. Der bisherige Performancevergleich
  wurde für diese Shaderfassung nicht wiederholt. Zweispieler-Abnahme bleibt offen.

## Rundere Volumen und variierende Dichte (08.09.2026)

Die Rückmeldung zur Sechs-Wolken-Ansicht ist eine gestalterische Referenz: Ihre
unregelmäßige Überlagerung wirkt rauchiger als gleichmäßig verteilte Einzelballen.
Die einzelne Wolke kombiniert deshalb jetzt zwei unabhängig bewegte Ballenfelder
unterschiedlicher Größe. Zusätzlich streuen die Ballenradien deutlich stärker.
Das erzeugt keine zusätzlichen Gameplay-Wolken.

- Langgezogene Verzerrungen und starke Oberflächenkontraste zurückgenommen;
  dunkle Zwischenräume aufgehellt, anschließend die gesamte Graupalette auf Wunsch
  moderat abgedunkelt. Fast schwarze Furchen werden nicht wieder eingeführt.
- Eine separat bewegte, halbtransparente graue Zwischenlage füllt die Ballenzwischenräume.
  Lokale Deckkraft variiert mit den Ballen und dieser Zwischenlage. Die gemeinsame
  Deckkraftbegrenzung bleibt erhalten. Alles wird im bestehenden Wolken-Shader komponiert.
- Hohe Qualität verwendet jetzt 100 % statt 75 % Renderauflösung. Die prozedurale
  Struktur profitiert damit unmittelbar von mehr Pixeln; bestehende Quelltexturen
  bleiben erhalten. Mittlere und niedrige Renderauflösung bleiben unverändert.
- Sichtprüfung im echten Arena-Testgelände: normale Wolke, Gewitter, hinzugefügte
  sechs Gewitterwolken; nach den letzten Rückmeldungen erneut eine Einzel-Gewitterwolke
  mit Größenstreuung, zwei Ballenfeldern und dunklerer Palette geprüft.
  Prüferzeugung wie zuvor mit 30 Sekunden Beobachtungszeit, ohne Änderung der Gameplay-Dauer.
- Nach weiterer Rückmeldung die Rauchgrautöne nochmals um ungefähr 14 % abgesenkt;
  Struktur, lokale Transparenz und Wetterleuchten beibehalten. Diese Einzelwolke
  ebenfalls im sichtbaren Testgelände geprüft. Temporäre Prüftasten wieder entfernt.
- `SmokeRenderer` und `SmokeSystem`: 4 Tests bestanden. `npm run build` bestanden.
- Kein neuer Performancevergleich: Höhere Renderauflösung und ein zweites Ballenfeld
  erhöhen die GPU-Arbeit. Aus der Sichtprüfung wird kein unveränderter GPU-Aufwand abgeleitet.
  Zweispieler-Abnahme bleibt offen.

## Körpernahe Statusdarstellung (08.09.2026)

Diese Darstellung ersetzt die früher beschriebenen Verwirrungs-/Aufladungsmarker
und den Verwundbarkeitsring an Gegnern:

- Desorientierung: drei dezente, unruhige Rauchschlieren direkt am Körper.
- Aufladung: kurze unregelmäßige elektrische Körperbögen und kleine Funken.
  Im Rauch bleiben die scharfen Bögen verdeckt; nur ein breiter, schwacher Lichtschein
  erscheint diffus durch die Wolke, ähnlich ihrem Wetterleuchten.
- Verwundbarkeit: rötlich pulsierende Überlagerung des aktuellen Sprite-Frames,
  einheitlich für alle Verwundbarkeitsquellen an Gegnern. Kein Ring mehr.
- Die Effekte folgen Körpergröße, Animation und Sichtbarkeit der Figur.
  Alle Statuslagen bleiben gleichzeitig aktiv, auch zusammen mit Brennen.
  Host und Client liefern dasselbe Darstellungsziel aus ihrer Gegnerdarstellung;
  Gameplay und Netzwerkfelder wurden dafür nicht erweitert.
- Desorientierung und Aufladung blenden in den letzten 350 beziehungsweise 300 ms
  ihrer bestehenden Laufzeit aus. Die Verwundbarkeitsdarstellung klingt nach dem
  Ende über 220 ms aus; dies verlängert keinen Gameplay-Status.

Sichtprüfung im sichtbaren Arena-Testgelände mit temporären Darstellungsfiguren:
getrennte und kombinierte Status, normale Gegnergröße und dreifache Größe,
Überlagerung mit Brennen, Verdeckung durch echte Runtime-Wolken, diffuser
Aufladungsschein und vollständiges Ausblenden geprüft. Die Figuren waren
Darstellungsfixtures, keine Prüfung tatsächlich ausgelöster Kampfeffekte.
Temporäre Prüftasten und Figuren wieder entfernt.

Rendererprüfungen schützen gleichzeitige Lagen, Verdeckung, Ausblenden,
Sprite-Frame-/Transform-Nachführung, unsichtbare Ziele, wiederverwendete IDs
und Cleanup. `npm run check` bestanden: 3.132 Core-Tests, 33 Architekturtests,
TypeScript und Produktionsbuild. Die Integrationssuite bestand mit 344 Tests.
Live-Kampfauslösung, verbundener zweiter Client und ein neuer Performancevergleich
bleiben für diese optische Überarbeitung offen.

## Ergebnisnotiz für die verbleibende Spielabnahme

Datum / Build: …

Host / Client / Grafikqualität: …

Beobachtete Abweichung mit Abschnitt, Ausbau, Gegner und Situation: …

Spielgefühl (Kontrolle, Gegenwehr, Verweildauer, Combo-Dichte): …

Visuelle Abnahme bestanden: ☐ Ja ☐ Noch offen
