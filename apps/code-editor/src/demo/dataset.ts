/**
 * Standalone-dev demo set. Used ONLY when the app boots outside the
 * shell (`!window.brainstorm`) per [[preview-drop-pattern]] — in shell
 * mode the app reads real `CodeFile/v1` rows via the vault-entities
 * aggregator and shows an honest empty state when there are none (the
 * user-directed "no demo bleed into a real vault" posture).
 */

import { type CitationEntry, type CitationIndex, CitationKind } from "../logic/citation-index";
import type { CodeFileRow } from "../logic/code-projection";
import { LanguageKey } from "../types/code-file";

const NOW = Date.UTC(2026, 4, 16);

function row(
	id: string,
	path: string,
	language: LanguageKey,
	content: string,
	ageDays: number,
): CodeFileRow {
	const updatedAt = NOW - ageDays * 86_400_000;
	return {
		id,
		path,
		language,
		content,
		contentKey: "content",
		icon: null,
		sizeBytes: content.length,
		lineCount: content.split("\n").length,
		isDirty: false,
		lastOpenedAt: null,
		createdAt: updatedAt,
		updatedAt,
	};
}

export function buildCodeDemo(): CodeFileRow[] {
	return [
		row(
			"cf_demo_greet",
			"snippets/greet.ts",
			LanguageKey.TypeScript,
			`export function greet(name: string): string {
\treturn \`Hello, \${name}!\`;
}

greet("Brainstorm");
`,
			0,
		),
		row(
			"cf_demo_config",
			"config/app.json",
			LanguageKey.JSON,
			`{
\t"theme": "system",
\t"telemetry": false,
\t"vault": { "autosaveMs": 400 }
}
`,
			2,
		),
		row(
			"cf_demo_fib",
			"snippets/fib.py",
			LanguageKey.Python,
			`def fib(n):
\ta, b = 0, 1
\tfor _ in range(n):
\t\ta, b = b, a + b
\treturn a


print([fib(i) for i in range(10)])
`,
			5,
		),
		row(
			"cf_demo_setup",
			"scripts/setup.sh",
			LanguageKey.Shell,
			`#!/usr/bin/env bash
set -euo pipefail

bun install
bun run build
echo "ready"
`,
			9,
		),
		row(
			"cf_demo_notes",
			"notes/sh-14.md",
			LanguageKey.Markdown,
			`# SH-14 — inline plan citations

The Code-Editor resolves plan iteration ids (SH-14, 9.7.1.5) and open
questions (OQ-GR-1) against the vault-projected plan ledger. Hover a
reference in the panel to jump to the iteration or OQ entity.

Follows the SH-13 scaffold; the index + scanner survive the 9.7.2
editor swap.
`,
			1,
		),
	];
}

function demoEntry(
	kind: CitationKind,
	code: string,
	title: string,
	status: string,
	summary: string,
): CitationEntry {
	return {
		kind,
		key: code.toUpperCase(),
		code,
		entityId: `demo-${code.toLowerCase()}`,
		entityType:
			kind === CitationKind.Iteration ? "brainstorm/Iteration/v1" : "brainstorm/OpenQuestion/v1",
		title,
		status,
		summary,
	};
}

/** Standalone-dev only: a tiny index so the References panel is
 *  demonstrable without a vault. In shell mode the real index is built
 *  from the vault snapshot, never this. */
export function buildDemoCitationIndex(): CitationIndex {
	const entries: CitationEntry[] = [
		demoEntry(
			CitationKind.Iteration,
			"SH-14",
			"MCP-citation inline in Code-editor",
			"partial",
			"Hover an iteration / OQ id to cite the plan resource.",
		),
		demoEntry(
			CitationKind.Iteration,
			"9.7.1.5",
			"Code-Editor preview drop",
			"done",
			"Vault-resident CodeFile/v1 renderer + projection keystones.",
		),
		demoEntry(
			CitationKind.Iteration,
			"SH-13",
			"Code-editor app scaffold",
			"done",
			"Manifest + language detection + buffer-position logic.",
		),
		demoEntry(
			CitationKind.Iteration,
			"9.7.2",
			"Shiki highlighting + real editor",
			"pending",
			"Replaces the textarea; reuses the citation keystones.",
		),
		demoEntry(
			CitationKind.OpenQuestion,
			"OQ-GR-1",
			"Graph SQL compiler",
			"resolved",
			"Live compiler landed at 9.13.3.",
		),
	];
	const index = new Map<string, CitationEntry>();
	for (const e of entries) index.set(e.key, e);
	return index;
}
