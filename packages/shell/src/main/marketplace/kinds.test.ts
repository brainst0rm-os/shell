import { describe, expect, it } from "vitest";
import {
	ALL_KINDS,
	APP_DESCRIPTOR,
	ContentKind,
	ReviewModel,
	SignaturePolicy,
	THEME_DESCRIPTOR,
	ThreatProfile,
	descriptorFor,
	isContentKind,
} from "./kinds";

describe("ContentKind registry", () => {
	it("ContentKind enum exposes app + theme as the v1 kinds", () => {
		expect(Object.values(ContentKind)).toEqual(["app", "theme"]);
	});

	it("descriptorFor returns the descriptor for every kind", () => {
		for (const kind of ALL_KINDS) {
			const d = descriptorFor(kind);
			expect(d.kind).toBe(kind);
			expect(typeof d.labelKey).toBe("string");
			expect(d.labelKey.length).toBeGreaterThan(0);
		}
	});

	it("app descriptor reflects active-code / behavioral / manifest-declared", () => {
		expect(APP_DESCRIPTOR.kind).toBe(ContentKind.App);
		expect(APP_DESCRIPTOR.threatProfile).toBe(ThreatProfile.ActiveCode);
		expect(APP_DESCRIPTOR.reviewModel).toBe(ReviewModel.Behavioral);
		expect(APP_DESCRIPTOR.capabilitySurface).toBe("manifest-declared");
	});

	it("theme descriptor reflects passive-data / static-only / none", () => {
		expect(THEME_DESCRIPTOR.kind).toBe(ContentKind.Theme);
		expect(THEME_DESCRIPTOR.threatProfile).toBe(ThreatProfile.PassiveData);
		expect(THEME_DESCRIPTOR.reviewModel).toBe(ReviewModel.StaticOnly);
		expect(THEME_DESCRIPTOR.capabilitySurface).toBe("none");
	});

	it("v1 signature policy is soft-encouraged for both kinds", () => {
		expect(APP_DESCRIPTOR.signaturePolicy).toBe(SignaturePolicy.SoftEncouraged);
		expect(THEME_DESCRIPTOR.signaturePolicy).toBe(SignaturePolicy.SoftEncouraged);
	});

	it("isContentKind narrows valid ids and rejects unknown strings", () => {
		expect(isContentKind(ContentKind.App)).toBe(true);
		expect(isContentKind(ContentKind.Theme)).toBe(true);
		expect(isContentKind("plugin")).toBe(false);
		expect(isContentKind(undefined)).toBe(false);
		expect(isContentKind(42)).toBe(false);
	});
});
