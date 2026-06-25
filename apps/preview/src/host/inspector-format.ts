/**
 * Pure inspector formatters — humanise byte counts, MIME types, and
 * timestamps for the inspector pane. Framework-free so the formatting
 * branches stay unit-tested without a DOM (the React `<Inspector>`
 * consumes them).
 */

export function humaniseBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "—";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	const fmt = value >= 100 ? value.toFixed(0) : value.toFixed(1);
	return `${fmt} ${units[unitIndex]}`;
}

export function humaniseMime(mime: string): string {
	const trimmed = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!trimmed) return mime;
	const slash = trimmed.indexOf("/");
	if (slash < 0) return mime;
	const subtype = trimmed.slice(slash + 1);
	if (subtype === "svg+xml") return "SVG image";
	if (subtype === "markdown" || subtype === "x-markdown") return "Markdown";
	if (subtype === "plain") return "Plain text";
	if (subtype === "pdf") return "PDF document";
	if (trimmed.startsWith("image/")) return `${subtype.toUpperCase()} image`;
	if (trimmed.startsWith("video/")) return `${subtype.toUpperCase()} video`;
	if (trimmed.startsWith("audio/")) return `${subtype.toUpperCase()} audio`;
	return mime;
}

export function humaniseDate(epochMs: number): string {
	const d = new Date(epochMs);
	const day = d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	return `${day}, ${time}`;
}
