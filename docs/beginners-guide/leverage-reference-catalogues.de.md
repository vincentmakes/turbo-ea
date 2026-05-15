# Referenzkataloge nutzen

Der klassische Fehler in dieser Phase: drei Wochen mit Workshops zu einem maßgeschneiderten Business-Capability-Modell verbringen, zwei weitere Wochen mit der Abstimmung mit der Geschäftsleitung — und dann feststellen, dass das Modell zu 80 % identisch mit dem ist, was jedes andere Unternehmen Ihrer Branche verwendet.

**Modellieren Sie nicht von Grund auf.** Turbo EA wird mit drei kuratierten Katalogen geliefert, die Ihnen einen kampferprobten Ausgangspunkt bieten, den Sie in Tagen statt Monaten anpassen können:

- **Business Capability Catalogue** — mehrstufige Capability-Hierarchien pro Branche (Banking, Retail, Manufacturing, Versicherung, öffentlicher Sektor usw.) plus branchenübergreifende Macro Capabilities.
- **Process Catalogue** — Referenzgeschäftsprozesse pro Branche, bereit zum Import als `BusinessProcess`-Karten.
- **Value Stream Catalogue** — End-to-End-Wertströme, um die Capability Map einzurahmen.

Diese Seite konzentriert sich auf den Business Capability Catalogue, weil er die Capability Heatmap auf der letzten Seite antreibt. Die anderen beiden funktionieren auf die gleiche Weise.

## Warum mit Capabilities beginnen

Eine **Business Capability** ist *was das Geschäft tut*, ausgedrückt in stabiler, technologieunabhängiger Sprache — „Order Management", „Customer Onboarding", „Claims Handling". Capabilities ändern sich im Laufe der Jahre kaum; Anwendungen ändern sich ständig. Deshalb ist die Zuordnung von Anwendungen zu Capabilities die nützlichste einzelne Beziehung im gesamten Metamodell:

- Sie ermöglicht es Ihnen zu fragen **„Wie viele Anwendungen unterstützen Customer Onboarding?"** — und Redundanz zu erkennen.
- Sie ermöglicht es Ihnen zu fragen **„Welche Capabilities hängen von einer einzigen alternden Anwendung ab?"** — und Fragilität zu erkennen.
- Sie überlebt Reorganisationen, Vendor-Wechsel und Cloud-Migrationen.

Sie brauchen keine 500 Capabilities, um Wert zu erzielen. Sie brauchen **20–60 Capabilities, zwei oder drei Ebenen tief**, in Ihrem Geltungsbereich.

## Importieren Sie eine Starter-Capability-Map

1. Navigieren Sie zu **Capability Catalogue** im Hauptmenü (unter User Guide).
2. Verwenden Sie die Filter oben:
    - **Branche** — wählen Sie Ihre (oder „Branchenübergreifend", wenn nichts passt).
    - **Ebene** — beginnen Sie mit sichtbarem L1 und L2. Sie können später immer tiefer gehen.
3. Durchsuchen Sie den Baum. Erweitern Sie ein paar Zweige, um ein Gefühl für die Tiefe zu bekommen.
4. Setzen Sie Häkchen bei den Capabilities, die Sie importieren möchten. **Die Auswahl kaskadiert**: Das Anklicken einer L1 klickt ihre Nachkommen an; das Anklicken einer L2 klickt auch ihren L1-Vorfahren an, damit die Hierarchie verbunden bleibt.
5. Klicken Sie auf **Karten aus Auswahl erstellen**.

Turbo EA erstellt eine `BusinessCapability`-Karte pro angeklicktem Knoten, bewahrt die Eltern-Kind-Hierarchie und stempelt jede Karte mit einer stabilen `catalogueId`, sodass erneute Importe **idempotent** sind — das zweimalige Ausführen des Imports erzeugt keine Duplikate.

Vollständige Referenz: [Capability Catalogue](../guide/capability-catalogue.md).

!!! tip "Bewährte Praxis"
    Wählen Sie einen Teilbaum, nicht den gesamten Katalog. Für eine Anwendungsportfolio-Rationalisierung in der Vertriebsdomäne reicht der Import der L1-Capability „Sales & Customer Management" plus ihrer L2-Kinder normalerweise aus — das sind 10–15 Capabilities, nicht 300.

## Wie tief gehen

Die richtige Tiefe hängt davon ab, was Sie damit tun werden:

| Tiefe | Wann verwenden | Typische Kartenanzahl |
|-------|------------|--------------------|
| **Nur L1** | Zusammenfassungen auf Geschäftsleitungsebene, sehr kleine Geltungsbereiche | 8–12 |
| **L1 + L2** | Der Sweet Spot für einen ersten Rollout — lesbar auf einem Bildschirm, nützlich in Berichten | 30–60 |
| **L1 + L2 + L3** | Detaillierte Capability-basierte Planung, große Unternehmen | 100–250 |
| **L4 und tiefer** | Spezifische Deep Dives, nicht für eine Ausgangsbasis | variiert |

Gehen Sie für Ihren ersten Durchgang auf **L1 + L2**. Sie können später immer zusätzliche Ebenen über denselben Katalog importieren — der idempotente Re-Import fügt sie unter den bestehenden Eltern ein.

## Ein Wort zu Prozessen und Wertströmen

Der **Process Catalogue** und der **Value Stream Catalogue** funktionieren auf die gleiche Weise: filtern, ankreuzen, in Masse erstellen. Wenn Ihr erster Anwendungsfall die Anwendungsportfolio-Rationalisierung ist, können Sie sie vorerst überspringen — die Capability-Zuordnung reicht aus, um die Analyse auf der letzten Seite anzutreiben.

Sie werden sie wollen, wenn:

- Sie von „Anwendungen rationalisieren" zu „den Order-to-Cash-Wertstrom optimieren" übergehen.
- Sie beginnen, BPMN-Prozessabläufe auf den resultierenden `BusinessProcess`-Karten zu erstellen (siehe [BPM](../guide/bpm.md)).

## Was, wenn meine Branche nicht im Katalog ist?

Zwei Optionen:

1. **Wählen Sie die nächstgelegene Branche** und beschneiden Sie. Die Einträge „Branchenübergreifend" (Finanzen, HR, IT, Beschaffung) gelten für praktisch jedes Unternehmen.
2. **Kataloge kombinieren** — importieren Sie zuerst „Branchenübergreifend", dann ergänzen Sie mit ein paar Elementen aus einem bestimmten Branchenkatalog.

So oder so: **Zuerst importieren, dann anpassen**. Eine importierte Capability umzubenennen oder ein Kind hinzuzufügen ist viel schneller, als die gesamte Struktur von Grund auf einzutippen. Und Sie behalten die `catalogueId`, sodass zukünftige Katalogupdates sauber zusammengeführt werden.

!!! warning "Nicht tun"
    Erstellen Sie keine benutzerdefinierten Kartentypen für Capabilities oder Prozesse, nur „um sie sich zu eigen zu machen". Die integrierten Typen kommen mit den richtigen Feldern, den richtigen Beziehungstypen und den richtigen Berichten — benutzerdefinierte Äquivalente nicht.

## Vor dem Weitergehen überprüfen

Sie sind mit dieser Seite fertig, wenn:

- Die Capability Map für Ihren Geltungsbereich im Inventar vorhanden ist (filtern Sie nach Type = `Business Capability`).
- Die Hierarchie intakt ist — öffnen Sie ein paar L2-Capabilities und prüfen Sie, ob die Eltern-Breadcrumb die richtige L1 anzeigt.
- Die Capability-Anzahl zwischen 20 und 60 liegt.

Sie haben noch keine Anwendungen Capabilities zugeordnet — das kommt auf der letzten Seite. Zuerst fügen wir den Anwendungen ein benutzerdefiniertes Feld hinzu, um die Analyse wirklich nützlich zu machen.

Weiter: [Metamodell anpassen — behutsam](customise-the-metamodel.md).
