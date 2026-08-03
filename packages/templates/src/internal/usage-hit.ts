import type {
  Confidence,
  TemplateFrameworkId,
  TemplateLibraryId,
  TemplateUsage,
  TemplateUsageContext,
} from "../api/types.js";
import { locationFromOffsets, type LineIndex } from "./location.js";

export function createTemplateUsage(input: {
  key: string;
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  keyStart: number;
  keyEnd: number;
  library: TemplateLibraryId;
  confidence: Confidence;
  context: TemplateUsageContext;
  framework: TemplateFrameworkId;
  detector: string;
  evidence?: string;
  namespace?: string;
  lineIndex?: LineIndex;
}): TemplateUsage {
  return {
    key: input.key,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    location: locationFromOffsets(
      input.sourceText,
      input.keyStart,
      input.keyEnd,
      input.lineIndex,
    ),
    library: input.library,
    ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
    confidence:
      Math.round(Math.min(1, Math.max(0, input.confidence)) * 1000) / 1000,
    context: input.context,
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    framework: input.framework,
    detector: input.detector,
  };
}
