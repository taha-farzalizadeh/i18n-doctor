import type { ParsedFile, ParseInput } from "../src/index.js";
import { createAstEngine } from "../src/index.js";

export function parse(
  fileName: string,
  sourceText: string,
  extra: Partial<ParseInput> = {},
): ParsedFile {
  const engine = createAstEngine({ cache: false });
  return engine.parse({ fileName, sourceText, ...extra });
}

export function engineWithCache() {
  return createAstEngine({ cache: true, cacheSize: 100, concurrency: 4 });
}
