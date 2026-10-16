# Lokale Entwicklungsumgebung

## Geltungsbereich

Verifikation bleibt proportional zur Änderung. Der Repository-Root [AGENTS.md](../../AGENTS.md) ist die operative Quelle für die Prüfmatrix und die Sicherheitsregeln.

## Prüfpfade

- Kleine isolierte TypeScript-Änderungen: npm run typecheck.
- Ein getestetes Modul: npm test -- tests/Name.test.ts.
- Zwischenstand einer Lane: npm run check:quick; vor einem Fast-Forward nach main: npm run check:release (Stufen in [testing.md](testing.md#gestufte-gates)).
- Mehrere Module, Netzwerk, Lifecycle oder Build-Konfiguration: npm run check.
- Sichtbare Phaser- oder UI-Änderungen: npm run build; der Build enthält TypeScript.
- Änderungen an der bearbeitbaren AI-Skill-Quelle unter .ai/skills/ oder .ai/vendor/phaser-skills/: danach npm run ai:sync.

Es gibt kein allgemeines Lint-Script. Neue Test-, Browser- oder CI-Infrastruktur gehört nicht in eine normale Featureänderung.

## Test-Runner

`npm test` ist der schnelle Core-Gate. Die getrennten Spezial-Suites laufen über
`npm run test:architecture`, `npm run test:integration`, `npm run test:assets`,
`npm run test:stress` und `npm run test:balance-lab`. `npm run check` kombiniert Core,
schnelle Architecture-Suite, Spiel-Build und Map-Editor-Build;
die vollständige Testentscheidung und Schutzwertprüfung steht in
[testing.md](testing.md).

## Browser ist opt-in

Ohne ausdrückliche Aufforderung keinen Dev-Server, Browser oder Screenshot starten. Wenn eine Browserprüfung beauftragt ist, den projektspezifischen Start npm run dev:browser verwenden, auf HTTP 200 unter http://127.0.0.1:8090/ warten und keinen fremden Prozess beenden. Scheitert die Sichtprüfung wegen eines verborgenen Browser-Panes, als nicht verifiziert melden.

## Lane-Worktrees und Aufnahmen

- `npm run worktree:new -- <name> [--from main] [--merge <asset-branch>]` legt Worktree und Branch
  unter `../Fragdachse-worktrees/<name>` an, verlinkt `node_modules` als Junction auf den Haupt-Checkout
  (bei abweichendem `package-lock.json`: `npm ci`), stellt das Capture-Kit bereit und vergibt einen
  freien Vite-Port aus der Registry im Git-Common-Dir (ab 8098; 8090 nie).
- `npm run worktree:remove -- <name>` löst Junctions vor jedem Löschen, verweigert ungesicherte
  Änderungen und gibt den Port frei. Worktrees nie mit `Remove-Item -Recurse` oder `rm -rf` löschen:
  ein rekursives Löschen folgt der Junction in den Haupt-`node_modules`.
- [`tools/capture-kit/`](../../tools/capture-kit/README.md) nimmt beschriftete Dev-Szenario-Bögen
  headless auf (nur auf Auftrag, Browser-Opt-in gilt); `npm run board -- <board.json | Bilder>` setzt
  vorhandene PNGs zu einem Kontaktbogen mit Ausschnitt und Zoom zusammen.
- [`tools/latejoin/`](../../tools/latejoin/README.md) (`npm run latejoin`) prüft Replikation mit zwei
  echten Browsern über PeerJS/WebRTC: Host-Einsatz, später Client-Beitritt, Vergleich der replizierten
  Fakten und kein Nachspielen vergangener Effekte. Braucht Netz zum PeerJS-Broker. Neue
  Netzwerk-Features ergänzen dort eine Phase.
- [`tools/flight-recorder/`](../../tools/flight-recorder/README.md) (`npm run record:flight`) nimmt
  Bewegungen als Video, 1:1-Ausschnitte und Bahnplots auf (aktuell Bomberstaffel). Es ist die Vorlage
  für Bewegungsabnahmen, die sich an Standbildern nicht beurteilen lassen.

## Dokumentationsänderungen

Für ausdrücklich beauftragte Gameplay-Sichtprüfungen bietet der bestehende Dev-Server den
[Dev-Szenario-Modus](../dev-scenarios.md): isolierter Spielstand, direkter Map-/Loadout-Aufbau,
HTML-Eingaben, Zeitsteuerung und PNG-Ausgabe. Die Opt-in-Regel gilt unverändert.

Nach Markdown- oder Skill-Änderungen:

1. relative Links, Pfade und Symbolnamen mit rg beziehungsweise Test-Path prüfen;
2. veraltete Klassen, historische Versionsstände und konkrete Messwerte suchen;
3. git diff --check ausführen;
4. nur bei geänderten Skills die synchronisierten Spiegel prüfen.

Produktionscode wird nicht verändert, um eine veraltete Dokumentationsaussage zu erfüllen. Bei Widersprüchen gilt Quellcode, Types/Validatoren, Tests, authored Daten, dann docs/ai.
