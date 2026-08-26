import { describe, expect, it } from "vitest";
import { createIssueEngine } from "../src/index.js";
import { ROOT, def, use } from "./helpers.js";

describe("issue engine — unused key", () => {
  it("flags a key with zero usages", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("auth.login.title", "src/locales/en/auth.json", 24, {
          locale: "en",
          namespace: "auth",
        }),
      ],
      usages: [],
    });

    expect(result.stats.unusedKey).toBe(1);
    expect(result.stats.missingKey).toBe(0);
    const issue = result.issues[0]!;
    expect(issue.type).toBe("unused-key");
    expect(issue.severity).toBe("warning");
    expect(issue.key).toBe("auth.login.title");
    expect(issue.location).toMatchObject({
      relativePath: "src/locales/en/auth.json",
      absolutePath: `${ROOT}/src/locales/en/auth.json`,
      line: 24,
      column: 1,
    });
    expect(issue.relatedLocations).toEqual([]);
    expect(issue.message).toMatch(/Unused translation key "auth\.login\.title"/);
    expect(issue.source.kind).toBe("definition");
  });

  it("does not flag a used key", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("home.title", "locales/en.json", 1, { locale: "en" }),
      ],
      usages: [use("home.title", "src/Home.tsx", 12)],
    });

    expect(result.stats.unusedKey).toBe(0);
    expect(result.stats.missingKey).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("softens unused keys that match a dynamic usage prefix", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("HELLO_ALL", "locales/en.json", 1, { locale: "en" }),
        def("OTHER_KEY", "locales/en.json", 2, { locale: "en" }),
      ],
      usages: [],
      dynamicUsages: [
        {
          absolutePath: `${ROOT}/src/D.tsx`,
          relativePath: "src/D.tsx",
          line: 5,
          column: 10,
          prefixes: ["HELLO_"],
          suffixes: [],
          contains: [],
          confidence: 0.4,
        },
      ],
    });

    const hello = result.issues.find((i) => i.key === "HELLO_ALL");
    const other = result.issues.find((i) => i.key === "OTHER_KEY");
    expect(hello?.type).toBe("unused-key");
    expect(hello?.severity).toBe("info");
    expect(hello?.source.reason).toBe("dynamic-usage");
    expect(hello?.message).toMatch(/may be unused/);
    expect(hello?.message).toMatch(/HELLO_/);
    expect(hello?.message).toMatch(/src\/D\.tsx:5/);
    expect(hello?.relatedLocations[0]?.relativePath).toBe("src/D.tsx");

    expect(other?.severity).toBe("warning");
    expect(other?.source.reason).toBeUndefined();
    expect(other?.message).toMatch(/Unused translation key/);
  });

  it("flags untranslated static text", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [],
      usages: [],
      untranslatedLiterals: [
        {
          text: "Welcome back",
          absolutePath: `${ROOT}/src/Login.tsx`,
          relativePath: "src/Login.tsx",
          line: 6,
          column: 10,
          confidence: 0.85,
          context: "jsx-text",
          library: "react-i18next",
        },
      ],
    });
    expect(result.stats.untranslatedText).toBe(1);
    const issue = result.issues[0]!;
    expect(issue.type).toBe("untranslated-text");
    expect(issue.severity).toBe("info");
    expect(issue.message).toMatch(/no translation/);
    expect(issue.source.kind).toBe("literal");
  });

  it("emits an unused issue for every locale that defines the key", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("auth.login.title", "src/locales/fr/auth.json", 10, {
          locale: "fr",
          namespace: "auth",
        }),
        def("auth.login.title", "src/locales/en/auth.json", 24, {
          locale: "en",
          namespace: "auth",
        }),
        def("auth.login.title", "src/locales/de/auth.json", 3, {
          locale: "de",
          namespace: "auth",
        }),
      ],
      usages: [],
    });

    expect(result.stats.unusedKey).toBe(3);
    const unused = result.issues.filter((i) => i.type === "unused-key");
    expect(unused.map((i) => i.location.relativePath).sort()).toEqual([
      "src/locales/de/auth.json",
      "src/locales/en/auth.json",
      "src/locales/fr/auth.json",
    ]);
    // Each issue points at the other locales as related definitions.
    expect(unused[0]!.relatedLocations).toHaveLength(2);
  });
});

describe("issue engine — missing key", () => {
  it("flags a usage with no definition", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [def("home.title", "locales/en.json", 1, { locale: "en" })],
      usages: [
        use("checkout.payment", "src/pages/Checkout.tsx", 81, {
          library: "react-i18next",
        }),
        use("checkout.payment", "src/pages/Checkout.tsx", 90),
      ],
    });

    expect(result.stats.missingKey).toBe(1);
    const issue = result.issues[0]!;
    expect(issue.type).toBe("missing-key");
    expect(issue.severity).toBe("error");
    expect(issue.key).toBe("checkout.payment");
    expect(issue.location).toMatchObject({
      relativePath: "src/pages/Checkout.tsx",
      line: 81,
      column: 8,
    });
    expect(issue.relatedLocations).toHaveLength(1);
    expect(issue.relatedLocations[0]?.line).toBe(90);
    expect(issue.source).toMatchObject({
      kind: "usage",
      library: "react-i18next",
    });
    expect(issue.message).toMatch(/Missing translation key "checkout\.payment"/);
  });
});

describe("issue engine — duplicate key", () => {
  it("flags the same key twice in the same locale/namespace", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("nav.home", "locales/en/extra.json", 8, {
          locale: "en",
          namespace: "common",
        }),
        def("nav.home", "locales/en/common.json", 3, {
          locale: "en",
          namespace: "common",
        }),
      ],
      usages: [use("nav.home", "src/App.tsx", 2, { namespace: "common" })],
    });

    expect(result.stats.duplicateKey).toBe(1);
    expect(result.stats.unusedKey).toBe(0);
    const issue = result.issues.find((i) => i.type === "duplicate-key")!;
    // Deterministic primary: path sort → common.json before extra.json
    expect(issue.location.relativePath).toBe("locales/en/common.json");
    expect(issue.relatedLocations).toHaveLength(1);
    expect(issue.relatedLocations[0]?.relativePath).toBe(
      "locales/en/extra.json",
    );
    expect(issue.source.kind).toBe("definition-collision");
    expect(issue.message).toContain('locale "en"');
    expect(issue.message).toContain('namespace "common"');
  });

  it("does not flag the same key across different locales as duplicate", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("nav.home", "locales/en.json", 1, { locale: "en" }),
        def("nav.home", "locales/fr.json", 1, { locale: "fr" }),
      ],
      usages: [use("nav.home", "src/App.tsx", 1)],
    });
    expect(result.stats.duplicateKey).toBe(0);
  });
});

describe("issue engine — multiple locales", () => {
  it("treats a key used once as used for all locale definitions", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("greeting", "locales/en.json", 1, { locale: "en" }),
        def("greeting", "locales/fr.json", 1, { locale: "fr" }),
        def("farewell", "locales/en.json", 2, { locale: "en" }),
        def("farewell", "locales/fr.json", 2, { locale: "fr" }),
      ],
      usages: [use("greeting", "src/App.tsx", 1)],
    });

    expect(result.stats.unusedKey).toBe(2);
    const unused = result.issues.filter((i) => i.type === "unused-key");
    expect(unused.map((i) => i.key)).toEqual(["farewell", "farewell"]);
    expect(unused.map((i) => i.location.relativePath).sort()).toEqual([
      "locales/en.json",
      "locales/fr.json",
    ]);
  });

  it("respects strictLocale for missing keys", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("only.fr", "locales/fr.json", 1, { locale: "fr" }),
      ],
      usages: [use("only.fr", "src/App.tsx", 1)],
      options: { defaultLocale: "en", strictLocale: true },
    });

    expect(result.stats.missingKey).toBe(1);
  });
});

describe("issue engine — namespaces", () => {
  it("matches namespaced usage to the same namespaced definition", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "messages/en.json", 1, {
          locale: "en",
          namespace: "HomePage",
        }),
      ],
      usages: [use("title", "src/page.tsx", 4, { namespace: "HomePage" })],
    });
    expect(result.issues).toHaveLength(0);
  });

  it("does not soft-match unnamespaced usage to a namespaced definition", () => {
    // Prevents false "used" across all namespaces when call-site ns is missing.
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "messages/en.json", 1, {
          locale: "en",
          namespace: "HomePage",
        }),
      ],
      usages: [use("title", "src/page.tsx", 4)],
    });
    expect(result.stats.unusedKey).toBe(1);
    expect(result.stats.missingKey).toBe(1);
  });

  it("applies defaultNS when usage has no call-site namespace", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "messages/en.json", 1, {
          locale: "en",
          namespace: "common",
        }),
      ],
      usages: [use("title", "src/page.tsx", 4)],
      options: { defaultNS: "common" },
    });
    expect(result.stats.unusedKey).toBe(0);
    expect(result.stats.missingKey).toBe(0);
  });

  it("uses fallbackNS as secondary match candidates", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "messages/en.json", 1, {
          locale: "en",
          namespace: "common",
        }),
      ],
      usages: [use("title", "src/page.tsx", 4, { namespace: "home" })],
      options: { fallbackNS: ["common"] },
    });
    expect(result.stats.unusedKey).toBe(0);
    expect(result.stats.missingKey).toBe(0);
  });

  it("ignores namespaces when matchNamespace is false", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "a.json", 1, { namespace: "HomePage" }),
      ],
      usages: [use("title", "src/page.tsx", 4, { namespace: "Auth" })],
      options: { matchNamespace: false },
    });
    expect(result.issues).toHaveLength(0);
  });
});

describe("issue engine — same key in different namespaces", () => {
  it("does not treat different namespaces as the same key", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "locales/en/home.json", 1, {
          locale: "en",
          namespace: "HomePage",
        }),
      ],
      usages: [use("title", "src/Auth.tsx", 4, { namespace: "Auth" })],
    });

    // HomePage:title is unused; Auth:title is missing
    expect(result.stats.unusedKey).toBe(1);
    expect(result.stats.missingKey).toBe(1);
    expect(
      result.issues.find((i) => i.type === "unused-key")?.source.namespace,
    ).toBe("HomePage");
    expect(
      result.issues.find((i) => i.type === "missing-key")?.source.namespace,
    ).toBe("Auth");
  });

  it("tracks each namespace independently when both are defined and used", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "locales/en/home.json", 1, {
          locale: "en",
          namespace: "HomePage",
        }),
        def("title", "locales/en/auth.json", 1, {
          locale: "en",
          namespace: "Auth",
        }),
      ],
      usages: [
        use("title", "src/Home.tsx", 1, { namespace: "HomePage" }),
        use("title", "src/Auth.tsx", 1, { namespace: "Auth" }),
      ],
    });
    expect(result.issues).toHaveLength(0);
  });

  it("does not flag duplicates across namespaces", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("title", "locales/en/home.json", 1, {
          locale: "en",
          namespace: "HomePage",
        }),
        def("title", "locales/en/auth.json", 1, {
          locale: "en",
          namespace: "Auth",
        }),
      ],
      usages: [
        use("title", "src/Home.tsx", 1, { namespace: "HomePage" }),
        use("title", "src/Auth.tsx", 1, { namespace: "Auth" }),
      ],
    });
    expect(result.stats.duplicateKey).toBe(0);
  });
});

describe("issue engine — determinism", () => {
  it("sorts issues stably: missing, duplicate, unused; then key/path/line", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("z.unused", "b.json", 1),
        def("a.unused", "a.json", 1),
        def("dup", "dup-b.json", 2, { locale: "en" }),
        def("dup", "dup-a.json", 1, { locale: "en" }),
      ],
      usages: [
        use("missing.b", "src/b.tsx", 2),
        use("missing.a", "src/a.tsx", 1),
        use("dup", "src/dup.tsx", 1),
      ],
    });

    expect(result.issues.map((i) => `${i.type}:${i.key}`)).toEqual([
      "missing-key:missing.a",
      "missing-key:missing.b",
      "duplicate-key:dup",
      "unused-key:a.unused",
      "unused-key:z.unused",
    ]);
  });

  it("produces identical issue lists for shuffled inputs", () => {
    const definitions = [
      def("k", "z.json", 9, { locale: "en" }),
      def("k", "a.json", 1, { locale: "en" }),
      def("unused", "u.json", 1),
    ];
    const usages = [
      use("missing", "src/z.tsx", 9),
      use("k", "src/a.tsx", 1),
      use("missing", "src/a.tsx", 1),
    ];

    const a = createIssueEngine().analyze({
      root: ROOT,
      definitions,
      usages,
    });
    const b = createIssueEngine().analyze({
      root: ROOT,
      definitions: [...definitions].reverse(),
      usages: [...usages].reverse(),
    });

    expect(
      a.issues.map((i) => ({
        type: i.type,
        key: i.key,
        file: i.location.relativePath,
        line: i.location.line,
        related: i.relatedLocations.map((l) => `${l.relativePath}:${l.line}`),
      })),
    ).toEqual(
      b.issues.map((i) => ({
        type: i.type,
        key: i.key,
        file: i.location.relativePath,
        line: i.location.line,
        related: i.relatedLocations.map((l) => `${l.relativePath}:${l.line}`),
      })),
    );
  });

  it("allows per-analyze severity overrides without CLI knowledge", () => {
    const engine = createIssueEngine({
      severities: { unusedKey: "info" },
    });
    const result = engine.analyze({
      root: ROOT,
      definitions: [def("only.def", "a.json", 1)],
      usages: [],
      options: { severities: { unusedKey: "warning" } },
    });
    expect(result.issues[0]?.severity).toBe("warning");
  });
});
