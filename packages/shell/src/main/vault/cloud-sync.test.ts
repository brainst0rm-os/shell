import { describe, expect, it } from "vitest";
import { type CloudService, detectCloudSync } from "./cloud-sync";

const HOME = "/Users/me";

function expectService(path: string, service: CloudService) {
	const result = detectCloudSync(path, { home: HOME });
	expect(result, `expected ${path} to flag ${service}`).not.toBeNull();
	expect(result?.service).toBe(service);
	expect(result?.displayName).toBeTruthy();
	expect(result?.hint).toBeTruthy();
}

function expectClean(path: string) {
	expect(detectCloudSync(path, { home: HOME })).toBeNull();
}

describe("detectCloudSync", () => {
	describe("dropbox", () => {
		it("flags ~/Dropbox", () => {
			expectService(`${HOME}/Dropbox/vault`, "dropbox");
		});
		it("flags ~/Dropbox (Personal)", () => {
			expectService(`${HOME}/Dropbox (Personal)/vault`, "dropbox");
		});
		it("flags macOS CloudStorage Dropbox", () => {
			expectService(`${HOME}/Library/CloudStorage/Dropbox/vault`, "dropbox");
		});
	});

	describe("icloud", () => {
		it("flags Mobile Documents iCloud path", () => {
			expectService(`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/vault`, "icloud");
		});
		it("flags macOS CloudStorage iCloud Drive", () => {
			expectService(`${HOME}/Library/CloudStorage/iCloud Drive/vault`, "icloud");
		});
	});

	describe("onedrive", () => {
		it("flags ~/OneDrive", () => {
			expectService(`${HOME}/OneDrive/vault`, "onedrive");
		});
		it("flags ~/OneDrive - Org Name", () => {
			expectService(`${HOME}/OneDrive - Anthropic/vault`, "onedrive");
		});
		it("flags macOS CloudStorage OneDrive", () => {
			expectService(`${HOME}/Library/CloudStorage/OneDrive-Personal/vault`, "onedrive");
		});
	});

	describe("googledrive", () => {
		it("flags ~/Google Drive", () => {
			expectService(`${HOME}/Google Drive/vault`, "googledrive");
		});
		it("flags macOS CloudStorage GoogleDrive-user", () => {
			expectService(`${HOME}/Library/CloudStorage/GoogleDrive-me@example.com/vault`, "googledrive");
		});
	});

	describe("clean paths", () => {
		it("returns null for ~/Documents", () => {
			expectClean(`${HOME}/Documents/Brainstorm/vault`);
		});
		it("returns null for ~/Brainstorm", () => {
			expectClean(`${HOME}/Brainstorm/vault`);
		});
		it("returns null for /tmp paths", () => {
			expectClean("/tmp/work/vault");
		});
		it("returns null for empty path", () => {
			expectClean("");
		});
		it("does not flag a folder merely named 'dropbox-backups'", () => {
			expectClean(`${HOME}/dropbox-backups/vault`);
		});
	});

	describe("case insensitivity", () => {
		it("flags DROPBOX case-insensitively", () => {
			expectService(`${HOME}/DROPBOX/vault`, "dropbox");
		});
	});
});
