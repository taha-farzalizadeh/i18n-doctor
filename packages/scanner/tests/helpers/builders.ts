import path from "node:path";
import { ensureDir, makeSymlink, writeTree, type TreeFile } from "./fixture.js";

/** Realistic single-package TypeScript/React-style app. */
export function normalAppFiles(): TreeFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify({
        name: "acme-web",
        private: true,
        type: "module",
        dependencies: { react: "^19.0.0" },
      }),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true } }),
    },
    { path: "src/index.ts", content: 'export * from "./App.js";\n' },
    { path: "src/App.tsx", content: "export function App() { return null; }\n" },
    { path: "src/hooks/useTitle.ts", content: "export const useTitle = () => 'Acme';\n" },
    { path: "src/components/Button.jsx", content: "export const Button = () => null;\n" },
    { path: "src/utils/format.mjs", content: "export const format = (x) => x;\n" },
    { path: "src/legacy/old.cjs", content: "module.exports = {};\n" },
    { path: "locales/en.json", content: JSON.stringify({ hello: "Hello" }) },
    { path: "locales/fr.yml", content: "hello: Bonjour\n" },
    { path: "content/docs.mdx", content: "# Docs\n" },
    { path: "ui/Widget.vue", content: "<template><div /></template>\n" },
    { path: "ui/Chip.svelte", content: "<script></script>\n" },
    { path: "pages/home.astro", content: "---\n---\n<html></html>\n" },
    { path: "README.md", content: "# Acme\n" },
    { path: "dist/bundle.js", content: "/* generated */\n" },
    { path: "node_modules/react/index.js", content: "module.exports = {};\n" },
    { path: ".env", content: "SECRET=1\n" },
    { path: ".gitignore", content: "dist\n.env\n*.log\n" },
  ];
}

/** npm workspaces monorepo with two packages. */
export function npmWorkspaceFiles(): TreeFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify({
        name: "acme-monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
    },
    {
      path: "packages/web/package.json",
      content: JSON.stringify({ name: "@acme/web", private: true }),
    },
    { path: "packages/web/src/main.ts", content: "export const web = true;\n" },
    { path: "packages/web/src/App.tsx", content: "export const App = () => null;\n" },
    {
      path: "packages/api/package.json",
      content: JSON.stringify({ name: "@acme/api", private: true }),
    },
    { path: "packages/api/src/server.ts", content: "export const server = true;\n" },
    { path: "packages/api/src/routes.ts", content: "export const routes = [];\n" },
    { path: "packages/web/node_modules/left-pad/index.js", content: "module.exports=1;\n" },
    { path: "node_modules/typescript/lib/typescript.js", content: "module.exports=1;\n" },
  ];
}

/** pnpm-style workspace via pnpm-workspace.yaml. */
export function pnpmWorkspaceFiles(): TreeFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify({ name: "pnpm-root", private: true }),
    },
    {
      path: "pnpm-workspace.yaml",
      content: "packages:\n  - apps/*\n  - 'libs/*'\n",
    },
    {
      path: "apps/shop/package.json",
      content: JSON.stringify({ name: "@shop/app" }),
    },
    { path: "apps/shop/src/index.ts", content: "export {};\n" },
    {
      path: "libs/ui/package.json",
      content: JSON.stringify({ name: "@shop/ui" }),
    },
    { path: "libs/ui/src/Button.tsx", content: "export const Button = () => null;\n" },
  ];
}

export async function writeHugeProject(
  root: string,
  options: {
    sourceFiles?: number;
    ignoredFiles?: number;
    nestingDepth?: number;
  } = {},
): Promise<{ sourceFiles: number; ignoredFiles: number }> {
  const sourceFiles = options.sourceFiles ?? 200;
  const ignoredFiles = options.ignoredFiles ?? 5_000;
  const nestingDepth = options.nestingDepth ?? 8;

  await writeTree(root, [
    {
      path: "package.json",
      content: JSON.stringify({ name: "huge-app", private: true }),
    },
    { path: "src/index.ts", content: "export {};\n" },
  ]);

  const sourceWrites: TreeFile[] = [];
  for (let i = 0; i < sourceFiles; i += 1) {
    const dir = `src/features/feature-${i % 40}/nested-${i % 7}`;
    sourceWrites.push({
      path: `${dir}/module-${i}.ts`,
      content: `export const n${i} = ${i};\n`,
    });
  }
  await writeTree(root, sourceWrites);

  // Deep nested ignored tree (simulates node_modules / build output volume)
  let ignoredDir = "node_modules/.pnpm";
  for (let d = 0; d < nestingDepth; d += 1) {
    ignoredDir += `/pkg@${d}.0.0/node_modules/dep-${d}`;
  }
  await ensureDir(root, ignoredDir);

  const ignoredWrites: TreeFile[] = [];
  for (let i = 0; i < ignoredFiles; i += 1) {
    ignoredWrites.push({
      path: `${ignoredDir}/file-${i}.js`,
      content: `module.exports=${i};\n`,
    });
    if (ignoredWrites.length >= 250) {
      await writeTree(root, ignoredWrites);
      ignoredWrites.length = 0;
    }
  }
  if (ignoredWrites.length > 0) {
    await writeTree(root, ignoredWrites);
  }

  // Also a deep source nest that should be discovered
  const deepSourceParts = Array.from({ length: nestingDepth }, (_, i) => `lvl${i}`);
  await writeTree(root, [
    {
      path: `src/deep/${deepSourceParts.join("/")}/leaf.ts`,
      content: "export const leaf = true;\n",
    },
  ]);

  return { sourceFiles: sourceFiles + 2, ignoredFiles };
}

export async function writeSymlinkFixture(root: string): Promise<void> {
  await writeTree(root, [
    {
      path: "package.json",
      content: JSON.stringify({ name: "symlink-app", private: true }),
    },
    { path: "src/real.ts", content: "export const real = 1;\n" },
    { path: "src/inside/target.ts", content: "export const target = 1;\n" },
    { path: "vendor/shared.ts", content: "export const shared = 1;\n" },
  ]);

  await makeSymlink(
    path.join(root, "src/real.ts"),
    path.join(root, "src/alias.ts"),
    "file",
  );
  await makeSymlink(
    path.join(root, "src/inside"),
    path.join(root, "src/linked-dir"),
    "dir",
  );
  await makeSymlink(
    path.join(root, "vendor/shared.ts"),
    path.join(root, "src/from-vendor.ts"),
    "file",
  );

  // Broken symlink
  await makeSymlink(
    path.join(root, "src/does-not-exist.ts"),
    path.join(root, "src/broken.ts"),
    "file",
  );

  // Escape outside root
  await makeSymlink(
    path.join(root, ".."),
    path.join(root, "src/escape-link"),
    "dir",
  );
}
