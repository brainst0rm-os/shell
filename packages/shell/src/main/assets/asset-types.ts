/**
 * Shared discriminators for the binary-asset subsystem. Per the
 * code-conventions "no raw string literals as discriminators" rule, the
 * `kind` of an asset and the `role` a referencing entity assigns it are
 * enums. The enum *values* are the wire/on-disk strings (so the DB columns
 * stay human-readable and an `assets.bind` call carries the value verbatim).
 */

/** What a stored asset is. Favicon/cover are scrape-sourced today; `upload`
 *  is the forward slot for user-attached files. */
export enum AssetKind {
	Favicon = "favicon",
	Cover = "cover",
	Upload = "upload",
}

/** How an owning entity uses an asset. A `Bookmark/v1` binds one favicon +
 *  one cover; `inline` is the forward slot for body-embedded images. */
export enum AssetRefRole {
	Favicon = "favicon",
	Cover = "cover",
	Inline = "inline",
}
