import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => `/tmp/brainstorm-test-${name}`,
	},
}));

describe("vault paths", () => {
	it("composes registry path from app config dir", async () => {
		const { registryPath } = await import("./paths");
		expect(registryPath()).toBe("/tmp/brainstorm-test-userData/registry.json");
	});

	it("sanitizes vault folder names by replacing illegal characters", async () => {
		const { defaultVaultPath } = await import("./paths");
		const sanitized = defaultVaultPath('Bad/Name?:*"<>|%');
		const folder = sanitized.split("/").at(-1) ?? "";
		expect(folder).not.toMatch(/[/\\?%*:|"<>]/);
	});

	it("falls back to 'Vault' for empty/all-whitespace names", async () => {
		const { defaultVaultPath } = await import("./paths");
		expect(defaultVaultPath("   ")).toMatch(/Vault$/);
	});
});
