import type {
  Confidence,
  TemplateFrameworkId,
  TranslationUsage,
  UsageContext,
  UsageLibraryId,
  UsageLocation,
} from "../api/types.js";

export function buildUsage(input: {
  key: string;
  absolutePath: string;
  relativePath: string;
  location: UsageLocation;
  library: UsageLibraryId;
  namespace?: string;
  confidence: Confidence;
  context: UsageContext;
  evidence?: string;
  framework?: TemplateFrameworkId;
  detector?: string;
}): TranslationUsage {
  return {
    key: input.key,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    location: input.location,
    library: input.library,
    ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
    confidence: Math.round(Math.min(1, Math.max(0, input.confidence)) * 1000) / 1000,
    context: input.context,
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.framework !== undefined ? { framework: input.framework } : {}),
    ...(input.detector !== undefined ? { detector: input.detector } : {}),
  };
}
