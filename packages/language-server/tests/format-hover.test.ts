import { describe, expect, it } from "vitest";
import type { HoverModel } from "@i18n-doctor/translation-index";
import { formatHoverMarkdown } from "../src/intelligence/format.js";

describe("formatHoverMarkdown", () => {
  it("puts a colon after locale labels and lists every locale source", () => {
    const model: HoverModel = {
      key: "DATASETS_MANAGEMENT_PAGE",
      namespace: "datasets",
      missing: false,
      locales: [
        {
          locale: "en",
          value: "Datasets management",
          relativePath: "src/app/pages/datasets/i18n/en.ts",
          line: 9,
        },
        {
          locale: "fa",
          value: "مدیریت داده",
          relativePath: "src/app/pages/datasets/i18n/fa.ts",
          line: 9,
        },
      ],
      source: {
        relativePath: "src/app/pages/datasets/i18n/en.ts",
        line: 9,
      },
    };

    const md = formatHoverMarkdown(model);
    expect(md).toBe(
      [
        "`DATASETS_MANAGEMENT_PAGE`",
        "",
        "English: Datasets management",
        "Persian: مدیریت داده",
        "",
        "Namespace: datasets",
        "",
        "Source",
        "English: `src/app/pages/datasets/i18n/en.ts:9`",
        "Persian: `src/app/pages/datasets/i18n/fa.ts:9`",
      ].join("\n"),
    );
  });

  it("formats missing keys with a namespace colon", () => {
    const md = formatHoverMarkdown({
      key: "MISSING",
      namespace: "home",
      missing: true,
      locales: [],
    });
    expect(md).toContain("**Missing translation**");
    expect(md).toContain("Namespace: home");
  });
});
