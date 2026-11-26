# Langues personnalisées

Turbo EA est livré avec dix langues intégrées. Lorsque votre organisation en a besoin d'une autre — néerlandais, polonais, hébreu, hindi, thaï, une variante régionale comme le portugais brésilien —, un administrateur peut l'ajouter comme **langue personnalisée** et renseigner ses traductions sans attendre une nouvelle version.

Une langue personnalisée vit dans votre base de données, pas dans le code de l'application. Vous l'ajoutez, la traduisez, la vérifiez, puis la proposez à vos utilisateurs quand elle est prête. Les langues intégrées ne sont pas affectées.

Une langue personnalisée couvre toute l'interface utilisateur **et** les noms que votre métamodèle donne aux éléments : types de fiches, sous-types, sections, champs et leurs options, relations, rôles de parties prenantes, catégories, tableaux de bord, réglementations, types de ressources et l'aide sur les phases du cycle de vie.

Vous avez besoin de la permission **admin.settings** pour tout ce qui figure sur cette page.

## Ajouter une langue personnalisée

Allez dans **Admin > Paramètres > Général**. La section **Langues personnalisées** se trouve juste sous [Langues activées](settings.md#langues-activees).

Cliquez sur **Ajouter une langue** et renseignez :

| Champ | Description |
|-------|-------------|
| **Code de langue** | Un code de langue court : deux ou trois lettres minuscules, éventuellement suivies d'une écriture (`zh-Hant`) et d'une région de deux lettres en majuscules (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. Il ne peut pas être le code d'une langue intégrée. |
| **Nom natif** | Le nom que les utilisateurs voient dans leur menu de langue, écrit dans la langue elle-même — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **Nom en anglais** | Le nom de la langue en anglais — *Dutch*, *Hebrew*. C'est la langue cible indiquée au fournisseur d'IA pour la traduction. Lettres, espaces, parenthèses et tirets uniquement. |
| **Écriture de droite à gauche** | Activez-la pour une langue écrite de droite à gauche, comme l'hébreu, le persan ou l'ourdou. Elle est désactivée par défaut ; la boîte de dialogue le signale quand le code correspond à une langue généralement écrite de droite à gauche, mais ne l'active jamais à votre place. |

Toute écriture convient : latine, cyrillique, hébraïque, arabe, devanagari, thaï et d'autres, y compris les caractères de liaison et les signes dont ces écritures ont besoin. Avec **Écriture de droite à gauche** activée, toute l'application est disposée de droite à gauche pour les utilisateurs qui choisissent la langue, comme pour l'arabe.

Une langue régionale est une langue à part entière : `pt-BR` n'emprunte rien au portugais intégré, et `zh-Hant` n'emprunte rien au chinois intégré. Tant qu'une chaîne n'est pas traduite, elle s'affiche en anglais.

Une nouvelle langue démarre désactivée : les utilisateurs ne la voient pas tant que vous ne la proposez pas. Chaque langue de la liste affiche une barre de progression indiquant combien de chaînes sont traduites, et deux compteurs :

- **Manquantes** — les chaînes qui n'ont pas encore de traduction.
- **Modifiées en anglais** — les chaînes qui étaient traduites mais dont le texte anglais a changé depuis. Tant qu'elles ne sont pas retraduites, les utilisateurs voient l'ancienne traduction, ce qui vaut généralement mieux qu'un retour à l'anglais.

Proposez une langue à vos utilisateurs avec son interrupteur. Ils peuvent alors la choisir dans le menu de langue, comme n'importe quelle langue intégrée. Les chaînes encore manquantes s'affichent en anglais.

## Trois façons de traduire

Utilisez celle qui vous convient ; elles se combinent, et le résultat est le même.

### 1. Exporter un fichier et le réimporter

**Exporter le pack de langue** télécharge un fichier de pack de langue (JSON). Choisissez ce qu'il contient :

- **Chaînes nouvelles et modifiées (à traduire)** — le texte anglais de chaque chaîne manquante ou modifiée. À utiliser pour la première traduction et après chaque mise à niveau.
- **Toutes les chaînes en anglais (à traduire)** — le texte anglais de chaque chaîne, pour tout retraduire.
- **Traductions actuelles (y compris les libellés propres à cette installation)** — les traductions que vous avez déjà, y compris les noms de votre propre métamodèle. À utiliser comme sauvegarde ou pour transférer la langue vers une autre de vos installations.
- **Partager (pack communautaire)** — les traductions que vous avez déjà, mais seulement ce qui est identique dans toutes les installations de Turbo EA : le texte de l'interface et les noms du métamodèle intégré tels que Turbo EA les livre. Tout ce qui est propre à votre installation est exclu — types de fiches, champs et options que vous avez créés, noms intégrés que vous avez renommés, vos tableaux de bord et catégories. C'est le fichier à partager avec d'autres utilisateurs de Turbo EA.

Traduisez le fichier où vous voulez — une agence de traduction, un outil de traduction ou un chat IA — puis **Importer un pack de langue**. L'import vérifie le fichier, enregistre les chaînes section par section et affiche un rapport : combien de chaînes ont été appliquées, laissées inchangées ou effacées, lesquelles ont été rejetées et pourquoi, et quelles clés ne figurent pas dans cette version.

### 2. Traduire avec votre fournisseur d'IA

Si un fournisseur d'IA est configuré sous [Fonctionnalités IA](ai.md), **Traduire avec l'IA** traduit la langue en arrière-plan. Choisissez :

- **Chaînes nouvelles et modifiées** — uniquement les manquantes et les modifiées. C'est le choix habituel.
- **Tout** — chaque chaîne à nouveau. Les chaînes que vous avez corrigées à la main sont conservées, sauf si vous cochez aussi **Remplacer aussi les chaînes corrigées à la main**.

La boîte de dialogue indique combien de chaînes seront envoyées, puis la progression pendant l'exécution ; vous pouvez la fermer et revenir, ou **Arrêter la traduction**. Les noms de vos types de fiches, champs et relations sont traduits en premier, puis le reste de l'interface est traduit avec ces noms comme référence, de sorte qu'une même chose porte le même nom partout. Une chaîne que l'IA renvoie sous une forme inutilisable n'est pas enregistrée ; elle reste manquante et est retentée à l'exécution suivante.

Cette option ne dépend pas de l'activation des suggestions de description par IA pour les fiches — seulement de la configuration d'un fournisseur.

### 3. Via un assistant IA (MCP)

Un assistant IA connecté par l'[intégration MCP](mcp.md) peut traduire la langue à votre place, à l'aide de trois outils :

- `list_custom_languages` — quelles langues personnalisées existent et où en est la traduction de chacune.
- `get_untranslated_strings` — les chaînes anglaises encore à traduire, page par page, avec les instructions de traduction.
- `submit_translations` — renvoie les traductions. Il affiche d'abord un aperçu et enregistre après confirmation, comme tout outil d'écriture MCP.

Demandez par exemple à l'assistant : *« Traduis les chaînes manquantes de notre langue personnalisée néerlandais, en commençant par les noms du métamodèle. »* L'assistant travaille avec vos propres permissions, et chaque modification qu'il effectue est consignée dans le journal d'audit.

## Le fichier de pack de langue

Un pack de langue est un fichier JSON comme celui-ci :

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "metamodel": {
      "type.Application.label": "Application",
      "type.Application.field.businessCriticality": "Business Criticality"
    },
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "metamodel": {
      "type.Application.label": "5c1e0a9d7b32",
      "type.Application.field.businessCriticality": "a90d3f17c4e8"
    },
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** contient le texte à traduire, regroupé par section (`metamodel`, `common`, `admin`, `cards`, …). Ne traduisez que les **valeurs** ; ne modifiez jamais les clés.
- La section **metamodel** contient les noms des types de fiches, champs, options, relations et les autres libellés stockés dans votre base de données. Ce sont de courts libellés auxquels le reste de l'interface fait référence : traduisez-les en premier et employez les mêmes mots partout ailleurs.
- Conservez tel quel tout ce qui est entre doubles accolades, comme `{{count}}` ou `{{name}}` : l'application y insère une valeur. Conservez aussi les balises comme `<1>` et `</1>` et les références comme `$t(common:actions.save)`.
- **source_hashes** enregistre à partir de quel texte anglais chaque chaîne a été faite. Laissez-le dans le fichier : à l'import, il indique à Turbo EA si l'anglais a changé depuis l'export du fichier. Pour la section **metamodel**, il est obligatoire — une entrée sans son hash est refusée — car c'est ce qui empêche une traduction de se poser sur un nom renommé entre-temps.
- **instructions** répète ces règles en termes simples, pour que vous puissiez remettre le fichier tel quel à un traducteur ou à un chat IA.

À l'import, chaque chaîne est vérifiée séparément. Une clé que cette version de Turbo EA ne connaît pas — issue d'un pack fait pour une autre version — est comptée comme absente de cette version et nommée dans le rapport. Une chaîne est rejetée lorsqu'elle est vide ou beaucoup plus longue que l'anglais, lorsqu'elle perd ou ajoute une variable ou une référence `$t(...)`, ou lorsqu'elle introduit une balise ou un lien que le texte anglais n'a pas. Dans la section **metamodel**, une traduction est aussi refusée si elle n'a pas de hash, et ignorée si le nom à partir duquel elle a été faite a changé depuis l'export du fichier — une traduction de « Application » ne se pose jamais sur un type de fiche que quelqu'un a renommé. Une traduction identique à celle déjà stockée est signalée comme inchangée. Une chaîne rejetée n'empêche jamais l'enregistrement des autres.

Un fichier exporté pour un autre code de langue peut tout de même être importé ; une confirmation vous est d'abord demandée.

## Vérifier et corriger les chaînes

**Vérifier les chaînes** liste les chaînes d'une langue avec le texte anglais à côté de chaque traduction. Filtrez par section, par statut (manquantes, modifiées en anglais, traduites) ou par texte, et modifiez ou effacez n'importe quelle traduction sur place. Vos corrections prennent effet dès que vous les enregistrez.

## Après une mise à niveau

Chaque version de Turbo EA ajoute et modifie du texte anglais, et vous pouvez renommer des éléments de votre métamodèle. Ensuite, la langue personnalisée affiche les nouvelles chaînes comme **manquantes** et celles qui ont changé comme **modifiées en anglais** — tout le reste conserve sa traduction. Comblez l'écart de l'une des trois façons ci-dessus : exportez les chaînes nouvelles et modifiées, lancez **Traduire avec l'IA** avec **Chaînes nouvelles et modifiées**, ou demandez à votre assistant.

Les corrections faites à la main sont conservées. Une exécution de l'IA sur **Tout** les laisse intactes, sauf si vous cochez **Remplacer aussi les chaînes corrigées à la main**.

## Limites

- **Le site de documentation n'est pas couvert.** Ce manuel reste dans les langues intégrées.
- **Les enquêtes conservent les libellés avec lesquels elles ont été créées.** Une enquête créée avant la traduction des options d'un champ conserve les libellés d'options avec lesquels elle a été créée.
- **Formes plurielles.** L'anglais a deux formes plurielles (*one card*, *2 cards*). Une langue qui en a davantage — comme le polonais, le russe ou l'arabe — peut ajouter ses formes supplémentaires (`_few`, `_many`, …) à côté des formes anglaises dans un fichier importé. Une forme que le pack ne contient pas se rabat sur la forme générale de la langue (la traduction `_other`), jamais sur l'anglais. La traduction par IA et l'écran de vérification travaillent aussi sur les formes supplémentaires déjà stockées, mais n'en créent pas de nouvelles : ajoutez-les via un fichier.
- La suppression d'une langue personnalisée supprime toutes ses traductions, y compris les noms des types de fiches, des champs et les autres libellés du métamodèle. Les utilisateurs qui l'avaient choisie repassent en anglais.
