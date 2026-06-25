/**
 * `brainstorm-cli` entry. v1 ships one command — `pack <theme.json> [--out
 * <file>]` (9.9.6) — the non-GUI path to validate + bundle a theme package.
 * The dispatch + reporting is injected-IO (`runCli(argv, io)`) so it's
 * unit-testable without touching the filesystem; the executable wrapper at
 * the bottom binds the real fs + stdio and sets the exit code.
 */

import { type ThemePackage, formatPackIssues, packTheme } from "./theme-pack";

export type CliIo = {
	readFile(path: string): string;
	writeFile(path: string, contents: string): void;
	log(line: string): void;
	error(line: string): void;
};

const USAGE = "usage: brainstorm-cli pack <theme.json> [--out <bundle.json>]";

/** Run the CLI against `argv` (after the node + script args). Returns the
 *  process exit code: 0 ok, 1 validation/IO failure, 2 usage error. */
export function runCli(argv: readonly string[], io: CliIo): number {
	const [command, ...rest] = argv;
	if (command !== "pack") {
		io.error(USAGE);
		return 2;
	}
	const input = rest.find((a) => !a.startsWith("-"));
	if (!input) {
		io.error(USAGE);
		return 2;
	}
	const outFlag = rest.indexOf("--out");
	const out = outFlag >= 0 ? rest[outFlag + 1] : undefined;

	let pkg: ThemePackage;
	try {
		pkg = JSON.parse(io.readFile(input)) as ThemePackage;
	} catch (error) {
		io.error(`✗ could not read theme package: ${(error as Error).message}`);
		return 1;
	}

	const result = packTheme(pkg);
	for (const line of formatPackIssues(result.issues)) io.error(line);

	if (!result.ok) {
		io.error("✗ pack failed — fix the errors above (warnings don't block).");
		return 1;
	}

	const bundle = JSON.stringify(result.bundle, null, 2);
	if (out) {
		io.writeFile(out, bundle);
		io.log(`✓ packed → ${out}`);
	} else {
		io.log(bundle);
	}
	return 0;
}

// Executable entry — only when run directly (not when imported by a test).
// `import.meta.main` is set by Bun; guard so importing this module is inert.
if ((import.meta as { main?: boolean }).main) {
	const { readFileSync, writeFileSync } = await import("node:fs");
	const io: CliIo = {
		readFile: (path) => readFileSync(path, "utf8"),
		writeFile: (path, contents) => writeFileSync(path, contents),
		log: (line) => console.log(line),
		error: (line) => console.error(line),
	};
	process.exit(runCli(process.argv.slice(2), io));
}
