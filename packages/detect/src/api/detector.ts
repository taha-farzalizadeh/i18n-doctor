import type { DetectorOptions, ProjectDetectionResult, ProjectDetector } from "./types.js";

export interface ProjectDetectorFactory {
  createDetector(defaults?: DetectorOptions): ProjectDetector;
}

export type { DetectorOptions, ProjectDetectionResult, ProjectDetector };
