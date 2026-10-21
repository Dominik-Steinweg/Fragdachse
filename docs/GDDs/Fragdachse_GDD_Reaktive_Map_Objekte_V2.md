# Fragdachse – GDD Reaktive Map-Objekte V2 (Riesenbovist und Strohkorb)

- Version: 1.0
- Datum: 2026-10-21
- Status: in Umsetzung auf Branch `spores-bees`
- Spielmodus: Coop-Kampagne und From Dachs Till Dawn (kein PvP)
- Kind-IDs: `spore_puffball` (Varianten `meadow`, `void`) und `bee_hive` (Variante `straw`)
- Baut auf [V1 (explosive Fässer)](Fragdachse_GDD_Reaktive_Map_Objekte_V1.md) auf

## 1. Ziel und Spielerlebnis

Zwei Map-Objekte reagieren auf Beschuss, bleiben aber stehen und laden wieder auf. Sie machen Engstellen
zu taktischen Werkzeugen: Wer zuerst trifft, setzt die Wirkung gegen die Gegner ein.

- **Riesenbovist:** Ein Treffer lässt ihn platzen. Eine Sporenwolke schadet über Zeit und bremst jeden
  Gegner darin. Der Pilz sackt zusammen und füllt sich in etwa 15 s wieder.
- **Strohkorb:** Ein Treffer scheucht einen Bienenschwarm auf. Er jagt einige Sekunden lang nacheinander
  die nächsten Gegner, sticht und fliegt danach zurück. Der Korb ist nach etwa 15 s wieder bereit.

## 2. Entscheidungen (User, 2026-10-21)

| # | Entscheidung |
|---|---|
| S1 | Sporen: Gift-DoT plus spürbare Verlangsamung in der Wolke. |
| B1 | Bienen: ein animierter Schwarm aus vielen Einzelbienen. Er jagt nacheinander die nächsten Gegner des Schützen und sticht mit kleinem Schaden. Kugeln treffen die Bienen nicht. Feuer und Explosionen zerstreuen den Schwarm. |
| P1 | Einsatzorte: Kampagne thematisch (Sporen auf Sporen- und Void-Karten, Bienen auf Wald- und Wiesenkarten) und Dawn-Arenen. Map-Editor-Ebene. Kein PvP. |
| O1 | Optik: Riesenbovist mit Rissmuster, der zusammensackt und sich wieder füllt. Geflochtener Strohkorb auf Holzbock, von oben an konzentrischen Ringen lesbar. Beide entstehen in Blender. |
| O2 | Die Bienen sind kein Asset, sondern ein prozeduraler GPU-Effekt. Ihre Körperlänge ist realistisch: 3–4 px, also etwa 10 cm. |
| V1 | Aus V1: Jeder Treffer löst aus, auch durch Gegner, außer Nahkampfbissen. Die Wirkung gehört dem Auslöser und trifft nur dessen Gegner, nie Teammates und nie ihn selbst. Löst in Coop ein Gegner aus, richtet sie sich gegen die Spieler. |
| L1 | Nachtrag: Ein getroffener Korb beleuchtet den Bereich, in dem seine Bienen aktiv sind. Das Licht strahlt aus dem Korb heraus. |

Claude hat außerdem entschieden (umkehrbare Defaults):

- Die Wirkung gehört dem letzten Treffer im Vorlauf.
- Der Spieler-Slow gilt beim Gehen, nicht beim Dash.
- Stiche haben keinen Life-Leech, keine On-Hit-Effekte und keine Waffen-Multiplikatoren.
- Zerstreut wird der Schwarm durch eine Explosion, die ihn überlappt, oder durch Bodenfeuer.
- Wolke und Stiche machen keinen Umweltschaden. Sie lösen also keine anderen reaktiven Objekte aus.
- Sporen prüfen keine Sichtlinie.

## 3. Verhalten

| Phase | Riesenbovist | Strohkorb |
|---|---|---|
| Bereit (`idle`) | Pilz steht prall. | Einige Bienen kreisen am Flugloch. |
| Vorlauf (`triggered`) | 250 ms: Er bläht sich auf. Weitere Treffer übernehmen den Besitz. | 300 ms: Er wackelt. Weitere Treffer übernehmen den Besitz. |
| Wirkung | Platzt. Die Wolke (Radius 100 px, 5 s) macht alle 500 ms 4 Schaden und bremst um 40 %. | Ein Schwarm quillt heraus und jagt 7 s lang. Je Ziel gibt es höchstens 4 Stiche à 3 Schaden oder 2,2 s, dann kommt das nächste. |
| Aufladen (`recharging`) | Sackt zusammen und füllt sich in 15 s wieder. Treffer wirken nicht. | Leer und ruhig bis 15 s nach dem Auslösen. Treffer wirken nicht. |

Wolke und Schwarm haben eine Seitenfarbe. Gehören sie einem Spieler, ist die Wolke warmer Ockerstaub
und die Bienen sind goldgelb. Gehören sie einem Gegner, ist die Wolke entsättigt mit Void-Violett und
die Bienen haben einen violetten Saum (Farbregel: Violett heißt Gefahr, Rot bleibt Telegraph).

## 4. Tuning (Startwerte, `src/config/reactiveProps/reactivePropKinds.json`)

| Wert | Bovist | Korb |
|---|---|---|
| Auslösung | jeder Treffer ≥ 1 Schaden | jeder Treffer ≥ 1 Schaden |
| Vorlauf | 250 ms | 300 ms |
| Wirkung | 100 px, 5 s, 4 Schaden je 500 ms, Slow 40 % für 700 ms | 7 s Jagd, 230 px/s, Erfassung 420 px, Leine 720 px, 3 Schaden je 400 ms |
| Aufladen | 15 s | 15 s; Pflicht: mindestens Vorlauf + Jagd + Zerstreuen + Rückflug |

## 5. Platzierung

Die Strategie ist wie bei den Fässern: Engstellen auf den Gegnerrouten (`placement: "chokepoints"`).

| Bereich | Bovist | Korb |
|---|---|---|
| Kampagne | Karte 06 (`meadow`, neben den Fässern), Karten 15 und 20 (`void`): je 3 Gruppen à 1–2 | Karten 04, 07, 17: je 2 einzelne Körbe |
| Dawn | `pondland`: 3 Gruppen à 1–2 | `clearing`: 3 einzelne Körbe |
| Testkarte 00 | Anker (`meadow` und `void`) | ein Anker im offenen Gelände |

Der Map-Editor wählt das Kind beim Setzen eines Ankers. Jedes Kind hat einen eigenen Streueintrag.

## 6. Darstellung und Audio

- **Riesenbovist:** Blender-Assets `reactive-puffball-meadow` und `-void`. Clips:
  - `swell`: Vorlauf.
  - `burst`: Die Kappe reißt, der Pilz sackt zusammen, der braune Sporenkern wird sichtbar.
  - `refill`: Die Frames folgen dem Ladefortschritt.
- **Strohkorb:** Blender-Asset `reactive-bee-hive` (Wulstringe, Bindungen, Flugloch nach Süden, Holzbock). Clips:
  - `shake`: Vorlauf.
  - `release`: Einmal beim Ausschwärmen.
  - Beim Aufladen steht die Ruhepose.
- **Sporenwolke:** Der vorhandene GPU-Wolkenkörper bekommt eigene Paletten `puffball` und `puffball_hostile`. Dazu kommen GPU-Partikel und ein eigener Platz-Burst (radiale Staubstrahlen).
- **Bienen:** Prozeduraler SDF-Shader ohne Textur:
  - gestreifter Körper, schimmernde Flügel mit Bewegungsunschärfe, Glanzpunkt;
  - weiche Schattenpunkte;
  - fliegen im tiefen Flugband unter den Kronen;
  - 90/64/40 Bienen je Schwarm je nach Qualitätsstufe (User-Rückmeldung: der Schwarm muss groß und gut sichtbar sein), Wolkenradius etwa 50 px mit dichtem Kern;
  - ein warmer Flügel-Schleier lässt dichte Schwärme als eine Wolke lesen;
  - Bewegung: Jede Biene folgt ihrem eigenen Orbit um das geglättete Schwarmzentrum, Taucher stoßen auf das Ziel herab, neue Schwärme quellen aus dem Flugloch, heimkehrende strömen hinein.
- **Korblicht (L1):** Ein getroffener Korb leuchtet von innen.
  - Warmes Honiglicht im Lichtsystem (Preset `beeHiveGlow`, ohne Verdeckung) mit Mittelpunkt im Korb. Sein Radius reicht bis zum Schwarm, mindestens etwa 170 px und höchstens etwa 680 px. So ist der Bereich, in dem die Bienen jagen, auch nachts beleuchtet.
  - Über der Lichtkarte zieht ein emissiver GPU-Pass flackernde Strahlen durch die Strohritzen, am hellsten aus dem Flugloch.
  - Das Licht steigt im Vorlauf an und hält, solange der Schwarm draußen ist. Beim Rückflug wird es schwächer und erlischt weich, wenn die Bienen heimgekehrt sind. Bereite Körbe leuchten nicht.
- **One-Shots** spielen nur bei einem beobachteten Übergang, nie beim Late Join.
- **Audio:** Rezepte im Audio-Studio. Bis zur Freigabe durch den User laufen Platzhalter. Die Rezepte:

  | Rezept | Einsatz |
  |---|---|
  | `sfx_spore_puffball_burst` | Platzen des Bovists |
  | `sfx_bee_hive_release` | Ausschwärmen |
  | `sfx_bee_swarm_loop` | Schwarm-Loop, höchstens 2 gleichzeitig, kamera-nah |
  | `sfx_bee_sting` | Stich |
  | `sfx_bee_swarm_scatter` | Zerstreuen |

## 7. Technische Leitplanken

- **Vertrag und Aufladen:**
  - Lade-Kinds erweitern die V1-Unions: `priming: none`, `trigger: hit`, `integrity: indestructible`, `effect: dot_zone | swarm`, `afterEffect: recharge`.
  - Sie verlassen nie den Hindernis-ID-Raum und werden nie entfernt.
  - Während Vorlauf und Laden antworten sie `immune`.
- **Quelle der Folgewirkung:**
  - Sie trägt den erfassten Combat-Source des Auslösers.
  - Der Ursprung wird umgemarkt: `ground` für Sporen, `direct` für Stiche.
  - Kein Waffenslot, kein Teamschaden, eigene Lineage.
- **Sporenwolke:**
  - Sie ist eine reaktive Zone im vorhandenen `StinkCloudSystem` (Slice `sc`).
  - Der Spieler-Slow geht über den Laufgeschwindigkeits-Resolver des Hosts. Damit bleibt die Client-Vorhersage konsistent.
- **Bienenschwarm:**
  - World-scoped Host-Runtime.
  - Replikation je Schwarm, nicht je Biene, über die neue Slice `sw`. Clients berechnen die Einzelbienen deterministisch.
  - Explosionen beobachtet der Host an den radialen Einstiegen von `WorldCombatCore`.
- **Versionen:**
  - Peer-Protokoll 45.
  - Die Generator-Version bleibt, nur die Karteninhalte ändern sich.

## 8. Abnahme

| Gate | Inhalt | Stand |
|---|---|---|
| M1 | Vertrag, Runtime, Validator | offen |
| M2–M4 | Kampf-Plumbing, Sporenwolke, Bienen-Host, Replikation | offen |
| M5–M6 | Darstellung, Bienen-Shader, Blender-Assets (Draft → Produktion) | offen |
| M7–M8 | Platzierung, Map-Editor, Release-Checks, Review-Paket | offen |
