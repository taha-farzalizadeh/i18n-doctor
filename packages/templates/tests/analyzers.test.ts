import { describe, expect, it } from "vitest";
import {
  createAngularTemplateParser,
  createAstroTemplateParser,
  createNuxtTemplateParser,
  createSvelteTemplateParser,
  createTemplateAnalyzer,
  createVueTemplateParser,
  extractVueTemplate,
} from "../src/index.js";

function keys(usages: { key: string }[]): string[] {
  return usages.map((u) => u.key).sort();
}

describe("vue template analyzer", () => {
  it("detects interpolation $t and composition t()", () => {
    const parser = createVueTemplateParser();
    const sourceText = `<template>
  <p>{{ $t('hello') }}</p>
  <span>{{ t('world') }}</span>
  <img :alt="$t('alt.text')" />
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>
`;
    const result = parser.analyze({
      absolutePath: "/a/Hello.vue",
      relativePath: "Hello.vue",
      sourceText,
    });
    expect(keys(result.usages)).toEqual(["alt.text", "hello", "world"]);
    expect(result.usages.every((u) => u.framework === "vue")).toBe(true);
    expect(result.usages.every((u) => u.detector === "vue-template-analyzer")).toBe(
      true,
    );
    const hello = result.usages.find((u) => u.key === "hello")!;
    expect(hello.location.line).toBe(2);
    expect(sourceText.slice(hello.location.start, hello.location.end)).toBe(
      "hello",
    );
  });

  it("detects v-t directive and i18n-t keypath", () => {
    const parser = createVueTemplateParser();
    const result = parser.analyze({
      absolutePath: "/a/D.vue",
      relativePath: "D.vue",
      sourceText: `<template>
  <p v-t="'dir.key'"></p>
  <i18n-t keypath="path.key" />
  <i18n-t :keypath="'bound.key'" />
</template>`,
    });
    expect(keys(result.usages)).toEqual(["bound.key", "dir.key", "path.key"]);
  });

  it("handles nested template slots without truncating", () => {
    const sourceText = `<template>
  <Outer>
    <template #header>{{ $t('header') }}</template>
    <template #footer>{{ $t('footer') }}</template>
  </Outer>
</template>`;
    const tpl = extractVueTemplate(sourceText);
    expect(tpl?.text).toContain("$t('footer')");
    const result = createVueTemplateParser().analyze({
      absolutePath: "/a/N.vue",
      relativePath: "N.vue",
      sourceText,
    });
    expect(keys(result.usages)).toEqual(["footer", "header"]);
  });

  it("ignores HTML comments and keeps URL attributes intact", () => {
    const parser = createVueTemplateParser();
    const sourceText = `<template>
  <!-- {{ $t('gone') }} -->
  <a href="https://example.com/x">{{ $t('kept') }}</a>
</template>`;
    const result = parser.analyze({
      absolutePath: "/a/C.vue",
      relativePath: "C.vue",
      sourceText,
    });
    expect(keys(result.usages)).toEqual(["kept"]);
    // Regression: // in URLs must not be treated as line comments.
    expect(result.usages).toHaveLength(1);
  });

  it("extracts escaped string keys", () => {
    const parser = createVueTemplateParser();
    const sourceText = `<template>{{ $t("say \\"hi\\"") }}</template>`;
    const result = parser.analyze({
      absolutePath: "/a/E.vue",
      relativePath: "E.vue",
      sourceText,
    });
    expect(result.usages).toHaveLength(1);
    expect(result.usages[0]?.key).toBe('say "hi"');
  });

  it("returns empty for script-only / invalid SFC without throwing", () => {
    const parser = createVueTemplateParser();
    const result = parser.analyze({
      absolutePath: "/a/S.vue",
      relativePath: "S.vue",
      sourceText: `<script setup>const x = 1;</script>`,
    });
    expect(result.usages).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("nuxt template analyzer", () => {
  it("activates on nuxt-i18n hints for $t and $tm", () => {
    const parser = createNuxtTemplateParser();
    const sourceText = `<template><p>{{ $t('nav.home') }} {{ $tm('nav') }}</p></template>`;
    expect(
      parser.analyze({
        absolutePath: "/a/N.vue",
        relativePath: "N.vue",
        sourceText,
        libraryHints: new Set(["vue-i18n"]),
      }).usages,
    ).toEqual([]);

    const hot = parser.analyze({
      absolutePath: "/a/N.vue",
      relativePath: "N.vue",
      sourceText,
      libraryHints: new Set(["nuxt-i18n"]),
    });
    expect(keys(hot.usages)).toEqual(["nav", "nav.home"]);
    expect(hot.usages.every((u) => u.framework === "nuxt")).toBe(true);
    expect(hot.usages.every((u) => u.detector === "nuxt-template-analyzer")).toBe(
      true,
    );
  });

  it("does not treat bare nuxt framework id as i18n hint", () => {
    const parser = createNuxtTemplateParser();
    const result = parser.analyze({
      absolutePath: "/a/N.vue",
      relativePath: "N.vue",
      sourceText: `<template>{{ $t('x') }}</template>`,
      libraryHints: new Set(["nuxt"]),
    });
    expect(result.usages).toEqual([]);
  });
});

describe("angular template analyzer", () => {
  it("detects pipes and translate directives", () => {
    const parser = createAngularTemplateParser();
    const sourceText = `
<h1>{{ 'menu.title' | translate }}</h1>
<span translate="menu.plain"></span>
<div [translate]="'menu.bind'"></div>
<p *translate="'menu.star'"></p>
`;
    const result = parser.analyze({
      absolutePath: "/a/a.html",
      relativePath: "a.html",
      sourceText,
    });
    expect(keys(result.usages)).toEqual([
      "menu.bind",
      "menu.plain",
      "menu.star",
      "menu.title",
    ]);
    const pipe = result.usages.find((u) => u.key === "menu.title")!;
    expect(pipe.context).toBe("pipe");
    expect(pipe.framework).toBe("angular");
    expect(sourceText.slice(pipe.location.start, pipe.location.end)).toBe(
      "menu.title",
    );
  });

  it("supports translate pipes with args and ignores comments", () => {
    const parser = createAngularTemplateParser();
    const result = parser.analyze({
      absolutePath: "/a/b.html",
      relativePath: "b.html",
      sourceText: `
<!-- {{ 'nope' | translate }} -->
{{ 'yes' | translate: { x: 1 } }}
<a href="https://example.com">{{ 'link' | translate }}</a>
`,
    });
    expect(keys(result.usages)).toEqual(["link", "yes"]);
  });
});

describe("svelte template analyzer", () => {
  it("detects store $_ and $t usage", () => {
    const parser = createSvelteTemplateParser();
    const sourceText = `<script>
  import { _ } from 'svelte-i18n';
  // $t('commented')
</script>
<style>
  /* $t('css') */
</style>
<p>{$t('greet')}</p>
<span>{$_('bye')}</span>
`;
    const result = parser.analyze({
      absolutePath: "/a/W.svelte",
      relativePath: "W.svelte",
      sourceText,
    });
    expect(keys(result.usages)).toEqual(["bye", "greet"]);
    expect(result.usages.every((u) => u.framework === "svelte")).toBe(true);
  });
});

describe("astro template analyzer", () => {
  it("detects t() in frontmatter and template expressions", () => {
    const parser = createAstroTemplateParser();
    const sourceText = `---
// t('commented')
const label = t('front.key');
---
<a href="https://astro.build">{t('tpl.key')}</a>
`;
    const result = parser.analyze({
      absolutePath: "/a/P.astro",
      relativePath: "P.astro",
      sourceText,
      libraryHints: new Set(["i18next"]),
    });
    expect(keys(result.usages)).toEqual(["front.key", "tpl.key"]);
    expect(result.usages.every((u) => u.framework === "astro")).toBe(true);
    expect(result.usages[0]?.library).toBe("i18next");
  });
});

describe("template analyzer registry", () => {
  it("routes by extension, sorts stably, and skips huge files", () => {
    const analyzer = createTemplateAnalyzer();
    expect(analyzer.supportedExtensions()).toEqual([
      "astro",
      "htm",
      "html",
      "svelte",
      "vue",
    ]);

    const a = analyzer.analyzeFile({
      absolutePath: "/a/X.vue",
      relativePath: "X.vue",
      sourceText: `<template>{{ $t('b') }} {{ $t('a') }}</template>`,
    });
    expect(a.usages.map((u) => u.key)).toEqual(["b", "a"]); // document order by start offset
    expect(a.usages[0]?.location.start).toBeLessThan(a.usages[1]!.location.start);

    const huge = analyzer.analyzeFile({
      absolutePath: "/a/huge.vue",
      relativePath: "huge.vue",
      sourceText: "x".repeat(1_500_001),
    });
    expect(huge.usages).toEqual([]);
    expect(huge.warnings.some((w) => w.code === "file-too-large")).toBe(true);
  });

  it("produces stable output across repeated runs", () => {
    const analyzer = createTemplateAnalyzer();
    const input = {
      absolutePath: "/a/S.svelte",
      relativePath: "S.svelte",
      sourceText: `<p>{$t('one')}</p><p>{$_('two')}</p>`,
    };
    const first = analyzer.analyzeFile(input);
    const second = analyzer.analyzeFile(input);
    expect(second).toEqual(first);
  });
});
