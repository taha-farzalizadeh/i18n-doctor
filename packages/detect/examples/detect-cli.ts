/**
 * Example CLI usage for @i18n-doctor/detect
 *
 *   npx tsx packages/detect/examples/detect-cli.ts [root]
 */

import path from "node:path";
import {
  createDetector,
  formatDetectionReport,
} from "../src/index.js";

const root = path.resolve(process.argv[2] ?? process.cwd());
const detector = createDetector();
const result = await detector.detect({ root });

console.log(formatDetectionReport(result));
console.log("");
console.log(JSON.stringify(result.primary, null, 2));
