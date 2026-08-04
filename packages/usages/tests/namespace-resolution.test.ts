import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("namespace-aware usage resolution (Phase 013.5)", () => {
  it("resolves useTranslation namespace onto t()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Home.tsx": `
import { useTranslation } from 'react-i18next';
export function Home() {
  const { t } = useTranslation('home');
  return t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("supports useTranslation multiple namespaces", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { t } = useTranslation(['home', 'settings']);
  return t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.namespaces).toEqual(["home", "settings"]);
  });

  it("resolves t(key, { ns }) over binding namespace", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { t } = useTranslation('home');
  return t('SAVE', { ns: 'settings' });
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("settings");
    expect(u?.evidence).toContain("options");
  });

  it("resolves const api = useTranslation(ns); api.t()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const api = useTranslation('home');
  return api.t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("home");
  });

  it("marks unresolved namespaces with low confidence", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/boot.ts": `
import i18n from 'i18next';
i18n.t('orphan');
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
      minConfidence: 0.3,
    });
    const u = catalog.usages.find((x) => x.key === "orphan");
    expect(u?.namespaceResolved).toBe(false);
    expect(u?.confidence).toBeLessThanOrEqual(0.4);
  });

  it("binds tx alias from useTranslation destructuring", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { tx } = useTranslation('home');
  return tx('LABEL');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "LABEL");
    expect(u?.namespace).toBe("home");
  });

  it("applies keyPrefix from useTranslation options", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { t } = useTranslation('home', { keyPrefix: 'form' });
  return t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "form.SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.evidence).toContain("keyPrefix=form");
  });

  it("applies keyPrefix for next-intl useTranslations", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "next-intl": "3.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslations } from 'next-intl';
export function Page() {
  const t = useTranslations('HomePage', { keyPrefix: 'hero' });
  return t('title');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "hero.title");
    expect(u?.namespace).toBe("HomePage");
  });
});
