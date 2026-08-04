import { describe, expect, it } from "vitest";
import { mergeLocaleCatalogs } from "../src/index.js";
import { catalog, keyDef } from "./helpers.js";

describe("mergeLocaleCatalogs", () => {
  it("groups keys by namespace and locale", () => {
    const c = catalog("/proj", [
      keyDef("hello", "locales/en/common.json", "en", {
        namespace: "common",
      }),
      keyDef("hello", "locales/fa/common.json", "fa", {
        namespace: "common",
      }),
      keyDef("title", "locales/en/home.json", "en", { namespace: "home" }),
    ]);

    const model = mergeLocaleCatalogs([c]);
    expect(model.locales).toEqual(["en", "fa"]);
    expect(model.namespaces).toEqual(["common", "home"]);
    expect(
      model.byNamespace.get("common")?.entries.get("hello")?.has("fa"),
    ).toBe(true);
    expect(model.byNamespace.get("common")?.tree.leafCount).toBe(1);
  });

  it("merges monorepo catalogs", () => {
    const a = catalog("/ws/packages/a", [
      keyDef("a.only", "en.json", "en", { namespace: "ns" }),
    ]);
    const b = catalog("/ws/packages/b", [
      keyDef("b.only", "en.json", "en", { namespace: "ns" }),
      keyDef("b.only", "fa.json", "fa", { namespace: "ns" }),
    ]);
    const model = mergeLocaleCatalogs([a, b]);
    expect(model.byNamespace.get("ns")?.entries.has("a.only")).toBe(true);
    expect(model.byNamespace.get("ns")?.entries.has("b.only")).toBe(true);
    expect(model.locales).toEqual(["en", "fa"]);
  });

  it("applies ignoreKeys and minConfidence", () => {
    const c = catalog("/proj", [
      keyDef("keep", "en.json", "en"),
      keyDef("debug.x", "en.json", "en"),
      keyDef("low", "en.json", "en", { confidence: 0.1 }),
    ]);
    const model = mergeLocaleCatalogs([c], {
      ignoreKeys: ["debug.*"],
      minConfidence: 0.5,
    });
    const entries = model.byNamespace.get("*")?.entries;
    expect(entries?.has("keep")).toBe(true);
    expect(entries?.has("debug.x")).toBe(false);
    expect(entries?.has("low")).toBe(false);
  });
});
