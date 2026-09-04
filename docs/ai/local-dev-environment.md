# Lokale Entwicklungsumgebung

## Geltungsbereich

Verifikation bleibt proportional zur Änderung. Der Repository-Root [AGENTS.md](../../AGENTS.md) ist die operative Quelle für die Prüfmatrix und die Sicherheitsregeln.

## Prüfpfade

- Kleine isolierte TypeScript-Änderungen: npm run typecheck.
- Ein getestetes Modul: npm test -- tests/Name.test.ts.
- Mehrere Module, Netzwerk, Lifecycle oder Build-Konfiguration: npm run check.
- Sichtbare Phaser- oder UI-Änderungen: npm run build; der Build enthält TypeScript.
- Änderungen an der bearbeitbaren AI-Skill-Quelle unter .ai/skills/ oder .ai/vendor/phaser-skills/: danach npm run ai:sync.

Es gibt kein allgemeines Lint-Script. Neue Test-, Browser- oder CI-Infrastruktur gehört nicht in eine normale Featureänderung.

## Test-Runner

`npm test` ist der schnelle Core-Gate. Die getrennten Spezial-Suites laufen über
`npm run test:architecture`, `npm run test:integration`, `npm run test:assets`,
`npm run test:stress` und `npm run test:balance-lab`. `npm run check` kombiniert Core,
schnelle Architecture-Suite und Build;
die vollständige Testentscheidung und Schutzwertprüfung steht in
[testing.md](testing.md).

## Browser ist opt-in

Ohne ausdrückliche Aufforderung keinen Dev-Server, Browser oder Screenshot starten. Wenn eine Browserprüfung beauftragt ist, den projektspezifischen Start npm run dev:browser verwenden, auf HTTP 200 unter http://127.0.0.1:8090/ warten und keinen fremden Prozess beenden. Scheitert die Sichtprüfung wegen eines verborgenen Browser-Panes, als nicht verifiziert melden.

## Dokumentationsänderungen

Nach Markdown- oder Skill-Änderungen:

1. relative Links, Pfade und Symbolnamen mit rg beziehungsweise Test-Path prüfen;
2. veraltete Klassen, historische Versionsstände und konkrete Messwerte suchen;
3. git diff --check ausführen;
4. nur bei geänderten Skills die synchronisierten Spiegel prüfen.

Produktionscode wird nicht verändert, um eine veraltete Dokumentationsaussage zu erfüllen. Bei Widersprüchen gilt Quellcode, Types/Validatoren, Tests, authored Daten, dann docs/ai.
