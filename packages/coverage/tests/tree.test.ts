import { describe, expect, it } from "vitest";
import { buildLocaleTree, splitKeyPath, walkLocaleTree } from "../src/index.js";
import type { TranslationKeyDefinition } from "@i18n-unused/sources";
import { keyDef } from "./helpers.js";

describe("splitKeyPath", () => {
  it("splits dotted nested keys", () => {
    expect(splitKeyPath("auth.login.title")).toEqual([
      "auth",
      "login",
      "title",
    ]);
  });

  it("keeps array indices with the segment", () => {
    expect(splitKeyPath("items[0].label")).toEqual(["items[0]", "label"]);
  });
});

describe("buildLocaleTree", () => {
  it("rebuilds nested structure and leaf locale maps", () => {
    const entries = new Map<
      string,
      Map<string, TranslationKeyDefinition>
    >([
      [
        "auth.login",
        new Map([
          ["en", keyDef("auth.login", "en.json", "en")],
          ["fa", keyDef("auth.login", "fa.json", "fa")],
        ]),
      ],
      [
        "auth.logout",
        new Map([["en", keyDef("auth.logout", "en.json", "en")]]),
      ],
    ]);

    const tree = buildLocaleTree(entries, ["en", "fa"], "common");
    expect(tree.namespace).toBe("common");
    expect(tree.leafCount).toBe(2);
    expect(tree.byKey.get("auth")?.children.has("login")).toBe(true);
    expect(tree.byKey.get("auth.login")?.byLocale.has("fa")).toBe(true);
    expect(tree.byKey.get("auth.logout")?.byLocale.has("fa")).toBe(false);

    const visited: string[] = [];
    walkLocaleTree(tree, (n) => {
      if (n.isLeaf) visited.push(n.fullKey);
    });
    expect(visited.sort()).toEqual(["auth.login", "auth.logout"]);
  });
});
