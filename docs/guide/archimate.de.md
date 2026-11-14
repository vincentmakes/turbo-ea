# ArchiMate-Diagramme

Der **ArchiMate**-Editor zeichnet [ArchiMate-3](https://pubs.opengroup.org/architecture/archimate3-doc/)-Diagramme auf Basis Ihrer Karten: Sie platzieren Elemente der Standardnotation (Business Process, Application Component, Node usw.), verbinden sie mit den Beziehungen, die die Sprache erlaubt, und verknüpfen jedes Element auf Wunsch mit einer Karte Ihres Inventars. Ein Diagramm wird als **ArchiMate Model Exchange File** gespeichert (das XML-Format der Open Group, Version 3.1) und lässt sich daher mit anderen ArchiMate-Werkzeugen austauschen.

!!! warning "Status der Version"
    Diese Version liefert die ArchiMate-Grundlage als **Sandbox für Administratoren**. Das Modul ist standardmäßig deaktiviert, die Diagramme erscheinen nicht im Menü [Diagramme](diagrams.md) und können noch nicht veröffentlicht oder eingebettet werden. Siehe [Bekannte Einschränkungen](#known-limits).

Die obere Zeile zeigt den Diagrammnamen, Kartenfarben, Karteninhalte und Synchronisierung. Die Synchronisierung aktualisiert Daten verknüpfter Karten. Die untere Zeile enthält Zeichenwerkzeuge, Zoom, SVG-Export und das Eigenschaftenfenster. Über **Punktraster** blenden Sie die Punkte im Hintergrund ein oder aus. Der Browser speichert Ihre Auswahl für jedes Diagramm.

## Das Modul aktivieren

1. Öffnen Sie **Admin → Einstellungen** und suchen Sie die Kachel **ArchiMate-Diagramme** (neben den anderen Modulschaltern).
2. Schalten Sie sie ein. Die Kachel zeigt **ArchiMate ist aktiv**.
3. Sie können sie jederzeit wieder ausschalten. Die Diagramme bleiben erhalten; solange das Modul ausgeschaltet ist, sind die Seiten nicht erreichbar, und wer einem direkten Link folgt, sieht den üblichen Platzhalter „Modul deaktiviert“.

## Die Sandbox öffnen

Solange das Modul aktiv ist, werden ArchiMate-Diagramme über die Seite **Diagramme** und über den Reiter **Ressourcen** jeder Karte erstellt und geöffnet, die sie referenzieren. `/admin/architectureStudio` ist weiterhin die Liste Ihrer ArchiMate-Diagramme, in der Sie sie erstellen, öffnen und löschen können; dafür sind eine Berechtigung auf mindestens einer ArchiMate-Ebene und das aktivierte Modul nötig. Im Editor führt **Zurück** zur Seite, von der Sie gekommen sind.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## Ihr erstes Diagramm

1. Geben Sie in der Sandbox unter **Neues ArchiMate-Diagramm** einen **Namen** ein und klicken Sie auf **Erstellen**. Der Editor öffnet sich.
2. **Elemente ablegen.** Die Palette listet die Elementtypen nach Schicht gruppiert auf (Strategie, Geschäft, Anwendung, Technologie, Physisch, Motivation, Implementierung & Migration, Sonstige). Ziehen Sie einen Eintrag auf die Zeichenfläche oder nutzen Sie die Tastatur: Wechseln Sie zu einem Eintrag und drücken Sie **Enter** oder **Space**, um das Element in der Mitte des sichtbaren Bereichs abzulegen. Ein neues Element öffnet seinen Namen sofort zur Bearbeitung.
3. **Eine Beziehung zeichnen.** Wählen Sie ein Element aus: Das Kontextfeld um das Element bietet Einträge **Zeichnen** *Beziehung* an. Wählen Sie einen aus und klicken Sie dann auf das Zielelement. Verbunden werden können nur Paare, die die ArchiMate-Beziehungstabelle erlaubt: Ein Eintrag wird nur angeboten, wenn die Sprache diese Beziehung von diesem Element zu mindestens einem Elementtyp zulässt, und ein Ziel, das die Tabelle nicht erlaubt, wird abgelehnt. Wählen Sie eine Verbindung aus, um ihre **Zugriffsart** (bei Access) oder ihre Richtung (bei Association) zu ändern.
4. **Ein Element mit einer Karte verknüpfen.** Wählen Sie das Element aus und nutzen Sie das Kontextfeld:
    - **Mit einer Karte verknüpfen** öffnet eine Auswahl, die auf die Kartentypen beschränkt ist, die diesem Elementtyp zugeordnet sind (siehe [Die Zuordnung](#mapping)).
    - **Eine Karte erstellen** fragt nach einem Kartentyp und einem Namen, erstellt die Karte und verknüpft sie in einem Schritt.
    - **Verknüpfte Karte öffnen** und **Verknüpfung mit der Karte aufheben** erscheinen, sobald eine Karte verknüpft ist.

    Verknüpfungen sind immer ausdrücklich. Das Ablegen eines Elements erstellt **nie** eine Karte, und das Entfernen eines Elements aus dem Diagramm (**Aus dem Diagramm entfernen**) löscht **nie** eine Karte. Beim Speichern wird die Menge der Karten, mit denen das Diagramm verknüpft ist, synchronisiert, wie bei anderen Diagrammen.
5. **Speichern.** Der Editor speichert drei Sekunden nach Ihrer letzten Änderung von selbst; die Schaltfläche **Speichern** speichert sofort. Der Status zeigt *Wird gespeichert…*, *Gespeichert* oder *Nicht gespeicherte Änderungen*.

!!! warning "Ein fehlgeschlagenes Speichern bleibt sichtbar"
    Schlägt das Speichern fehl, bleibt der Fehler mit einer Schaltfläche **Erneut versuchen** sichtbar, das Diagramm bleibt als ungespeichert markiert, und nichts wird stillschweigend verworfen. Wer die Seite verlässt (Tab schließen, die Zurück-Schaltfläche des Browsers nutzen oder eine andere Seite der Anwendung öffnen), während ungespeicherte oder fehlgeschlagene Änderungen vorliegen, wird zuerst um Bestätigung gebeten.

## Die Zuordnung {#mapping}

Die **Zuordnung** (Mapping) legt fest, welchem ArchiMate-Konzept ein Kartentyp, Untertyp oder Beziehungstyp von Turbo EA entspricht. Der Editor liest sie, um zu entscheiden, welche Karten mit welchem Element verknüpft werden können. Jeder Kartentyp, Untertyp und Beziehungstyp trägt einen ArchiMate-Element- bzw. Beziehungstyp; eine Beziehung trägt zusätzlich ein **Richtungs-Flag** (ist es gesetzt, wird die ArchiMate-Beziehung von der Zielkarte zur Quellkarte gezeichnet; zum Beispiel ist „Organisation *nutzt* Anwendung“ eine ArchiMate-Beziehung *Serving* von der Anwendung zur Organisation) und bei Access eine **Zugriffsart**.

!!! note
    In dieser Version ist die Zuordnung **schreibgeschützt**: Sie enthält die unten gezeigten Standardwerte. Der Administrationsbildschirm zum Ändern (**ARCHI MAP** unter **Admin → Metamodell**) folgt später. Diese Version erstellt oder ändert keine Kartenbeziehungen aus einer gezeichneten Beziehung.

Die Namen der Elemente und Beziehungen sind die des Austauschformats der Open Group. Ein Kartentyp mit leerem Element (`—`) hat keine Standardzuordnung; seine Karten lassen sich daher erst verknüpfen, wenn ein Elementtyp festgelegt ist. Ein Untertyp verwendet seine eigene Zuordnung, falls vorhanden, sonst die des Kartentyps.

### Kartentypen und Untertypen

| Kartentyp | ArchiMate-Element |
|---|---|
| Ziel | `Goal` |
| Ziel › Geschäftsziel | `Goal` |
| Ziel › Value Gate | `Assessment` |
| Plattform | `Grouping` |
| Initiative | `WorkPackage` |
| Organisation | `BusinessActor` |
| Organisation › Region | `Location` |
| Geschäftsfähigkeit | `Capability` |
| Geschäftskontext | — |
| Geschäftskontext › Prozess | `BusinessProcess` |
| Geschäftskontext › Wertstrom | `ValueStream` |
| Geschäftskontext › Customer Journey | `BusinessProcess` |
| Geschäftskontext › Geschäftsprodukt | `Product` |
| Geschäftskontext › ESG-Fähigkeit | `Capability` |
| Geschäftsprozess | `BusinessProcess` |
| Geschäftsprozess › Prozesskategorie | `BusinessFunction` |
| Geschäftsprozess › Prozessgruppe | `BusinessFunction` |
| Anwendung | `ApplicationComponent` |
| Schnittstelle | `ApplicationInterface` |
| Datenobjekt | `BusinessObject` |
| IT-Komponente | `Node` |
| IT-Komponente › Software | `SystemSoftware` |
| IT-Komponente › Hardware | `Device` |
| IT-Komponente › SaaS | `TechnologyService` |
| IT-Komponente › PaaS | `TechnologyService` |
| IT-Komponente › IaaS | `TechnologyService` |
| IT-Komponente › Dienst | `TechnologyService` |
| IT-Komponente › KI-Modell | `SystemSoftware` |
| Technologiekategorie | `Grouping` |
| Anbieter | `BusinessActor` |

### Beziehungstypen

Bei einer Access-Beziehung bedeutet `crud`, dass die Zugriffsart den Create/Read/Update/Delete-Flags der Beziehung selbst folgt: nur Lesen ergibt Read, jedes Erstellen, Aktualisieren oder Löschen ergibt Write, beides ergibt Read/Write und keines ergibt einfaches Access. Beziehungen „folgt auf“ gibt es für jeden Kartentyp, der sie hat, und sie werden auf Association abgebildet, außer der von Business Context, die eine eigene Zeile in der Tabelle hat.

| Relation | ArchiMate-Beziehung | Hinweis |
|---|---|---|
| Ziel → Geschäftsfähigkeit, *verbessert* | `Association` | — |
| Plattform → Ziel, *unterstützt* | `Influence` | — |
| Plattform → Anwendung, *betreibt* | `Aggregation` | — |
| Plattform → IT-Komponente, *implementiert* | `Aggregation` | — |
| Initiative → Ziel, *unterstützt* | `Influence` | — |
| Initiative → Plattform, *beeinflusst* | `Association` | — |
| Initiative → Geschäftsfähigkeit, *verbessert* | `Association` | — |
| Initiative → Anwendung, *beeinflusst* | `Association` | — |
| Initiative → Schnittstelle, *beeinflusst* | `Association` | — |
| Initiative → Datenobjekt, *beeinflusst* | `Association` | — |
| Initiative → IT-Komponente, *beeinflusst* | `Association` | — |
| Organisation → Ziel, *besitzt* | `Association` | — |
| Organisation → Initiative, *besitzt* | `Assignment` | — |
| Organisation → Geschäftskontext, *besitzt* | `Association` | — |
| Organisation → Anwendung, *nutzt* | `Serving` | vom Ziel zur Quelle gezeichnet |
| Organisation → IT-Komponente, *besitzt* | `Association` | — |
| Anwendung → Geschäftsfähigkeit, *unterstützt* | `Realization` | — |
| Anwendung → Geschäftskontext, *unterstützt* | `Association` | — |
| Anwendung → Schnittstelle, *stellt bereit / konsumiert* | `Association` | — |
| Anwendung → Datenobjekt, *CRUD* | `Access` | Zugriffsart aus den CRUD-Flags |
| Anwendung → IT-Komponente, *nutzt* | `Serving` | vom Ziel zur Quelle gezeichnet |
| IT-Komponente → Technologiekategorie, *gehört zu* | `Aggregation` | vom Ziel zur Quelle gezeichnet |
| IT-Komponente → Plattform, *implementiert* | `Aggregation` | vom Ziel zur Quelle gezeichnet |
| Schnittstelle → Datenobjekt, *überträgt* | `Association` | — |
| Schnittstelle → IT-Komponente, *nutzt* | `Association` | — |
| Anbieter → Initiative, *unterstützt* | `Association` | — |
| Anbieter → Anwendung, *bietet an* | `Association` | — |
| Anbieter → IT-Komponente, *bietet an* | `Association` | — |
| Geschäftskontext → Geschäftsfähigkeit, *ist verknüpft mit* | `Association` | — |
| Geschäftsprozess → Geschäftsfähigkeit, *unterstützt* | `Realization` | — |
| Geschäftsprozess → Anwendung, *wird unterstützt von* | `Serving` | vom Ziel zur Quelle gezeichnet |
| Geschäftsprozess → Datenobjekt, *nutzt* | `Access` | Zugriffsart aus den CRUD-Flags |
| Geschäftsprozess → IT-Komponente, *nutzt* | `Serving` | vom Ziel zur Quelle gezeichnet |
| Geschäftsprozess → Geschäftsprozess, *hängt ab von* | `Association` | — |
| Geschäftsprozess → Geschäftsprozess, *ruft auf* | `Triggering` | — |
| Geschäftsprozess → Organisation, *gehört zu* | `Assignment` | vom Ziel zur Quelle gezeichnet |
| Geschäftsprozess → Initiative, *wird beeinflusst von* | `Association` | — |
| Geschäftsprozess → Ziel, *unterstützt* | `Influence` | — |
| Geschäftsprozess → Geschäftskontext, *realisiert* | `Realization` | — |
| Ziel → Geschäftskontext, *ist Ziel für* | `Association` | — |
| Geschäftskontext → Geschäftskontext, *folgt auf* | `Triggering` | vom Ziel zur Quelle gezeichnet |

Klicken Sie mit der rechten Maustaste auf eine Verbindungslinie und wählen Sie **Gerade** oder **Rechtwinklig**. Die Linienführung bleibt beim Verschieben eines Knotens sowie nach dem Speichern und erneuten Öffnen des Diagramms erhalten.

## Die Exchange-Datei {#exchange-file}

Die Symbolleiste bietet **Als Exchange-Datei exportieren** und **Exchange-Datei importieren** sowie **Als SVG exportieren** für ein Bild.

- **Export** lädt das Diagramm als ArchiMate Model Exchange File herunter (`.xml`, Format 3.1).
- **Import** ersetzt nach einer Bestätigung (**Diagramm ersetzen?**) den gesamten Inhalt des geöffneten Diagramms. Mit anderen Werkzeugen (etwa Archi) erstellte Diagramme lassen sich lesen, wenn sie dem Format der Open Group folgen.
- Dateien über 5 MB werden abgelehnt, ebenso Dateien mit einer DOCTYPE- oder Entity-Deklaration.

**Was beim Import nicht erhalten bleibt:**

- **Ordner** (der Abschnitt `organizations`): Sie werden verworfen, und der Editor weist darauf hin.
- **Notizen, Gruppen und einfache Verbindungen** aus anderen Werkzeugen: Beschriftungen und Container ohne dahinterliegendes Element sowie Verbindungen ohne Beziehung werden ignoriert.
- **Eigenschaftstypen außer string**: Jede Eigenschaftsdefinition wird als Zeichenkette gelesen.
- **Andere Sprachen eines Namens**: Pro Element, Beziehung und Ansicht bleibt nur ein Name erhalten.
- Schriftarten und weitere Formatierungen über das Grundlegende hinaus bleiben nicht erhalten.

## Das Modell prüfen

Die Schaltfläche **Modell prüfen** in der Symbolleiste sendet das aktuelle Diagramm an den Server, der es gegen die Austauschregeln der Open Group validiert und jedes gefundene Problem auflistet (höchstens 100). Jede Meldung hat einen Code; das Zeichen `…` steht für den betroffenen Namen oder Bezeichner:

| Code | Meldung |
|---|---|
| `too_large` | Das Modell ist größer als 5 MB. |
| `xml_invalid` | Das Modell ist kein wohlgeformtes XML. |
| `dtd_forbidden` | DOCTYPE- und Entity-Deklarationen sind nicht erlaubt. |
| `wrong_root` | Das Wurzelelement ist kein ArchiMate-Modell. |
| `missing_identifier` | Ein Element, eine Beziehung oder ein Diagrammknoten hat keinen Bezeichner. |
| `unknown_element_type` | Unbekannter Elementtyp: … |
| `unknown_relationship_type` | Unbekannter Beziehungstyp: … |
| `unknown_access_type` | Unbekannter Zugriffstyp bei … |
| `duplicate_identifier` | Doppelter Bezeichner: … |
| `dangling_source` | Die Beziehung … geht von etwas aus, das nicht existiert. |
| `dangling_target` | Die Beziehung … endet bei etwas, das nicht existiert. |
| `relationship_not_allowed` | ArchiMate erlaubt die Beziehung … nicht: weder zwischen diesen beiden Elementen noch von einer Beziehung zu sich selbst. |
| `dangling_element_ref` | Der Diagrammknoten … zeigt ein Element, das nicht existiert. |
| `dangling_relationship_ref` | Die Diagrammverbindung … zeigt eine Beziehung, die nicht existiert. |
| `connection_endpoint_mismatch` | Die Diagrammverbindung … verbindet nicht die Knoten ihrer Beziehung. |

Die Beziehungsprüfung lehnt außerdem eine Beziehung ab, die auf eine andere Beziehung zeigt, es sei denn, es ist eine Association, Aggregation oder Composition. Gibt es nichts zu melden, zeigt das Dialogfeld **Keine Probleme gefunden.**

## Tastenkürzel

Klicken Sie in der Symbolleiste auf **Tastenkürzel**, um die Liste zu sehen. Klicken Sie zuerst auf die Zeichenfläche, damit sie den Fokus hat.

| Aktion | Kürzel |
|--------|--------|
| Rückgängig | `Ctrl+Z` |
| Wiederholen | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Kopieren | `Ctrl+C` |
| Einfügen | `Ctrl+V` |
| Löschen | `Delete` / `Backspace` |
| Umbenennen | `F2` / `Enter` |
| Alles auswählen | `Ctrl+A` |
| Vergrößern | `Ctrl++` |
| Verkleinern | `Ctrl+-` |
| An Bildschirm anpassen | `Ctrl+0` |

In der Palette legt `Enter` oder `Space` auf einem fokussierten Eintrag dieses Element ab.

## Bekannte Einschränkungen {#known-limits}

- **Pro Datei wird eine Ansicht bearbeitet.** Enthält eine importierte Datei mehrere Ansichten, wird die erste bearbeitet; die übrigen bleiben beim Speichern unverändert erhalten.
- **Beziehungen zwischen Beziehungen** (eine Association, Aggregation oder Composition, die auf eine andere Beziehung zeigt) werden gelesen und geschrieben, und die Prüfung akzeptiert sie, sie werden aber nicht gezeichnet.
- **Das Zeichnen einer Beziehung erfordert die Maus.** Mit der Tastatur lassen sich Elemente ablegen, aber nicht verbinden.
- **Ablegen per Tastatur stapelt.** Jedes mit `Enter` oder `Space` abgelegte Element landet in der Mitte des sichtbaren Bereichs, aufeinanderfolgende Elemente überlagern sich also, bis Sie sie verschieben.
- **Noch keine Veröffentlichung.** ArchiMate-Diagramme können nicht veröffentlicht oder eingebettet werden und erscheinen nicht im Menü **Diagramme**; Sie erreichen sie über die Sandbox-Liste oder über den Reiter **Ressourcen** einer Karte, die sie referenzieren.
- **Verbindungsknoten (Junctions) haben keine Beschriftung.** Ein And- oder Or-Verbindungsknoten ist ein einfacher Punkt.
- Die Zuordnung ist schreibgeschützt (siehe [Die Zuordnung](#mapping)), und Ordner werden beim Import verworfen (siehe [Die Exchange-Datei](#exchange-file)).

---

ArchiMate® ist eine eingetragene Marke von The Open Group. Turbo EA zeichnet die ArchiMate-Notation und ist nicht von The Open Group zertifiziert.
