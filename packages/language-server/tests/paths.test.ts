import path from "node:path";
import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX } from "./fixtures.js";
import { fixture, harness } from "./helpers.js";
import {
  isWithin,
  normalizePath,
  normalizeUri,
  pathKey,
  pathToUri,
  resolveWorkspaceRoots,
  uriToPath,
} from "../src/workspace.js";

describe("unix paths", () => {
  it("round-trips an absolute path", () => {
    const uri = pathToUri("/home/dev/app/src/App.tsx", "posix");
    expect(uri).toBe("file:///home/dev/app/src/App.tsx");
    expect(uriToPath(uri, "posix")).toBe("/home/dev/app/src/App.tsx");
  });

  it("encodes and decodes characters that need escaping", () => {
    const original = "/home/dev/my app/#1/ü.json";
    const uri = pathToUri(original, "posix");
    expect(uri).toBe("file:///home/dev/my%20app/%231/%C3%BC.json");
    expect(uriToPath(uri, "posix")).toBe(original);
  });

  it("handles the filesystem root", () => {
    expect(pathToUri("/", "posix")).toBe("file:///");
    expect(uriToPath("file:///", "posix")).toBe("/");
  });

  it("normalizes redundant segments", () => {
    expect(normalizePath("/a/b/../c//d/./e", "posix")).toBe("/a/c/d/e");
  });

  it("treats a directory prefix that is not a path boundary as outside", () => {
    expect(isWithin("/home/dev/app", "/home/dev/app/src/x.ts", "posix")).toBe(
      true,
    );
    expect(isWithin("/home/dev/app", "/home/dev/app", "posix")).toBe(true);
    expect(isWithin("/home/dev/app", "/home/dev/application/x.ts", "posix")).toBe(
      false,
    );
  });

  it("ignores a trailing slash on the parent", () => {
    expect(isWithin("/home/dev/app/", "/home/dev/app/src/x.ts", "posix")).toBe(
      true,
    );
  });
});

describe("windows paths", () => {
  it("round-trips a drive path", () => {
    const uri = pathToUri("C:\\Users\\dev\\app\\src\\App.tsx", "win32");
    expect(uri).toBe("file:///C:/Users/dev/app/src/App.tsx");
    expect(uriToPath(uri, "win32")).toBe("C:\\Users\\dev\\app\\src\\App.tsx");
  });

  it("accepts the percent-encoded drive form some clients send", () => {
    expect(uriToPath("file:///c%3A/Users/dev/app", "win32")).toBe(
      "c:\\Users\\dev\\app",
    );
    expect(normalizeUri("file:///c%3A/Users/dev/app", "win32")).toBe(
      "file:///C:/Users/dev/app",
    );
  });

  it("uppercases the drive letter so keys agree across clients", () => {
    expect(normalizePath("c:\\users\\dev", "win32")).toBe("C:\\users\\dev");
    expect(pathKey("c:\\Users\\Dev\\App.tsx", "win32")).toBe(
      "c:/users/dev/app.tsx",
    );
  });

  it("treats drive-letter case and separators as the same file", () => {
    const a = pathKey("C:\\project\\src\\App.tsx", "win32");
    expect(pathKey("c:/project/src/app.tsx", "win32")).toBe(a);
    expect(pathKey("C:\\project\\.\\src\\App.tsx", "win32")).toBe(a);
  });

  it("round-trips a UNC share", () => {
    const uri = pathToUri("\\\\build-server\\share\\app\\src\\App.tsx", "win32");
    expect(uri).toBe("file://build-server/share/app/src/App.tsx");
    expect(uriToPath(uri, "win32")).toBe(
      "\\\\build-server\\share\\app\\src\\App.tsx",
    );
  });

  it("treats a localhost authority as a local path", () => {
    expect(uriToPath("file://localhost/C:/app/src/App.tsx", "win32")).toBe(
      "C:\\app\\src\\App.tsx",
    );
  });

  it("scopes containment checks case-insensitively", () => {
    expect(isWithin("C:\\Project", "c:\\project\\src\\App.tsx", "win32")).toBe(
      true,
    );
    expect(isWithin("C:\\Project", "C:\\ProjectOther\\x.ts", "win32")).toBe(
      false,
    );
  });
});

describe("uri handling", () => {
  it("passes through a uri that is already a file uri", () => {
    expect(pathToUri("file:///home/dev/app", "posix")).toBe(
      "file:///home/dev/app",
    );
  });

  it("ignores non-file schemes", () => {
    expect(uriToPath("untitled:Untitled-1")).toBeUndefined();
    expect(uriToPath("vscode-vfs://github/org/repo/a.ts")).toBeUndefined();
    expect(uriToPath("http://example.com/a.ts")).toBeUndefined();
    // A non-file uri is returned unchanged rather than mangled.
    expect(normalizeUri("untitled:Untitled-1")).toBe("untitled:Untitled-1");
  });

  it("strips a query string and fragment", () => {
    expect(uriToPath("file:///home/dev/a.ts?v=2#L10", "posix")).toBe(
      "/home/dev/a.ts",
    );
  });

  it("survives an invalid percent escape", () => {
    expect(uriToPath("file:///home/dev/100%.json", "posix")).toBe(
      "/home/dev/100%.json",
    );
  });
});

describe("workspace roots", () => {
  const posix = { platform: "posix" } as const;

  it("prefers workspaceFolders over the deprecated single-root fields", () => {
    const roots = resolveWorkspaceRoots(
      {
        rootUri: "file:///legacy/root",
        rootPath: "/legacy/root",
        workspaceFolders: [
          { uri: "file:///work/a" },
          { uri: "file:///work/b" },
        ],
      },
      posix,
    );
    expect(roots).toEqual(["/work/a", "/work/b"]);
  });

  it("falls back to rootUri, then rootPath, then the cwd", () => {
    expect(
      resolveWorkspaceRoots({ rootUri: "file:///work/a" }, posix),
    ).toEqual(["/work/a"]);
    expect(resolveWorkspaceRoots({ rootPath: "/work/b" }, posix)).toEqual([
      "/work/b",
    ]);
    expect(
      resolveWorkspaceRoots({}, { platform: "posix", cwd: "/fallback/cwd" }),
    ).toEqual(["/fallback/cwd"]);
  });

  it("drops duplicate and non-file folders", () => {
    const roots = resolveWorkspaceRoots(
      {
        workspaceFolders: [
          { uri: "file:///work/a" },
          { uri: "file:///work/a/" },
          { uri: "untitled:nope" },
        ],
      },
      posix,
    );
    expect(roots).toEqual(["/work/a"]);
  });

  it("ignores an empty or null workspaceFolders", () => {
    expect(
      resolveWorkspaceRoots(
        { workspaceFolders: [], rootUri: "file:///work/a" },
        posix,
      ),
    ).toEqual(["/work/a"]);
    expect(
      resolveWorkspaceRoots(
        { workspaceFolders: null, rootUri: "file:///work/a" },
        posix,
      ),
    ).toEqual(["/work/a"]);
  });
});

describe("real filesystem paths", () => {
  it("analyzes a project inside a directory with spaces and unicode", async () => {
    const nested = "my project ü";
    const files = Object.fromEntries(
      Object.entries(flatProject()).map(([relative, content]) => [
        `${nested}/${relative}`,
        content,
      ]),
    );
    const base = await fixture(files);

    const h = harness(path.join(base, nested));
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    expect(h.uri("src/Login.tsx")).toContain("my%20project%20%C3%BC");
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
  });

  it("analyzes a project reached through a path with redundant segments", async () => {
    const base = await fixture(flatProject());

    const h = harness(path.join(base, "src", ".."));
    await h.start();

    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
  });
});
