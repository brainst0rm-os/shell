/**
 * `<BackupMigrationPanel>` (IE-3) — SSR-rendered smoke test. The panel is
 * click-driven (no mount effects), so static render exercises the idle layout:
 * the export action + the import file-pick affordance + the section summary,
 * all resolving through `t()`. Deeper flow coverage lives in the
 * `import-export-handlers` integration test.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackupMigrationPanel } from "./backup-migration-panel";
import { SettingsSection } from "./sections";

describe("BackupMigrationPanel", () => {
	it("renders the export + import entry points", () => {
		const html = renderToStaticMarkup(<BackupMigrationPanel />);
		expect(html).toContain("backup-migration-panel");
		expect(html).toContain("backup-migration-export-btn");
		expect(html).toContain("backup-migration-import-pick");
		// Strings resolved, not raw t() keys.
		expect(html).not.toContain("shell.settings.backupMigration");
	});

	it("registers a stable section enum value", () => {
		expect(SettingsSection.BackupMigration).toBe("backup-migration");
	});
});
