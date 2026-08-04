# Namespace-aware sources — examples

## addResourceBundle (co-located modules)

```ts
// src/app/pages/home/i18n/en.ts
export default { SAVE: "Save" };

// src/app/pages/home/Home.tsx
import i18next from "i18next";
import en from "./i18n/en"; // or alias: app/pages/home/i18n/en
i18next.addResourceBundle("en", "home", en);
```

Extracted entry:

```json
{
  "locale": "en",
  "namespace": "home",
  "keyPath": "SAVE",
  "fullKey": "en::home::SAVE",
  "sourceFile": "src/app/pages/home/i18n/en.ts"
}
```

## Usage resolution

```ts
const { t } = useTranslation("home");
t("SAVE"); // → home:SAVE

t("SAVE", { ns: "settings" }); // → settings:SAVE

const { t } = useTranslation(["home", "settings"]);
t("SAVE"); // candidates: home, settings
```

## Duplicates

`home:SAVE` and `settings:SAVE` are **different** keys — never reported as duplicates.

## Migration

```ts
import {
  createSourceDetector,
  entriesFromCatalog,
  toTranslationEntry,
} from "@i18n-unused/sources";

const catalog = await createSourceDetector().discover({ root });
const entries = entriesFromCatalog(catalog);
// Prefer entry.fullKey / entry.namespace over bare entry.keyPath alone.
```

`TranslationKeyDefinition` remains supported; `fullKey` is filled by the detector.
