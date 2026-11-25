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

A new language starts switched off: users do not see it until you offer it. Each language in the list shows a progress bar with how many strings are translated, and two counts:

- **Missing** — strings that have no translation yet.
- **Changed in English** — strings that were translated, but whose English text has changed since. Until they are translated again, users see the old translation, which is usually better than falling back to English.

Offer a language to your users with its switch. Users can then pick it from the language menu, like any built-in language. Strings that are still missing appear in English.

## Three ways to translate

Use whichever suits you; they can be combined, and the result is the same.

### 1. Export a file and import it back

**Export language pack** downloads a language-pack file (JSON). Choose what goes in it:

- **New and changed strings (to translate)** — the English text of every string that is missing or changed. Use this for the first translation and after each upgrade.
- **All strings in English (to translate)** — the English text of every string, to translate everything again.
- **Current translations (to share)** — the translations you already have, including the names in your own metamodel. Use it as a backup or to move the language to another installation of your own.
- **Share (community pack)** — the translations you already have, but only what is the same in every Turbo EA installation: the interface text and the names of the built-in metamodel as Turbo EA ships them. Anything specific to your installation is left out — card types, fields and options you created, built-in names you renamed, your dashboards and categories. This is the file to share with other Turbo EA users.

Translate the file anywhere — a translation agency, a translation tool, or an AI chat — then **Import language pack**. The import checks the file, saves the strings one section at a time, and shows a report: how many strings were applied, unchanged or cleared, and which were rejected and why.

### 2. Translate with your AI provider

If an AI provider is configured under [AI Capabilities](ai.md), **Translate with AI** translates the language in the background. Choose:

- **New and changed strings** — only the missing and changed ones. This is the usual choice.
- **Everything** — every string again. Strings you corrected by hand are kept unless you also tick **Also replace strings corrected by hand**.

The dialog shows how many strings will be sent, then the progress while it runs; you can close it and come back, or **Stop translation**. The names of your card types, fields and relations are translated first, and the rest of the interface is then translated with those names as a reference, so the same thing is called the same everywhere. A string the AI returns in an unusable form is not saved; it stays missing and is tried again on the next run.

This option does not depend on the AI description suggestions for cards being switched on — only on a provider being configured.

### 3. Through an AI assistant (MCP)

An AI assistant connected through the [MCP integration](mcp.md) can translate the language for you, using three tools:

- `list_custom_languages` — which custom languages exist and how far each one is translated.
- `get_untranslated_strings` — the English strings still to translate, page by page, with the translation instructions.
- `submit_translations` — sends the translations back. It previews first and saves on confirmation, like every MCP write tool.

Ask the assistant, for example: *"Translate the missing strings of our Dutch custom language, starting with the metamodel names."* The assistant works with your own permissions, and every call it makes is recorded in the audit log.

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
- **source_hashes** records which English text each string was made from. Leave it in the file: on import it tells Turbo EA whether the English has changed since the file was exported.
- **instructions** repeats these rules in plain words, so you can hand the file to a translator or an AI chat as it is.

When you import, each string is checked on its own. A string is rejected when its key is unknown, when it is empty or much longer than the English, when it loses or adds a placeholder or a `$t(...)` reference, or when it brings in a tag or a link that the English text does not have. In the **metamodel** section a translation is also skipped when the name it was made from has been changed since the file was exported — a translation of "Application" never lands on a card type someone has renamed. A rejected string never stops the others from being saved.

A file exported for another language code can still be imported; you are asked to confirm first.

## Reviewing and correcting strings

**Review strings** lists the strings of a language with the English text beside each translation. Filter by section, by status (missing, changed in English, translated) or by text, and edit or clear any translation in place. Your corrections take effect as soon as you save them.

## After an upgrade

Each Turbo EA release adds and changes some English text, and you may rename things in your metamodel. Afterwards, the custom language shows the new strings as **missing** and the changed ones as **changed in English** — everything else keeps its translation. Fill the gap with any of the three ways above: export the new and changed strings, run **Translate with AI** with **New and changed strings**, or ask your assistant.

Corrections you made by hand are kept. An AI run over **Everything** leaves them alone unless you tick **Also replace strings corrected by hand**.

## Limits

- **The documentation site is not covered.** This manual stays in the built-in languages.
- **Surveys keep the labels they were built with.** A survey created before a field's options were translated keeps the option labels it was built with.
- **Plural forms.** English has two plural forms (*one card*, *2 cards*). A language with more — such as Polish, Russian or Arabic — can add its extra forms (`_few`, `_many`, …) beside the English ones in an imported file. A form the pack does not carry falls back to the language's own general form (the `_other` translation), never to English. The AI translation and the review screen work on the English forms only.
- Deleting a custom language removes all its translations. Users who had chosen it are switched back to English.
