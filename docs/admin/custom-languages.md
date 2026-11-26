# Custom Languages

Turbo EA ships with ten built-in languages. When your organisation needs another one — Dutch, Polish, Hebrew, Hindi, Thai, a regional variant such as Brazilian Portuguese — an administrator can add it as a **custom language** and fill its translations without waiting for a new release.

A custom language lives in your database, not in the application code. You add it, translate it, review it, and offer it to your users when it is ready. The built-in languages are not affected.

A custom language covers the whole user interface **and** the names your metamodel gives things: card types, subtypes, sections, fields and their options, relations, stakeholder roles, categories, dashboards, regulations, resource types and the lifecycle phase help.

You need the **admin.settings** permission for everything on this page.

## Adding a custom language

Go to **Admin > Settings > General**. The **Custom Languages** section sits just below [Enabled Languages](settings.md#enabled-languages).

Click **Add language** and fill in:

| Field | Description |
|-------|-------------|
| **Language code** | A short language code: two or three lowercase letters, optionally followed by a script (`zh-Hant`) and a two-letter region in capitals (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. It cannot be the code of a built-in language. |
| **Native name** | The name users see in their language menu, written in the language itself — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **English name** | The name of the language in English — *Dutch*, *Hebrew*. It is what the AI provider is told to translate into. Letters, spaces, brackets and dashes only. |
| **Right-to-left script** | Switch it on for a language written from right to left, such as Hebrew, Persian or Urdu. It is off by default; the dialog points it out when the code is one usually written right to left, but never switches it for you. |

Any script works: Latin, Cyrillic, Hebrew, Arabic, Devanagari, Thai and others, including the joining characters and marks those scripts need. With **Right-to-left script** on, the whole application is laid out from right to left for users who pick the language, as it is for Arabic.

A regional language is a language of its own: `pt-BR` does not borrow from the built-in Portuguese, and `zh-Hant` does not borrow from the built-in Chinese. Until a string is translated, it is shown in English.

A new language starts switched off: users do not see it until you offer it. Each language in the list shows a progress bar with how many strings are translated, and two counts:

- **Missing** — strings that have no translation yet.
- **Changed in English** — strings that were translated, but whose English text has changed since. Until they are translated again, users see the old translation, which is usually better than falling back to English.

Offer a language to your users with its switch. Users can then pick it from the language menu, like any built-in language. Strings that are still missing appear in English.

## Installing a language from the community library

Other Turbo EA users share their translations in the [community language library](https://github.com/vincentmakes/turbo-ea-translations). Below your own languages, the **Community languages** block lists the languages it holds, each with its native name and code, how much of the interface it translates, and the Turbo EA version its pack was made with.

!!! warning "Community-provided, not reviewed"
    The packs are written by members of the community. **The Turbo EA project does not review them.** Automatic checks make sure a pack cannot add markup, links or broken placeholders that the English text does not have, but nobody checks whether the translations are accurate or complete. Review a language before you offer it to your users.

**Install** downloads the language's pack and imports it. What happens:

- The pack is downloaded from the community library — exactly the file the library lists, checked against its checksum.
- Every string goes through the same checks as an [imported file](#the-language-pack-file); a rejected string is listed in the report and never saved.
- A new language is added **switched off**. Look at it in **Review strings**, then switch it on for your users.
- The report shows what was applied, what was rejected and why, and what is not in your version of Turbo EA.

The language then shows as **installed**, and its row in your own list carries the **Community-provided, not reviewed** marker. A failed install — a pack that cannot be downloaded, does not match the library's checksum or is not a valid pack — installs nothing and is recorded in the [Security & admin log](audit-log.md). In **Review strings**, each translation shows where it came from — *Community library*, *Corrected by hand*, *AI translation*, *Imported file* or *MCP*.

When the library has a newer pack of a language you installed from it, the language shows **Update available**. **Update** merges the new pack into your language. Strings you corrected by hand are kept, unless you tick **Also replace the strings corrected by hand**. The name, direction and switch of your language are left as they are.

If you added a language yourself and the library has the same code, its row shows **Added on this server** and offers **Add community strings**: the pack is merged into your language the same way — strings you corrected by hand are kept unless you choose otherwise — and the language is then marked as community-provided.

Turbo EA contacts the library only when you ask: the first time the section is shown, the list is downloaded and kept; after that, the kept list is shown (with the date it was downloaded) until you click **Refresh**. Nothing is checked in the background, so a newer pack shows as **Update available** only after a refresh. If the library cannot be reached, the block says so and keeps showing the list from the last successful download.

### Turning the library off

The library's address is set by the `LANGUAGE_CATALOGUE_URL` environment variable (Helm value `customLanguages.catalogueUrl`). Set it to an empty value to switch the feature off, for example on an installation without internet access; the block then says that the community library is switched off. You can also point it at a copy of the library on your own server: packs are downloaded from the `packs/<code>/pack.json` files beside its `index.json`.

### Contributing a language

Translated a language that is not in the library yet, or improved one? Export it with **Export language pack > Share (community pack)** and propose it to the library — see its [contributing guide](https://github.com/vincentmakes/turbo-ea-translations/blob/main/CONTRIBUTING.md).

## Three ways to translate

Use whichever suits you; they can be combined, and the result is the same.

### 1. Export a file and import it back

**Export language pack** downloads a language-pack file (JSON). Choose what goes in it:

- **New and changed strings (to translate)** — the English text of every string that is missing or changed. Use this for the first translation and after each upgrade.
- **All strings in English (to translate)** — the English text of every string, to translate everything again.
- **Current translations (includes this installation's own labels)** — the translations you already have, including the names in your own metamodel. Use it as a backup or to move the language to another installation of your own.
- **Share (community pack)** — the translations you already have, but only what is the same in every Turbo EA installation: the interface text and the names of the built-in metamodel as Turbo EA ships them. Anything specific to your installation is left out — card types, fields and options you created, built-in names you renamed, your dashboards and categories. This is the file to share with other Turbo EA users.

Translate the file anywhere — a translation agency, a translation tool, or an AI chat — then **Import language pack**. The import checks the file, saves the strings one section at a time, and shows a report: how many strings were applied, unchanged or cleared, which were rejected and why, and which keys are not in this version.

### 2. Translate with your AI provider

If an AI provider is configured under [AI Capabilities](ai.md), **Translate with AI** translates the language in the background. Choose:

- **New and changed strings** — only the missing and changed ones. This is the usual choice.
- **Everything** — every string again. Strings you corrected by hand are kept unless you also tick **Also replace strings corrected by hand**.

The dialog shows how many strings will be sent, then the progress while it runs; you can close it and come back, or **Stop translation**. The names of your card types, fields and relations are translated first, and the rest of the interface is then translated with those names as a reference, so the same thing is called the same everywhere. A string the AI returns in an unusable form is not saved; it stays missing and is tried again on the next run.

This option does not depend on the AI description suggestions for cards being switched on — only on a provider being configured.

### 3. Through an AI assistant (MCP)

An AI assistant connected through the [MCP integration](mcp.md) can translate the language for you, using these tools:

- `list_custom_languages` — which custom languages exist and how far each one is translated.
- `get_untranslated_strings` — the English strings still to translate, page by page (up to 500 at a time), with the translation instructions. A text that appears in many places, such as "High" or "Description", is listed once.
- `submit_translations` — sends a page of translations back and saves them at once, without a preview: each string is checked on its own, and only valid ones are stored. A translation also fills every other untranslated string with the same English text; a string that already has a translation is never changed, and a wrong fill is corrected in the review table.
- `start_ai_translation` and `stop_ai_translation` — start or stop the server's own **Translate with AI** job, so a whole language is one request. The job runs on the AI provider configured under [AI Capabilities](ai.md), not on the assistant; the assistant previews first how many strings would be sent, and for a large job passes the preview's confirmation back when it starts.

Ask the assistant, for example: *"Translate the missing strings of our Dutch custom language, starting with the metamodel names."* The assistant works with your own permissions, and every change it makes is recorded in the audit log.

## The language-pack file

A language pack is a JSON file like this:

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

- **strings** holds the text to translate, grouped by section (`metamodel`, `common`, `admin`, `cards`, …). Translate the **values** only; never change the keys.
- The **metamodel** section holds the names of card types, fields, options, relations and the other labels stored in your database. They are short labels the rest of the interface refers to: translate them first and use the same words for them everywhere else.
- Keep everything in double curly braces, such as `{{count}}` or `{{name}}`, exactly as it is: the application fills in a value there. Keep tags such as `<1>` and `</1>` and references such as `$t(common:actions.save)` too.
- **source_hashes** records which English text each string was made from. Leave it in the file: on import it tells Turbo EA whether the English has changed since the file was exported. For the **metamodel** section it is required — an entry without its hash is refused — because it is what keeps a translation off a name that was renamed in the meantime.
- **instructions** repeats these rules in plain words, so you can hand the file to a translator or an AI chat as it is.

When you import, each string is checked on its own. A key this version of Turbo EA does not have — from a pack made for another version — is counted as not in this version and named in the report. A string is rejected when it is empty or much longer than the English, when it loses or adds a placeholder or a `$t(...)` reference, or when it brings in a tag or a link that the English text does not have. In the **metamodel** section a translation is also refused when it carries no hash, and skipped when the name it was made from has been changed since the file was exported — a translation of "Application" never lands on a card type someone has renamed. A translation identical to the one already stored is reported as unchanged. A rejected string never stops the others from being saved.

A file exported for another language code can still be imported; you are asked to confirm first.

## Reviewing and correcting strings

**Review strings** lists the strings of a language with the English text beside each translation. Filter by section, by status (missing, changed in English, translated) or by text, and edit or clear any translation in place. Your corrections take effect as soon as you save them.

## After an upgrade

Each Turbo EA release adds and changes some English text, and you may rename things in your metamodel. Afterwards, the custom language shows the new strings as **missing** and the changed ones as **changed in English** — everything else keeps its translation. Fill the gap with any of the three ways above: export the new and changed strings, run **Translate with AI** with **New and changed strings**, or ask your assistant.

Corrections you made by hand are kept. An AI run over **Everything** leaves them alone unless you tick **Also replace strings corrected by hand**.

## Limits

- **The documentation site is not covered.** This manual stays in the built-in languages.
- **Surveys keep the labels they were built with.** A survey created before a field's options were translated keeps the option labels it was built with.
- **Plural forms.** English has two plural forms (*one card*, *2 cards*). A language with more — such as Polish, Russian or Arabic — can add its extra forms (`_few`, `_many`, …) beside the English ones in an imported file. A form the pack does not carry falls back to the language's own general form (the `_other` translation), never to English. The AI translation and the review screen also work on the extra forms already stored, but they do not create new ones: add those through a file.
- Deleting a custom language removes all its translations, the names of card types, fields and the other metamodel labels included. Users who had chosen it are switched back to English.
