import type {
  MatchContext,
  UsageFact,
} from "@i18n-doctor/issues";
import type {
  SourceFormat,
  SourceLocation,
  TranslationCatalog,
  TranslationValue,
} from "@i18n-doctor/sources";
import type {
  DynamicTranslationUsage,
  TranslationUsage,
} from "@i18n-doctor/usages";

/** Normalized translation entry derived from an existing catalog definition. */
export interface TranslationIndexEntry {
  readonly key: string;
  readonly namespace: string | null;
  readonly locale: string | null;
  readonly value: TranslationValue;
  /** Absolute path to the catalog source file. */
  readonly sourceFile: string;
  /** Workspace-relative POSIX path. */
  readonly relativePath: string;
  /** Exact range from the catalog extractor. */
  readonly range: SourceLocation;
  readonly sourceType: SourceFormat;
  /** Owning TranslationSource.id. */
  readonly catalogId: string;
  readonly fullKey: string;
}

export interface TranslationIndexOptions {
  readonly matchContext?: MatchContext;
  /** Preferred locales for Go-to / hover ordering (e.g. defaultLocale first). */
  readonly preferredLocales?: readonly string[];
}

export interface DefinitionHit {
  readonly entry: TranslationIndexEntry;
  readonly uriPath: string;
  readonly range: SourceLocation;
}

export interface LocaleValue {
  readonly locale: string;
  readonly value: TranslationValue;
  readonly relativePath: string;
  readonly line: number;
}

export interface HoverModel {
  readonly key: string;
  readonly namespace: string | null;
  readonly missing: boolean;
  readonly locales: readonly LocaleValue[];
  /** Primary source (preferred locale when available). */
  readonly source?: {
    readonly relativePath: string;
    readonly line: number;
  };
}

export interface CompletionItemModel {
  readonly key: string;
  readonly namespace: string | null;
  readonly label: string;
  readonly detail?: string;
  readonly documentation?: string;
}

export interface UsageQuery {
  readonly key: string;
  readonly namespace?: string;
  readonly namespaces?: readonly string[];
  readonly namespaceResolved?: boolean;
}

export interface TranslationIndex {
  readonly size: number;
  readonly entries: readonly TranslationIndexEntry[];
  readonly matchContext: MatchContext;
  readonly preferredLocales: readonly string[];

  lookup(input: {
    readonly key: string;
    readonly namespace?: string | null;
    readonly locale?: string | null;
  }): readonly TranslationIndexEntry[];

  hasKey(usage: UsageQuery): boolean;

  definitionsForUsage(
    usage: UsageQuery,
    options?: { readonly preferredLocales?: readonly string[] },
  ): readonly DefinitionHit[];

  hoverForUsage(usage: UsageQuery): HoverModel;

  completionsForPrefix(
    prefix: string,
    options?: {
      readonly namespace?: string | null;
      readonly namespaces?: readonly string[];
      readonly limit?: number;
    },
  ): readonly CompletionItemModel[];
}

export type {
  MatchContext,
  TranslationCatalog,
  TranslationUsage,
  DynamicTranslationUsage,
  UsageFact,
};
