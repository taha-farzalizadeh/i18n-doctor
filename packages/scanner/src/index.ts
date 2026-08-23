/**
 * @i18n-doctor/scanner
 *
 * Public surface: types, interfaces, configuration, and scanner factory.
 */

export type {
  AbsoluteOsPath,
  CasePolicy,
  CasePolicyConfig,
  ChangeKind,
  ChangeSet,
  CompletenessMode,
  ContentAccessor,
  ContentHash,
  ContentReadResult,
  ContentState,
  CoverageReport,
  DiscoverContribution,
  DiscoveryPlan,
  DotFilesPolicy,
  FileFilter,
  FileFlag,
  FileId,
  FileLanguage,
  FileRole,
  HardLinkGroup,
  HashPolicy,
  HeavyFileMetadata,
  IgnoreExplanation,
  IgnoreRule,
  LiteFileEntry,
  PackageId,
  PackageKind,
  PackageUnit,
  PathChange,
  PathConflict,
  ProjectSignal,
  ProjectSnapshot,
  ProjectSnapshotView,
  RelativePosixPath,
  RootIdentity,
  ScanScope,
  ScannerErrorClass,
  ScannerErrorRecord,
  SupportedExtension,
  SymlinkPolicy,
  SyntaxDomain,
  WorkspaceManager,
} from "./domain/index.js";

export type { Scanner, ScannerFactory } from "./application/index.js";
export {
  createScanner,
  scannerFactory,
  ScannerOperationError,
} from "./application/index.js";

export type {
  DetectedWorkspace,
  DirEntry,
  FileSystemPort,
  FsStat,
  IgnoreEngineFactory,
  IgnoreEnginePort,
  PathBridge,
  WorkspaceDetectorPort,
} from "./ports/index.js";

export { createNodeFileSystem } from "./infrastructure/node-fs.js";

export {
  DEFAULT_BUILTIN_EXCLUDE_PATTERNS,
  DEFAULT_CASE_POLICY,
  DEFAULT_COMPLETENESS_MODE,
  DEFAULT_DOTFILE_ALLOWLIST,
  DEFAULT_DOT_FILES_POLICY,
  DEFAULT_EXTENSIONS,
  DEFAULT_FS_CONCURRENCY,
  DEFAULT_HASH_POLICY,
  DEFAULT_IGNORE_DIRECTORIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_SCANNER_CONFIG,
  DEFAULT_SYMLINK_POLICY,
  PROJECT_MODEL_VERSION,
  SCANNER_VERSION,
  resolveScannerConfig,
} from "./config/index.js";

export type {
  CreateScannerOptions,
  ResolvedScannerConfig,
  ScannerConfig,
} from "./config/index.js";
