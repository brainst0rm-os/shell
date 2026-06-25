/**
 * Property name humanization for the inspector / view settings.
 *
 * `startDate` → "Start date", `endDate` → "End date", `dueDate` → "Due date",
 * `assignee` → "Assignee", `tags` → "Tags". Single-word lowercase keys are
 * title-cased; camelCase keys are split before title-casing.
 *
 * Stage 9.6 (properties service) will replace this with the dictionary
 * lookup. Until then, this keeps the inspector legible without per-app
 * label hand-rolling.
 */

const OVERRIDES: Record<string, string> = {
	id: "ID",
	url: "URL",
	uri: "URI",
	uuid: "UUID",
	api: "API",
	html: "HTML",
	css: "CSS",
	json: "JSON",
};

export function humanize(key: string): string {
	if (!key) return key;
	const tokens = key
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (tokens.length === 0) return key;
	const first = tokens.shift() as string;
	const head = OVERRIDES[first] ?? capitalize(first);
	const tail = tokens.map((t) => OVERRIDES[t] ?? t).join(" ");
	return tail ? `${head} ${tail}` : head;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
