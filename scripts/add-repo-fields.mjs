import fs from "fs";

const packages = [
  "ast", "scanner", "constants", "imports", "detect", "templates",
  "resolve", "callgraph", "config", "dataflow", "context", "sources",
  "usages", "coverage", "issues", "cli"
];

for (const pkg of packages) {
  const path = `packages/${pkg}/package.json`;
  const p = JSON.parse(fs.readFileSync(path, "utf8"));
  p.repository = {
    type: "git",
    url: "git+https://github.com/taha-farzalizadeh/i18n-doctor.git",
    directory: `packages/${pkg}`
  };
  p.homepage = "https://github.com/taha-farzalizadeh/i18n-doctor#readme";
  p.bugs = { url: "https://github.com/taha-farzalizadeh/i18n-doctor/issues" };
  p.license = "MIT";
  fs.writeFileSync(path, JSON.stringify(p, null, 2) + "\n");
  console.log(`✓ ${pkg}`);
}
