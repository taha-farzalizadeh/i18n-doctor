/**
 * Opaque identifiers stable within a ProjectSnapshot generation.
 */

declare const FileIdBrand: unique symbol;
declare const PackageIdBrand: unique symbol;

/** Canonical file identity within a snapshot. */
export type FileId = string & { readonly [FileIdBrand]: typeof FileIdBrand };

/** Package unit identity within a snapshot. */
export type PackageId = string & {
  readonly [PackageIdBrand]: typeof PackageIdBrand;
};
