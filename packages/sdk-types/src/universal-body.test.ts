import { describe, expect, it } from "vitest";
import { UNIVERSAL_BODY_FRAGMENT_NAME, type UniversalBodyFragmentName } from "./universal-body";

describe("UNIVERSAL_BODY_FRAGMENT_NAME", () => {
	it('is exactly the string "root" — the on-disk root name in every entity Y.Doc (the @lexical/yjs binding shape)', () => {
		expect(UNIVERSAL_BODY_FRAGMENT_NAME).toBe("root");
	});

	it('is the string-literal type "root", not the wider `string` type', () => {
		// Compile-time guarantee: `as const` narrows the type so a callsite
		// expecting `"root"` does not accept any other string. Round-tripped
		// through `UniversalBodyFragmentName` to also pin the exported alias.
		const pinned: UniversalBodyFragmentName = UNIVERSAL_BODY_FRAGMENT_NAME;
		const literalCheck: "root" = pinned;
		expect(literalCheck).toBe("root");
	});
});
