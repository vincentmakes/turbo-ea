# Diagrammer

**Diagrammer**-modulet lader dig oprette **visuelle arkitekturdiagrammer** ved hjælp af en indlejret [DrawIO](https://www.drawio.com/)-editor — fuldt integreret med dit kortlager. Træk kort ind på lærredet, forbind dem med relationer, dril dig ned i hierarkier, og farv dem efter en hvilken som helst egenskab — diagrammet forbliver synkroniseret med dine EA-data.

![Diagramgalleri](../assets/img/en/16_diagrams.png)

## Diagramgalleri

Galleriet viser hvert diagram med en miniature, et navn, en type og de kort, det refererer til. Herfra kan du **oprette**, **åbne**, **redigere detaljer** eller **slette** et hvilket som helst diagram.

## Diagramredaktøren

Når du åbner et diagram, starter den fuldskærms DrawIO-editor i en same-origin iframe. Den oprindelige DrawIO-værktøjslinje er tilgængelig for figurer, forbindelser, tekst og layout — hver Turbo EA-handling eksponeres via højrekliks-kontekstmenuen, synkroniseringsknappen i værktøjslinjen og chevron-overlejringen, der ligger oven på hvert kort.

### Indsættelse af kort

Brug dialogen **Insert Cards** (åbnes fra værktøjslinjen eller højrekliks-menuen) til at føje kort til lærredet:

- Type-**chips med live-tællere** på venstre skinne filtrerer resultaterne.
- Søg efter navn på højre skinne; hver række har et afkrydsningsfelt.
- **Insert selected** tilføjer de valgte kort i et gitter; **Insert all** tilføjer hvert kort, der matcher det aktuelle filter (med et bekræftelsestrin ud over 50 resultater).

Den samme dialog åbnes i enkeltvalgstilstand for **Change Linked Card** og **Link to Existing Card**.

### Højrekliks-handlinger

- **Synkroniserede kort**: *Open Card*, *Change Linked Card*, *Unlink Card*, *Remove from diagram*.
- **Almindelige figurer / ulinkede celler**: *Link to Existing Card*, *Convert to Card* (bevarer figurens geometri, omdanner den til et afventende kort med figurens etikette som udgangspunkt), *Convert to Container* (omdanner figuren til en bane, så andre kort kan indlejres indeni).

### Expand-menuen

Hvert synkroniseret kort bærer en lille chevron-overlejring. Når du klikker på den, åbnes en menu med tre sektioner, hver fyldt på én rundtur:

- **Show Dependency** — naboer via udgående eller indgående relationer, grupperet efter relationstype med tællere. Hver række er et afkrydsningsfelt; bekræft med **Insert (N)**.
- **Drill-Down** — omdanner det aktuelle kort til en banecontainer med dets `parent_id`-børn indlejret indeni. Vælg hvilke børn der skal inkluderes, eller *Drill into all*.
- **Roll-Up** — pakker det aktuelle kort + udvalgte søskende (kort, der deler det samme `parent_id`) ind i en ny forældrecontainer.

Rækker med tæller = 0 er nedtonede, og naboer / børn, der allerede er på lærredet, springes automatisk over.

### Hierarki på lærredet

Containere svarer til et korts `parent_id`:

- **At trække et kort ind i** en container af samme type åbner *"Add «child» as a child of «parent»?"*. **Ja** kø-stiller en hierarkiændring; **Nej** snapper kortet tilbage.
- **At trække et kort ud af** en container beder om at afkoble (sætte `parent_id = null`).
- **Cross-type drops** snapper tilbage stille — hierarkiet er begrænset til kort af samme type.
- Alle bekræftede flytninger lander i **Hierarchy Changes**-spanden i synkroniseringsskuffen med *Apply*- og *Discard*-handlinger.

### Fjernelse af kort fra diagrammet

At slette et kort fra lærredet behandles som en **kun visuel** gestus — *"Jeg vil ikke se dette her"*. Kortet bliver i lageret; dets tilknyttede relationskanter forsvinder stille med det. Håndtegnede pile, der ikke er registrerede EA-relationer, fjernes aldrig automatisk. **Arkivering er en opgave for lagersiden**, ikke for diagrammet.

### Sletninger af kanter

At fjerne en kant, der bærer en rigtig relation, åbner *"Delete the relation between SOURCE and TARGET?"*:

- **Ja** kø-stiller sletningen i synkroniseringsskuffen; **Sync All** udsteder backend-kaldet `DELETE /relations/{id}`.
- **Nej** gendanner kanten på plads (stil og endepunkter bevares).

### Visningsperspektiver

Dropdownen **View** i værktøjslinjen omfarver hvert kort på lærredet efter en egenskab:

- **Card colors** (standard) — hvert kort bruger sin korttype-farve.
- **Approval status** — omfarver efter `approved` / `pending` / `broken`.
- **Field values** — vælg et hvilket som helst single-select-felt på de korttyper, der aktuelt er på lærredet (f.eks. *Lifecycle*, *Status*). Celler uden værdi falder tilbage til en neutral grå.

En flydende forklaring nederst til venstre på lærredet viser den aktive tilknytning. Den valgte visning gemmes med diagrammet.

### Synkroniseringsskuffe

Knappen **Sync** i værktøjslinjen åbner sideskuffen med alt, der er kø-stillet til næste synkronisering:

- **New Cards** — figurer konverteret til afventende kort, klar til at blive skubbet til lageret.
- **New Relations** — kanter tegnet mellem kort, klar til at blive oprettet i lageret.
- **Removed Relations** — relationskanter slettet fra lærredet, kø-stillet til `DELETE /relations/{id}`. *Keep in inventory* genindsætter kanten.
- **Hierarchy Changes** — bekræftede træk-ind / træk-ud container-flytninger, kø-stillet som `parent_id`-opdateringer.
- **Inventory Changed** — kort opdateret i lageret, siden diagrammet blev åbnet, klar til at blive trukket tilbage på lærredet.

Synkroniseringsknappen i værktøjslinjen viser en pulserende "N usynkroniseret"-pille, når der findes afventende arbejde. At forlade fanen med usynkroniserede ændringer udløser en browseradvarsel, og lærredet gemmes automatisk i lokalt lager hvert femte sekund, så en utilsigtet opdatering kan gendannes ved genåbning.

### Linke diagrammer til kort

Diagrammer kan linkes til **et hvilket som helst kort** fra kortets fane **Resources** (se [Kortdetaljer](card-details.md#resources-tab)). Når et diagram er linket til et **Initiative**-kort, vises det også i [EA Delivery](delivery.md)-modulet sammen med SoAW-dokumenter.
