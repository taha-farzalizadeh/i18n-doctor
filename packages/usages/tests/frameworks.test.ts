import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("next-intl", () => {
  it("detects useTranslations namespace usage", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "next-intl": "3.0.0" },
      }),
      "src/page.tsx": `
import { useTranslations } from 'next-intl';
export default function Page() {
  const t = useTranslations('HomePage');
  return <h1>{t('title')}</h1>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "title");
    expect(u?.library).toBe("next-intl");
    expect(u?.namespace).toBe("HomePage");
    expect(u?.evidence).toContain("next-intl-detector");
    expect(u?.location.line).toBe(5);
  });
});

describe("react-intl", () => {
  it("detects formatMessage and FormattedMessage", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-intl": "6.0.0" },
      }),
      "src/App.tsx": `
import { useIntl, FormattedMessage } from 'react-intl';
export function App() {
  const { formatMessage } = useIntl();
  const label = formatMessage({ id: 'app.save' });
  return <FormattedMessage id="app.cancel" />;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const save = catalog.usages.find((x) => x.key === "app.save");
    const cancel = catalog.usages.find((x) => x.key === "app.cancel");
    expect(save?.context).toBe("function-call");
    expect(cancel?.context).toBe("jsx-attribute");
    expect(cancel?.evidence).toContain("react-intl-detector");
  });

  it("detects JSX id={'key'} expression form", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-intl": "6.0.0" },
      }),
      "src/B.tsx": `
import { FormattedMessage } from 'react-intl';
export const B = () => <FormattedMessage id={'app.ok'} />;
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((u) => u.key === "app.ok")).toBe(true);
  });
});

describe("vue-i18n", () => {
  it("detects $t in template and t from useI18n in script", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "vue-i18n": "9.0.0" },
      }),
      "src/Hello.vue": `<template>
  <p>{{ $t('greeting') }}</p>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
t('title');
</script>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const greeting = catalog.usages.find((u) => u.key === "greeting");
    const title = catalog.usages.find((u) => u.key === "title");
    expect(greeting?.library).toBe("vue-i18n");
    expect(greeting?.location.line).toBe(2);
    expect(title?.library).toBe("vue-i18n");
    // script offset adjusted into full SFC coordinates
    expect(title!.location.line).toBeGreaterThan(greeting!.location.line);
  });

  it("detects i18n.t in script", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "vue-i18n": "9.0.0" },
      }),
      "src/i18n.ts": `
import { createI18n } from 'vue-i18n';
const i18n = createI18n({});
i18n.global.t('boot');
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((u) => u.key === "boot")).toBe(true);
  });
});

describe("angular", () => {
  it("detects translate.instant and template pipe", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "@ngx-translate/core": "16.0.0" },
      }),
      "src/app.component.ts": `
import { TranslateService } from '@ngx-translate/core';
export class AppComponent {
  constructor(private translate: TranslateService) {
    this.translate.instant('menu.home');
  }
}
`,
      "src/app.component.html": `<h1>{{ 'menu.title' | translate }}</h1>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const instant = catalog.usages.find((u) => u.key === "menu.home");
    const pipe = catalog.usages.find((u) => u.key === "menu.title");
    expect(instant?.context).toBe("method-call");
    expect(instant?.evidence).toContain("angular-detector");
    expect(pipe?.context).toBe("pipe");
    expect(pipe?.location.line).toBe(1);
  });
});
