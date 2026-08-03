import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("vue: interpolation + script setup + composition API", () => {
  it("detects template interpolation and script setup useI18n", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "vue-i18n": "9.0.0" },
      }),
      "src/Hello.vue": `<template>
  <p>{{ $t('greet.hello') }}</p>
  <span>{{ t('greet.comp') }}</span>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
t('greet.script');
</script>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const byKey = Object.fromEntries(catalog.usages.map((u) => [u.key, u]));
    expect(byKey["greet.hello"]?.framework).toBe("vue");
    expect(byKey["greet.hello"]?.detector).toBe("vue-template-analyzer");
    expect(byKey["greet.comp"]?.framework).toBe("vue");
    expect(byKey["greet.script"]?.library).toBe("vue-i18n");
    expect(byKey["greet.script"]?.framework).toBe("vue");
    expect(byKey["greet.script"]?.location.line).toBeGreaterThan(
      byKey["greet.hello"]!.location.line,
    );
  });

  it("detects composition API outside script setup", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "vue-i18n": "9.0.0" },
      }),
      "src/Comp.vue": `<template>
  <p>{{ t('comp.title') }}</p>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import { useI18n } from 'vue-i18n';
export default defineComponent({
  setup() {
    const { t } = useI18n();
    t('comp.setup');
    return { t };
  },
});
</script>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((u) => u.key === "comp.title")).toBe(true);
    expect(catalog.usages.some((u) => u.key === "comp.setup")).toBe(true);
  });
});

describe("nuxt: composables + $t", () => {
  it("tags Nuxt template $t and script composable usages", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { nuxt: "3.0.0", "@nuxtjs/i18n": "9.0.0" },
      }),
      "src/Nav.vue": `<template>
  <p>{{ $t('nav.home') }}</p>
</template>
<script setup lang="ts">
const { t } = useI18n();
t('nav.script');
</script>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
      libraryHints: ["nuxt-i18n"],
    });
    const home = catalog.usages.find((u) => u.key === "nav.home");
    const script = catalog.usages.find((u) => u.key === "nav.script");
    expect(home?.framework).toBe("nuxt");
    expect(home?.detector).toBe("nuxt-template-analyzer");
    expect(script?.framework).toBe("nuxt");
    expect(script?.library).toBe("vue-i18n");
  });

  it("detects Nuxt auto-imported t() without local binding", async () => {
    const root = await fixture({
      "src/auto.ts": `t('auto.key');\n`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
      libraryHints: ["nuxt-i18n"],
    });
    const u = catalog.usages.find((x) => x.key === "auto.key");
    expect(u?.framework).toBe("nuxt");
    expect(u?.evidence).toContain("nuxt auto-import");
  });
});

describe("angular: pipe + directive + TS", () => {
  it("detects pipe, directive, and translate.instant", async () => {
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
<span translate="menu.plain"></span>
<div [translate]="'menu.bind'"></div>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.find((u) => u.key === "menu.home")?.context).toBe(
      "method-call",
    );
    expect(catalog.usages.find((u) => u.key === "menu.title")?.framework).toBe(
      "angular",
    );
    expect(catalog.usages.find((u) => u.key === "menu.plain")?.detector).toBe(
      "angular-template-analyzer",
    );
    expect(catalog.usages.find((u) => u.key === "menu.bind")?.key).toBe(
      "menu.bind",
    );
  });
});

describe("svelte: store usage", () => {
  it("detects $_ store and $t", async () => {
    const root = await fixture({
      "src/Widget.svelte": `<script>
  import { _ } from 'svelte-i18n';
</script>
<p>{$t('widget.title')}</p>
<span>{$_('widget.store')}</span>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(
      catalog.usages.map((u) => u.key).sort(),
    ).toEqual(["widget.store", "widget.title"]);
    expect(catalog.usages.every((u) => u.framework === "svelte")).toBe(true);
  });
});

describe("astro: expressions", () => {
  it("detects t() in frontmatter and expressions", async () => {
    const root = await fixture({
      "src/pages/index.astro": `---
const title = t('page.title');
---
<h1>{t('page.heading')}</h1>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
      libraryHints: ["i18next"],
    });
    expect(catalog.usages.map((u) => u.key).sort()).toEqual([
      "page.heading",
      "page.title",
    ]);
    expect(catalog.usages.every((u) => u.framework === "astro")).toBe(true);
  });
});

describe("edge cases", () => {
  it("skips huge files with a warning", async () => {
    const root = await fixture({
      "src/huge.vue": `<template>{{ $t('x') }}</template>\n` + "x".repeat(2_000_000),
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.warnings.some((w) => w.code === "file-too-large")).toBe(true);
    expect(catalog.usages.some((u) => u.key === "x")).toBe(false);
  });

  it("ignores commented keys and keeps mixed script/template locations", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "vue-i18n": "9.0.0" },
      }),
      "src/Mix.vue": `<template>
  <!-- $t('nope') -->
  <p>{{ $t('yes') }}</p>
</template>
<script setup>
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
// t('also-nope')
t('script.yes');
</script>
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key).sort();
    expect(keys).toEqual(["script.yes", "yes"]);
    const yes = catalog.usages.find((u) => u.key === "yes")!;
    expect(yes.location.line).toBe(3);
  });

  it("is stable across repeated detects", async () => {
    const root = await fixture({
      "src/A.svelte": `<p>{$t('stable')}</p>\n`,
    });
    const detector = createUsageDetector();
    const a = await detector.detect({ root, useDetection: false });
    const b = await detector.detect({ root, useDetection: false });
    expect(b.usages).toEqual(a.usages);
  });
});
