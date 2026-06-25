/**
 * Entity fallback renderer per docs/apps/03-app-model.md §Inactive / removed
 * apps in user data:
 *
 *   When an app is uninstalled (or fails to load), entities and blocks it
 *   produced still appear elsewhere. The shell shows them with a fallback
 *   renderer: a card listing the entity's primary fields, sourced from the
 *   entity's Block Protocol type, with a "this app is no longer installed
 *   — install or pick a handler" affordance. No errors, no broken UI.
 *   This is a hard requirement of the model.
 *
 * Stage 5 ships the visual component + the priority-ordered field surfacing.
 * The "pick a handler" dropdown wiring lands alongside the openers picker
 * (Stage 7 — Intents + Dashboard surfaces).
 */

import type { ReactNode } from "react";
import { t } from "../i18n/t";
import "./entity-fallback.css";

export type EntityFallbackProps = {
	/** The entity-type URL, e.g. `io.example/Note/v1`. */
	entityType: string;
	/** Display name pulled from the inline-schema OR the type URL tail. */
	entityTypeName?: string;
	/** Why this is in the fallback — drives the headline copy. */
	reason: "app-uninstalled" | "app-failed-to-load" | "no-handler";
	/** App that introduced the type, when known (e.g. for "Install <app>" CTA). */
	introducingAppId?: string;
	/** Raw properties snapshot. The fallback renders a subset (title/body/etc.). */
	properties: Record<string, unknown>;
	/** Priority field paths to render at the top, in order. Pulled from the
	 *  entity-type schema's display hints when available. */
	primaryFields?: ReadonlyArray<{ path: string; label: string }>;
	/**
	 * Callback for the "Pick a handler" affordance — fired when the user
	 * clicks the action. Wires to the intents picker in Stage 7. Omit to
	 * disable the button.
	 */
	onPickHandler?: () => void;
};

const REASON_HEADLINES: Record<EntityFallbackProps["reason"], string> = {
	"app-uninstalled": "This entity's app is no longer installed.",
	"app-failed-to-load": "This entity's app failed to load.",
	"no-handler": "No app is registered to handle this entity type.",
};

export function EntityFallback(props: EntityFallbackProps): ReactNode {
	const headline = REASON_HEADLINES[props.reason];
	const displayName = props.entityTypeName ?? deriveTypeName(props.entityType);
	const fields = pickFields(props.properties, props.primaryFields);

	return (
		<section
			className="entity-fallback"
			aria-label="Entity fallback view"
			data-testid="entity-fallback"
		>
			<header className="entity-fallback__header">
				<div className="entity-fallback__type-label">{displayName}</div>
				<div className="entity-fallback__headline">{headline}</div>
				{props.introducingAppId && (
					<div className="entity-fallback__hint">
						{t("shell.entityFallback.introducedBy")} <code>{props.introducingAppId}</code>.
					</div>
				)}
			</header>

			{fields.length > 0 ? (
				<dl className="entity-fallback__fields">
					{fields.map((field) => (
						<div key={field.path} className="entity-fallback__field">
							<dt>{field.label}</dt>
							<dd>{renderValue(field.value)}</dd>
						</div>
					))}
				</dl>
			) : (
				<p className="entity-fallback__empty">{t("shell.entityFallback.noFields")}</p>
			)}

			{props.onPickHandler && (
				<footer className="entity-fallback__actions">
					<button type="button" className="entity-fallback__action" onClick={props.onPickHandler}>
						{t("shell.entityFallback.pickHandler")}
					</button>
				</footer>
			)}
		</section>
	);
}

/** Extract the values for the primary fields, dropping any that are absent
 *  or empty. Order matches the input. */
function pickFields(
	properties: Record<string, unknown>,
	primaryFields?: ReadonlyArray<{ path: string; label: string }>,
): Array<{ path: string; label: string; value: unknown }> {
	if (primaryFields && primaryFields.length > 0) {
		const out: Array<{ path: string; label: string; value: unknown }> = [];
		for (const f of primaryFields) {
			const value = readDottedPath(properties, f.path);
			if (value === undefined || value === null) continue;
			if (typeof value === "string" && value.length === 0) continue;
			out.push({ path: f.path, label: f.label, value });
		}
		return out;
	}
	// No display hints — best-effort: surface the first ~3 string-valued
	// top-level fields. Ignore objects (rich-text bodies surface elsewhere).
	const out: Array<{ path: string; label: string; value: unknown }> = [];
	for (const [key, value] of Object.entries(properties)) {
		if (out.length >= 3) break;
		if (value == null) continue;
		if (typeof value === "object") continue;
		if (typeof value === "string" && value.length === 0) continue;
		out.push({ path: key, label: humanizeKey(key), value });
	}
	return out;
}

/** Read `$.foo.bar` from a nested object. Returns undefined on miss. */
export function readDottedPath(obj: Record<string, unknown>, path: string): unknown {
	let cur: unknown = obj;
	const parts = path
		.replace(/^\$\.?/, "")
		.split(".")
		.filter(Boolean);
	for (const part of parts) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

function renderValue(value: unknown): ReactNode {
	if (value == null) return null;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		return value
			.map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
			.filter((v) => v.length > 0)
			.join(", ");
	}
	return JSON.stringify(value);
}

function deriveTypeName(typeUrl: string): string {
	const parts = typeUrl.split("/");
	// `io.example/Note/v1` → "Note"
	return parts.at(-2) ?? typeUrl;
}

function humanizeKey(key: string): string {
	const spaced = key
		.replace(/([A-Z])/g, " $1")
		.replace(/[_-]/g, " ")
		.trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
