import fs from "fs";

const packages = ["ast","scanner","constants","imports","detect","templates","resolve","callgraph","config","dataflow","context","sources","usages","coverage","issues","cli"];

for (const pkg of packages) {
  const path = `packages/${pkg}/package.json`;
  const p = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!p.files.includes("README.md")) {
    p.files.push("README.md");
  }
  // bump to 0.9.1
  p.version = "0.9.1";
  // bump internal deps too
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!p[section]) continue;
    for (const [dep, ver] of Object.entries(p[section])) {
      if (dep.startsWith("@i18n-doctor/") && ver === "0.9.0") {
        p[section][dep] = "0.9.1";
      }
    }
  }
  fs.writeFileSync(path, JSON.stringify(p, null, 2) + "\n");
  console.log(`✓ ${pkg}`);
}
