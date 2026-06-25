/**
 * The intent verbs Tasks handles on the running-app push channel. The
 * values are the wire strings the shell delivers (and the manifest
 * declares); centralising them here keeps the dispatcher off raw string
 * literals per CLAUDE.md "no raw string discriminators".
 *
 * `quick-look` / `compose` aren't in sdk-types' `IntentVerb` union (that
 * covers the data-interop verbs); these are app-navigation verbs the
 * shell routes by manifest registration, so the contract is the string.
 */

export enum IntentVerb {
	Open = "open",
	Compose = "compose",
	QuickLook = "quick-look",
}
