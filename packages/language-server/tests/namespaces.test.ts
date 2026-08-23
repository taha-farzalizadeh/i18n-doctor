import { describe, expect, it } from "vitest";
import { HOME_TSX, namespacedProject } from "./fixtures.js";
import { find, fixture, harness, json, underlined, writeFiles } from "./helpers.js";
import { displayKey } from "../src/diagnostics.js";

describe("namespace-aware diagnostics", () => {
  it("keeps identical key names in different namespaces distinct", async () => {
    const root = await fixture(namespacedProject());
    const h = harness(root);
    await h.start();

    // home:SAVE and settings:SAVE are used; profile:SAVE is not.
    expect(h.diagnosticsFor("public/locales/en/home.json")).toEqual([]);
    expect(h.diagnosticsFor("public/locales/en/settings.json")).toEqual([]);

    const unused = find(
      h.diagnosticsFor("public/locales/en/profile.json"),
      "unused-key",
    );
    expect(unused).toBeDefined();
    expect(unused?.message).toBe(
      'Unused translation key "profile:SAVE" — defined but never used.',
    );
    expect(unused?.data?.namespace).toBe("profile");
    expect(unused?.data?.key).toBe("SAVE");
  });

  it("resolves a bare key against the namespace from useTranslation", async () => {
    const root = await fixture(namespacedProject());
    const h = harness(root);
    await h.start();

    const missingInHome = `import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation("home");
  return <button>{t("CANCEL")}</button>;
}
`;
    await h.open("src/Home.tsx", missingInHome);

    const diagnostic = find(h.diagnosticsFor("src/Home.tsx"), "missing-key");
    expect(diagnostic?.message).toBe(
      'Translation key "home:CANCEL" does not exist.',
    );
    expect(diagnostic?.data?.namespace).toBe("home");
    expect(underlined(missingInHome, diagnostic!)).toBe('"CANCEL"');
  });

  it("does not satisfy a key from a sibling namespace", async () => {
    // CANCEL only exists in settings, but Home resolves against home.
    const root = await fixture(
      namespacedProject({
        "public/locales/en/settings.json": json({
          SAVE: "Save settings",
          CANCEL: "Cancel",
        }),
        "src/Home.tsx": `import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation("home");
  return <button>{t("CANCEL")}</button>;
}
`,
      }),
    );
    const h = harness(root);
    await h.start();

    expect(h.codesFor("src/Home.tsx")).toEqual(["missing-key"]);
    expect(
      find(h.diagnosticsFor("public/locales/en/settings.json"), "unused-key")
        ?.data?.key,
    ).toBe("CANCEL");
  });

  it("clears the diagnostic when the key is added to the right namespace", async () => {
    const root = await fixture(
      namespacedProject({
        "src/Home.tsx": `import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation("home");
  return <>{t("SAVE")}{t("CANCEL")}</>;
}
`,
      }),
    );
    const h = harness(root);
    await h.start();
    expect(h.codesFor("src/Home.tsx")).toEqual(["missing-key"]);

    // Adding CANCEL to the wrong namespace does not help.
    await writeFiles(root, {
      "public/locales/en/profile.json": json({ SAVE: "Save profile", CANCEL: "Cancel" }),
    });
    await h.watched([
      { relativePath: "public/locales/en/profile.json", type: "changed" },
    ]);
    expect(h.codesFor("src/Home.tsx")).toEqual(["missing-key"]);

    // Adding it to `home` clears it.
    await writeFiles(root, {
      "public/locales/en/home.json": json({ SAVE: "Save", CANCEL: "Cancel" }),
    });
    await h.watched([
      { relativePath: "public/locales/en/home.json", type: "changed" },
    ]);
    expect(h.diagnosticsFor("src/Home.tsx")).toEqual([]);
  });

  it("tracks a namespace switch inside an open document", async () => {
    const root = await fixture(namespacedProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Home.tsx", HOME_TSX);
    expect(h.diagnosticsFor("src/Home.tsx")).toEqual([]);

    // Point the component at the namespace that lacks nothing but is unused.
    const switched = HOME_TSX.replace(
      'useTranslation("home")',
      'useTranslation("profile")',
    );
    await h.change("src/Home.tsx", switched, 2);

    expect(h.diagnosticsFor("src/Home.tsx")).toEqual([]);
    // home:SAVE is now the unused one, profile:SAVE is used.
    expect(h.diagnosticsFor("public/locales/en/profile.json")).toEqual([]);
    expect(
      find(h.diagnosticsFor("public/locales/en/home.json"), "unused-key")?.message,
    ).toBe('Unused translation key "home:SAVE" — defined but never used.');
  });

  it("reports a new namespace file appearing on disk", async () => {
    const root = await fixture(namespacedProject());
    const h = harness(root);
    await h.start();

    await writeFiles(root, {
      "public/locales/en/checkout.json": json({ PAY: "Pay" }),
    });
    await h.watched([
      { relativePath: "public/locales/en/checkout.json", type: "created" },
    ]);

    expect(
      find(h.diagnosticsFor("public/locales/en/checkout.json"), "unused-key")
        ?.message,
    ).toBe('Unused translation key "checkout:PAY" — defined but never used.');
  });

  it("flags a usage whose namespace cannot be resolved", async () => {
    const legacy = `import i18next from "i18next";
export const Legacy = () => i18next.t("SAVE");
`;
    // A namespaced catalog alongside a legacy flat one: `SAVE` matches the flat
    // definition by key, so it is not missing — but which namespace applies is
    // genuinely unknown.
    const root = await fixture({
      "package.json": namespacedProject()["package.json"]!,
      "public/locales/en/home.json": json({ TITLE: "Home" }),
      "locales/en.json": json({ SAVE: "Save" }),
      "src/Home.tsx": `import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation("home");
  return <h1>{t("TITLE")}</h1>;
}
`,
      "src/Legacy.tsx": legacy,
    });
    const h = harness(root);
    await h.start();

    const diagnostic = find(
      h.diagnosticsFor("src/Legacy.tsx"),
      "namespace-unresolved",
    );
    expect(diagnostic).toBeDefined();
    // Information, not error: the key may well be fine.
    expect(diagnostic?.severity).toBe(3);
    expect(diagnostic?.message).toBe(
      'Cannot resolve the namespace for translation key "SAVE"; it may not match any translation source.',
    );
    expect(underlined(legacy, diagnostic!)).toBe('"SAVE"');
    // The resolvable usage is left alone.
    expect(h.diagnosticsFor("src/Home.tsx")).toEqual([]);
  });

  it("never doubles up with missing-key on the same span", async () => {
    // `SAVE` exists only under namespaces the bare call cannot resolve.
    const root = await fixture(
      namespacedProject({
        "src/Bare.tsx": `import i18next from "i18next";\nexport const B = () => i18next.t("SAVE");\n`,
      }),
    );
    const h = harness(root);
    await h.start();

    expect(h.codesFor("src/Bare.tsx")).toEqual(["missing-key"]);
  });

  it("prefixes the namespace in display keys without flattening", () => {
    expect(displayKey("SAVE", "home")).toBe("home:SAVE");
    expect(displayKey("SAVE", undefined)).toBe("SAVE");
    // An already-qualified key is left alone.
    expect(displayKey("home:SAVE", "home")).toBe("home:SAVE");
    expect(displayKey("auth.login", undefined)).toBe("auth.login");
  });
});
