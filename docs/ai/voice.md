# Persönliche Stimmen

## Produktions- und Laufzeitgrenze

Die eigenständige [Voice-Werkstatt](../../tools/voice-workshop/README.md) besitzt
Referenzen, Transkripte, Zustimmungen, Satzrevisionen, Generierungsaufträge und
Hörentscheidungen. Cloning-Modus und Eingaben werden beim Einreihen eingefroren.
Änderungen an Satz oder Referenz entwerten Entwürfe, nicht veröffentlichte Pakete.
Das Spiel kennt weder Generator noch private Produktionsdaten.

[VoicePackage](../../src/voice/VoicePackage.ts) ist der gemeinsame strikte
Laufzeitvertrag für Export und Import: versioniertes Manifest, Hash-Identität und
OGG/Vorbis-Clips. Zusätzliche Felder werden zurückgewiesen. Referenz-/Workflowdaten
gehören nicht in das Manifest. [VoiceLibrary](../../src/voice/VoiceLibrary.ts)
validiert Pakete vor der IndexedDB-Ablage. Die Profilzuordnung ist die exakte
Paketprüfsumme; fehlende Pakete erzeugen keine Ersatzstimme. Audio wird mit dem
Spiel ausgeliefert oder optional manuell importiert, nicht über Spiel-RPCs verteilt.

Die Werkstatt schreibt bei „Ins Spiel übernehmen“ ausschließlich validierte
Laufzeitpakete nach `src/voice/bundled/<voiceId>.fdvoice`; pro Stimme ersetzt eine
neue Version die Build-Quelle. [BundledVoices](../../src/voice/BundledVoices.ts)
lädt diese von Vite erfassten Datenmodule in die VoiceLibrary, unabhängig von
IndexedDB. Mitgelieferte Pakete gehören dem Build und sind nicht über die lokale
Import-Löschfunktion entfernbar. Versionswechsel ändern gespeicherte
Profilprüfsummen nicht automatisch.

## Autorität und Lebensdauer

[VoiceRuntime](../../src/voice/VoiceRuntime.ts) lebt mit der Scene; Rundenzuordnungen
und Beobachter wechseln an Scope-Grenzen. Die
[Arena-Komposition](../../src/scenes/arena/ArenaVoiceComposition.ts) verbindet sie
mit dem NetworkBridge. Laufende Runden frieren bestehende Profilzuordnungen ein.
Der Host erzeugt fachliche Kandidaten und entscheidet über
[VoiceDirector](../../src/voice/VoiceDirector.ts) Sprecher und konkreten Clip.
Die Werkstatt-Vorschau verwendet dieselbe Regie. Effektive Schadensmeldungen kommen
erst nach den Gegner-/Trainings-/Eigenbeschussfiltern des World-Combat-Bindings.

Voice-RPCs müssen vom tatsächlichen Host stammen und zur World gehören; die
Audiowiedergabe prüft zusätzlich Rundenscope, Sequenz und Ablaufzeit. Es gibt keinen
Historien-Replay für Late Join oder gesperrtes Browseraudio. Ein bereits im gültigen
Scope angenommener Siegspruch darf den Wechsel in Ergebnis/Lobby zu Ende führen;
ein eingehendes altes World-Ereignis wird dadurch nicht gültig.

[VoiceAudioChannel](../../src/voice/VoiceAudioChannel.ts) nutzt den bestehenden
AudioContext mit eigener Lautstärke und begrenztem Decode-Speicher. Stummschalten,
versteckte Tabs und Scene-Teardown stoppen die Ausgabe. Sprache konkurriert nicht
mit dem Effekt-Voice-Pool und beeinflusst keine Gameplay-Entscheidungen.

Vertragstests: [Regie/Runtime](../../tests/VoiceDirector.test.ts),
[Audio](../../tests/VoiceAudioChannel.test.ts),
[Netzwerk](../../tests/integration/GameplayAudioNetwork.test.ts),
[Werkstatt](../../tools/voice-workshop/tests/workshop.test.mjs).
