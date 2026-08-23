import { describe, expect, it } from "vitest";
import { PKG_REACT_I18NEXT } from "./fixtures.js";
import { find, fixture, harness, json, underlined } from "./helpers.js";

const CATALOG = json({ auth: { login: "Login" } });

/** Same component in four dialects, each using a key that does not exist. */
const VARIANTS = {
  "src/plain.js": `import { t } from "i18next";

export const label = () => t("auth.missingInJs");
`,
  "src/component.jsx": `import { useTranslation } from "react-i18next";

export function Component() {
  const { t } = useTranslation();
  return <span>{t("auth.missingInJsx")}</span>;
}
`,
  "src/service.ts": `import i18next from "i18next";

export function label(): string {
  return i18next.t("auth.missingInTs");
}
`,
  "src/View.tsx": `import { useTranslation } from "react-i18next";

export function View(): JSX.Element {
  const { t } = useTranslation();
  return <p>{t("auth.missingInTsx")}</p>;
}
`,
} as const;

describe("language coverage", () => {
  it("reports usages in JS, JSX, TS, and TSX", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.json": CATALOG,
      ...VARIANTS,
    });
    const h = harness(root);
    await h.start();

    const expected: Record<string, string> = {
      "src/plain.js": "auth.missingInJs",
      "src/component.jsx": "auth.missingInJsx",
      "src/service.ts": "auth.missingInTs",
      "src/View.tsx": "auth.missingInTsx",
    };

    for (const [file, key] of Object.entries(expected)) {
      const diagnostic = find(h.diagnosticsFor(file), "missing-key", key);
      expect(diagnostic, file).toBeDefined();
      expect(underlined(VARIANTS[file as keyof typeof VARIANTS], diagnostic!)).toBe(
        `"${key}"`,
      );
    }
  });

  it("reports usages in open buffers of every dialect", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.json": CATALOG,
      ...VARIANTS,
    });
    const h = harness(root);
    await h.start();

    for (const [file, text] of Object.entries(VARIANTS)) {
      await h.open(file, text);
      expect(h.codesFor(file), file).toContain("missing-key");
    }
  });

  it("reads catalogs from JSON, YAML, and TS modules", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.json": json({ shared: { key: "A" }, onlyJson: { x: "1" } }),
      "locales/de.yaml": "shared:\n  key: B\nonlyYaml:\n  x: '2'\n",
      "locales/fr.ts": `export default {\n  shared: {\n    key: "C",\n  },\n  onlyTs: {\n    x: "3",\n  },\n};\n`,
      "src/App.tsx": `import { t } from "i18next";
export const App = () => t("shared.key");
`,
    });
    const h = harness(root);
    await h.start();

    // The used key resolves in all three formats.
    expect(h.codesFor("src/App.tsx")).toEqual([]);
    // Each format's own key is reported against its own file, which only
    // happens if that extractor ran and produced a location.
    expect(
      find(h.diagnosticsFor("locales/en.json"), "unused-key", "onlyJson.x"),
    ).toBeDefined();
    expect(
      find(h.diagnosticsFor("locales/de.yaml"), "unused-key", "onlyYaml.x"),
    ).toBeDefined();
    expect(
      find(h.diagnosticsFor("locales/fr.ts"), "unused-key", "onlyTs.x"),
    ).toBeDefined();
  });

  it("locates a key inside a TS catalog module", async () => {
    const catalog = `export default {\n  auth: {\n    login: "Login",\n    unused: "Unused",\n  },\n};\n`;
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.ts": catalog,
      "src/App.tsx": `import { t } from "i18next";\nexport const App = () => t("auth.login");\n`,
    });
    const h = harness(root);
    await h.start();

    const unused = find(
      h.diagnosticsFor("locales/en.ts"),
      "unused-key",
      "auth.unused",
    );
    expect(unused).toBeDefined();
    expect(unused?.range.start.line).toBe(3);
    expect(underlined(catalog, unused!)).toBe("unused");
  });
});

describe("multiple documents", () => {
  it("keeps per-document diagnostics independent", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.json": json({ a: { ok: "OK" } }),
      "src/Good.tsx": `import { t } from "i18next";\nexport const G = () => t("a.ok");\n`,
      "src/Bad1.tsx": `import { t } from "i18next";\nexport const B1 = () => t("a.bad1");\n`,
      "src/Bad2.tsx": `import { t } from "i18next";\nexport const B2 = () => t("a.bad2");\n`,
    });
    const h = harness(root);
    await h.start();

    expect(h.diagnosticsFor("src/Good.tsx")).toEqual([]);
    expect(find(h.diagnosticsFor("src/Bad1.tsx"), "missing-key")?.data?.key).toBe(
      "a.bad1",
    );
    expect(find(h.diagnosticsFor("src/Bad2.tsx"), "missing-key")?.data?.key).toBe(
      "a.bad2",
    );
  });

  it("fixing one document leaves the others untouched", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.json": json({ a: { ok: "OK" } }),
      "src/Bad1.tsx": `import { t } from "i18next";\nexport const B1 = () => t("a.bad1");\n`,
      "src/Bad2.tsx": `import { t } from "i18next";\nexport const B2 = () => t("a.bad2");\n`,
    });
    const h = harness(root);
    await h.start();
    await h.open(
      "src/Bad1.tsx",
      `import { t } from "i18next";\nexport const B1 = () => t("a.bad1");\n`,
    );

    await h.change(
      "src/Bad1.tsx",
      `import { t } from "i18next";\nexport const B1 = () => t("a.ok");\n`,
      2,
    );

    expect(h.diagnosticsFor("src/Bad1.tsx")).toEqual([]);
    expect(h.codesFor("src/Bad2.tsx")).toEqual(["missing-key"]);
  });

  it("holds many open documents at once", async () => {
    const files: Record<string, string> = {
      "package.json": PKG_REACT_I18NEXT,
      "locales/en.json": json({ a: { ok: "OK" } }),
    };
    for (let i = 0; i < 12; i += 1) {
      files[`src/File${i}.tsx`] =
        `import { t } from "i18next";\nexport const F${i} = () => t("a.gap${i}");\n`;
    }
    const root = await fixture(files);
    const h = harness(root);
    await h.start();

    for (let i = 0; i < 12; i += 1) {
      await h.open(`src/File${i}.tsx`, files[`src/File${i}.tsx`]!);
    }

    for (let i = 0; i < 12; i += 1) {
      expect(
        find(h.diagnosticsFor(`src/File${i}.tsx`), "missing-key")?.data?.key,
        `File${i}`,
      ).toBe(`a.gap${i}`);
    }
  });

  it("tracks several catalogs and several sources together", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "public/locales/en/home.json": json({ TITLE: "Home" }),
      "public/locales/en/cart.json": json({ TITLE: "Cart", STALE: "Stale" }),
      "public/locales/de/home.json": json({ TITLE: "Startseite" }),
      "src/Home.tsx": `import { useTranslation } from "react-i18next";
export function Home() {
  const { t } = useTranslation("home");
  return <h1>{t("TITLE")}</h1>;
}
`,
      "src/Cart.tsx": `import { useTranslation } from "react-i18next";
export function Cart() {
  const { t } = useTranslation("cart");
  return <h1>{t("TITLE")}{t("MISSING")}</h1>;
}
`,
    });
    const h = harness(root);
    await h.start();

    expect(h.diagnosticsFor("src/Home.tsx")).toEqual([]);
    expect(
      find(h.diagnosticsFor("src/Cart.tsx"), "missing-key")?.message,
    ).toBe('Translation key "cart:MISSING" does not exist.');
    expect(
      find(h.diagnosticsFor("public/locales/en/cart.json"), "unused-key")?.data
        ?.key,
    ).toBe("STALE");
    // `de` is missing the cart namespace entirely.
    expect(h.codesFor("public/locales/en/cart.json")).toContain(
      "missing-translation",
    );
  });
});
