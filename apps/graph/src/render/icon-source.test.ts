import { describe, expect, it } from "vitest";
import { IconKind } from "../types/icon";
import { iconKey } from "./icon-source";

describe("iconKey", () => {
	it("returns null for a missing icon", () => {
		expect(iconKey(null)).toBeNull();
	});

	it("keys emoji by value", () => {
		expect(iconKey({ kind: IconKind.Emoji, value: "🏙️" })).toBe("emoji:🏙️");
	});

	it("keys image by value", () => {
		expect(iconKey({ kind: IconKind.Image, value: "https://x/y.png" })).toBe("image:https://x/y.png");
	});

	it("keys pack by value only — colour is composed by the renderer, not folded here", () => {
		expect(iconKey({ kind: IconKind.Pack, value: "phosphor/user" })).toBe("pack:phosphor/user");
		expect(iconKey({ kind: IconKind.Pack, value: "phosphor/user", color: "#e8b339" })).toBe(
			"pack:phosphor/user",
		);
	});
});
