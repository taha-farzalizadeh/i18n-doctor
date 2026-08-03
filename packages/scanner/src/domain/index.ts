export type { FileId, PackageId } from "./ids.js";
export type {
  AbsoluteOsPath,
  CasePolicy,
  CasePolicyConfig,
  RelativePosixPath,
  RootIdentity,
} from "./paths.js";
export type {
  ContentState,
  FileFlag,
  FileLanguage,
  FileRole,
  SupportedExtension,
  SyntaxDomain,
} from "./file-kinds.js";
export type {
  PackageKind,
  PackageUnit,
  ProjectSignal,
  WorkspaceManager,
} from "./workspace.js";
export type {
  ContentHash,
  HardLinkGroup,
  HeavyFileMetadata,
  LiteFileEntry,
  PathConflict,
} from "./metadata.js";
export type { ScannerErrorClass, ScannerErrorRecord } from "./errors.js";
export type { CoverageReport } from "./coverage.js";
export type { IgnoreExplanation, IgnoreRule } from "./ignore.js";
export type {
  CompletenessMode,
  DiscoverContribution,
  DiscoveryPlan,
  DotFilesPolicy,
  HashPolicy,
  SymlinkPolicy,
} from "./plan.js";
export type { ScanScope } from "./scope.js";
export type { ChangeKind, ChangeSet, PathChange } from "./change-set.js";
export type {
  ContentAccessor,
  ContentReadResult,
  FileFilter,
  ProjectSnapshot,
  ProjectSnapshotView,
} from "./snapshot.js";
