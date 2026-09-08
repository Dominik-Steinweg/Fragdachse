# Smoke-Rework: manuelle Spielabnahme

Status: Browser- und Spielprüfung sind offen. Die automatische Prüfung bestätigt Regeln und
Schnittstellen, aber nicht die visuelle Qualität oder das Spielgefühl. Alle Kästchen bleiben
bis zur tatsächlichen Spielprüfung offen.

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

- [ ] Der Wurf hat 10 s Cooldown. Die Wolke breitet sich über 500 ms auf 240 px Radius aus,
  steht anschließend 9 s und klingt danach 2 s rein optisch aus.
- [ ] Gegner sind schon im expandierenden Bereich betroffen; außerhalb besteht keine
  Verwirrung. Während des optischen Ausklangs neu eintretende Gegner bleiben unbeeinflusst.
- [ ] Richtungsentscheidungen wirken für ungefähr eine Sekunde zusammenhängend. Keine
  hektischen Richtungswechsel, zusätzliche Verlangsamung oder künstliches Festhalten.
- [ ] Silhouetten bleiben im Rauch erkennbar, Details werden verdeckt. Weiche Ränder und
  bewegte lokale Dichte machen den wirksamen Bereich lesbar.
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
- [ ] Auch mehrere überlappende Wolken werden nicht vollständig blickdicht. Statussignale und
  relevante Gegner-/Spielersilhouetten bleiben lesbar.
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

## Ergebnisnotiz

Datum / Build: …

Host / Client / Grafikqualität: …

Beobachtete Abweichung mit Abschnitt, Ausbau, Gegner und Situation: …

Spielgefühl (Kontrolle, Gegenwehr, Verweildauer, Combo-Dichte): …

Visuelle Abnahme bestanden: ☐ Ja ☐ Noch offen
