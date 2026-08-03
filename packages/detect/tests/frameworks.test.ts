import { describe, expect, it } from "vitest";
import { createDetector } from "../src/index.js";
import { fixture, pkg } from "./helpers.js";

describe("framework detection", () => {
  it("detects React", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { react: "18.0.0", "react-dom": "18.0.0" },
      }),
      "src/App.jsx": `import React from 'react'; export const App = () => <div/>;`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("react");
    expect(result.primary.framework!.confidence).toBeGreaterThan(0.4);
  });

  it("detects Next.js Pages Router", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
      }),
      "next.config.js": "module.exports = {};\n",
      "pages/index.js": `import Link from 'next/link'; export default function Home() { return <Link href='/'>Home</Link>; }`,
      "pages/_app.js": `export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("nextjs");
    expect(result.primary.framework?.nextRouter).toBe("pages");
  });

  it("detects Next.js App Router", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
      }),
      "next.config.ts": "export default {};\n",
      "src/app/layout.tsx": `export default function Layout({ children }: { children: React.ReactNode }) { return children; }`,
      "src/app/page.tsx": `export default function Page() { return <h1>Hi</h1>; }`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("nextjs");
    expect(result.primary.framework?.nextRouter).toBe("app");
  });

  it("detects React Native", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { react: "18.0.0", "react-native": "0.76.0" },
        devDependencies: { "@react-native/metro-config": "0.76.0" },
      }),
      "metro.config.js": "module.exports = {};\n",
      "App.tsx": `import { View, Text } from 'react-native'; export default () => <View><Text>Hi</Text></View>;`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("react-native");
  });

  it("detects Expo and demotes React Native", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          expo: "52.0.0",
          "expo-router": "4.0.0",
          react: "18.0.0",
          "react-native": "0.76.0",
        },
      }),
      "app.json": JSON.stringify({ expo: { name: "demo", slug: "demo" } }),
      "app/_layout.tsx": `import 'expo-router/entry';`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("expo");
    const rn = result.frameworks.find((f) => f.id === "react-native");
    expect(rn).toBeDefined();
    expect(rn!.confidence).toBeLessThanOrEqual(0.5);
  });

  it("does not treat plain app.json as Expo", async () => {
    const root = await fixture({
      "package.json": pkg({ dependencies: { react: "18.0.0" } }),
      "app.json": JSON.stringify({ name: "not-expo" }),
      "src/App.jsx": `import React from 'react'; export default () => null;`,
    });
    const result = await createDetector().detect({ root });
    expect(result.frameworks.some((f) => f.id === "expo")).toBe(false);
  });

  it("detects Vue", async () => {
    const root = await fixture({
      "package.json": pkg({ dependencies: { vue: "3.5.0" } }),
      "src/main.ts": `import { createApp } from 'vue'; createApp({}).mount('#app');`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("vue");
  });

  it("detects Nuxt and demotes Vue", async () => {
    const root = await fixture({
      "package.json": pkg({ dependencies: { nuxt: "3.14.0", vue: "3.5.0" } }),
      "nuxt.config.ts": "export default defineNuxtConfig({});\n",
      "app.vue": `<template><div/></template>`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("nuxt");
    const vue = result.frameworks.find((f) => f.id === "vue");
    expect(vue?.confidence).toBeLessThanOrEqual(0.5);
  });

  it("detects Angular", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          "@angular/core": "19.0.0",
          "@angular/common": "19.0.0",
          "@angular/platform-browser": "19.0.0",
        },
      }),
      "angular.json": JSON.stringify({ version: 1, projects: {} }),
      "src/main.ts": `import { platformBrowser } from '@angular/platform-browser';`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("angular");
  });

  it("detects Svelte", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { svelte: "5.0.0" },
        devDependencies: { "@sveltejs/kit": "2.0.0" },
      }),
      "svelte.config.js": "export default {};\n",
      "src/routes/+page.ts": `export const load = () => ({});`,
    });
    const result = await createDetector().detect({ root });
    expect(result.frameworks.some((f) => f.id === "svelte")).toBe(true);
  });

  it("detects Vite", async () => {
    const root = await fixture({
      "package.json": pkg({
        devDependencies: { vite: "6.0.0", "@vitejs/plugin-react": "4.0.0" },
        dependencies: { react: "18.0.0" },
      }),
      "vite.config.ts": `import { defineConfig } from 'vite'; export default defineConfig({});`,
      "src/main.tsx": `import React from 'react';`,
    });
    const result = await createDetector().detect({ root });
    expect(result.frameworks.some((f) => f.id === "vite")).toBe(true);
  });

  it("detects CRA", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          react: "18.0.0",
          "react-dom": "18.0.0",
          "react-scripts": "5.0.1",
        },
        scripts: {
          start: "react-scripts start",
          build: "react-scripts build",
        },
      }),
      "public/index.html": "<div id='root'></div>",
      "src/index.js": `import React from 'react';`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("cra");
  });

  it("detects Next.js in a monorepo package path", async () => {
    const root = await fixture({
      "package.json": pkg({
        private: true,
        workspaces: ["packages/*"],
      }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/web/package.json": pkg({
        name: "web",
        dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
      }),
      "packages/web/next.config.mjs": "export default {};\n",
      "packages/web/src/app/page.tsx": `export default function Page() { return null; }`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("nextjs");
    expect(result.primary.framework?.nextRouter).toBe("app");
    expect(result.primary.packageManager?.id).toBe("pnpm");
    expect(
      result.warnings.some((w) => w.code === "monorepo-packages"),
    ).toBe(true);
  });

  it("ignores components/app as Next App Router without next", async () => {
    const root = await fixture({
      "package.json": pkg({ dependencies: { react: "18.0.0" } }),
      "src/components/app/index.tsx": `export const AppShell = () => null;`,
    });
    const result = await createDetector().detect({ root });
    expect(result.frameworks.some((f) => f.id === "nextjs")).toBe(false);
    expect(result.primary.framework?.id).toBe("react");
  });
});
