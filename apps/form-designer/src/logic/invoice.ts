/**
 * Invoice document model + render (Designer iteration 1 — DT-2).
 *
 * A focused, self-contained billing-document core: the data shape, the derived
 * totals (the "computed field" the form builder lacks), and a pure HTML render
 * that the existing `export.printToPdf` path turns into a sendable PDF (see
 * ). Deliberately NOT built on the shared
 * `Layout/v1` cell contract yet — invoices prove the document shape (repeating
 * line items + derived totals) before those become generic layout cells.
 *
 * Pure + dependency-free so the totals math and HTML escaping are unit-testable
 * without a renderer or a vault.
 */

/** Draft → sent → paid. The value IS the wire form (no raw discriminators). */
export enum InvoiceStatus {
	Draft = "draft",
	Sent = "sent",
	Paid = "paid",
}

export const INVOICE_STATUSES: readonly InvoiceStatus[] = Object.freeze([
	InvoiceStatus.Draft,
	InvoiceStatus.Sent,
	InvoiceStatus.Paid,
]);

export type InvoiceLineItem = {
	description: string;
	quantity: number;
	unitPrice: number;
};

/** Issuer or recipient block — a name plus free address lines and an email. */
export type PartyBlock = {
	name: string;
	addressLines: string[];
	email: string;
};

export type InvoiceDoc = {
	number: string;
	/** ISO date (YYYY-MM-DD). */
	issueDate: string;
	/** ISO date, or null when no due date is set. */
	dueDate: string | null;
	/** ISO 4217 currency code, e.g. "USD". */
	currency: string;
	from: PartyBlock;
	billTo: PartyBlock;
	/** Optional EntityRef → a Client/Contact the bill-to was seeded from. */
	billToRef: string | null;
	lineItems: InvoiceLineItem[];
	/** Tax rate as a percentage, 0..100. */
	taxRatePct: number;
	notes: string;
	status: InvoiceStatus;
};

export type InvoiceTotals = {
	/** Per-line `quantity × unitPrice`, rounded to cents, index-aligned with `lineItems`. */
	lineAmounts: number[];
	subtotal: number;
	tax: number;
	total: number;
};

const emptyParty = (): PartyBlock => ({ name: "", addressLines: [], email: "" });

/** A blank invoice with sensible defaults; `issueDate` must be supplied by the
 *  caller (the module is time-pure — no `new Date()` here). */
export function emptyInvoice(issueDate: string, number = "INV-001"): InvoiceDoc {
	return {
		number,
		issueDate,
		dueDate: null,
		currency: "USD",
		from: emptyParty(),
		billTo: emptyParty(),
		billToRef: null,
		lineItems: [{ description: "", quantity: 1, unitPrice: 0 }],
		taxRatePct: 0,
		notes: "",
		status: InvoiceStatus.Draft,
	};
}

/** Round to cents, avoiding binary-float drift (e.g. 0.1 + 0.2). */
function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

const safeNumber = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Derive line amounts, subtotal, tax, and total. Totals are NEVER stored as
 *  source of truth — they are always recomputed from line items + tax rate. */
export function computeInvoiceTotals(doc: InvoiceDoc): InvoiceTotals {
	const lineAmounts = doc.lineItems.map((item) =>
		round2(safeNumber(item.quantity) * safeNumber(item.unitPrice)),
	);
	const subtotal = round2(lineAmounts.reduce((sum, amount) => sum + amount, 0));
	const tax = round2(subtotal * (safeNumber(doc.taxRatePct) / 100));
	const total = round2(subtotal + tax);
	return { lineAmounts, subtotal, tax, total };
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Format an amount in the invoice currency. Falls back to a plain number plus
 *  the code when the currency is unknown to `Intl` (never throws). */
export function formatMoney(amount: number, currency: string, locale?: string): string {
	const key = `${locale ?? ""}|${currency}`;
	let fmt = moneyFormatters.get(key);
	if (!fmt) {
		try {
			fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
		} catch {
			fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}
		moneyFormatters.set(key, fmt);
	}
	return fmt.format(safeNumber(amount));
}

/** Standard HTML-entity escape for any user-supplied string flowing into the
 *  rendered document (the PDF renderer disables JS, but escaping keeps the
 *  markup well-formed and defends the web-output target later). */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderParty(label: string, party: PartyBlock): string {
	const lines = [party.name, ...party.addressLines, party.email]
		.filter((line) => line.trim().length > 0)
		.map((line) => escapeHtml(line))
		.join("<br/>");
	return `<div class="inv-party"><div class="inv-party__label">${escapeHtml(label)}</div><div class="inv-party__body">${lines || "&mdash;"}</div></div>`;
}

/** Labels passed in by the caller so every visible string stays translatable
 *  (the app supplies these via its `t()` catalog). */
export type InvoiceRenderLabels = {
	invoice: string;
	from: string;
	billTo: string;
	issued: string;
	due: string;
	description: string;
	qty: string;
	unitPrice: string;
	amount: string;
	subtotal: string;
	tax: string;
	total: string;
	notes: string;
};

/** Render the invoice to a self-contained HTML body. `printToPdf` wraps this in
 *  `<html><head><style>…</style></head><body>` and provides the base print
 *  stylesheet; the inline `<style>` here adds invoice-specific layout only. */
export function renderInvoiceHtml(
	doc: InvoiceDoc,
	labels: InvoiceRenderLabels,
	locale?: string,
): string {
	const totals = computeInvoiceTotals(doc);
	const money = (n: number) => escapeHtml(formatMoney(n, doc.currency, locale));

	const rows = doc.lineItems
		.map((item, i) => {
			const amount = totals.lineAmounts[i] ?? 0;
			return `<tr>
				<td>${escapeHtml(item.description)}</td>
				<td class="inv-num">${escapeHtml(String(safeNumber(item.quantity)))}</td>
				<td class="inv-num">${money(safeNumber(item.unitPrice))}</td>
				<td class="inv-num">${money(amount)}</td>
			</tr>`;
		})
		.join("");

	const taxRow =
		doc.taxRatePct > 0
			? `<tr><td class="inv-totals__label">${escapeHtml(labels.tax)} (${escapeHtml(String(doc.taxRatePct))}%)</td><td class="inv-num">${money(totals.tax)}</td></tr>`
			: "";

	const dueRow = doc.dueDate
		? `<div><span class="inv-meta__label">${escapeHtml(labels.due)}</span> ${escapeHtml(doc.dueDate)}</div>`
		: "";

	const notesBlock = doc.notes.trim()
		? `<div class="inv-notes"><div class="inv-party__label">${escapeHtml(labels.notes)}</div><div>${escapeHtml(doc.notes)}</div></div>`
		: "";

	return `<style>
		.inv-doc { font-size: 13px; color: #111; }
		.inv-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
		.inv-title { font-size: 28px; font-weight: 700; margin: 0; letter-spacing: 0.02em; }
		.inv-number { font-size: 14px; color: #555; margin-top: 4px; }
		.inv-meta { text-align: right; font-size: 12px; color: #333; line-height: 1.5; }
		.inv-meta__label { color: #888; }
		.inv-parties { display: flex; gap: 48px; margin-bottom: 24px; }
		.inv-party__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 4px; }
		.inv-party__body { line-height: 1.5; }
		table.inv-items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
		table.inv-items th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 2px solid #222; padding: 6px 8px; }
		table.inv-items td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
		.inv-num { text-align: right; white-space: nowrap; }
		.inv-totals { width: 280px; margin-left: auto; border-collapse: collapse; }
		.inv-totals td { padding: 6px 8px; }
		.inv-totals__label { color: #555; }
		.inv-totals tr.inv-totals__grand td { border-top: 2px solid #222; font-weight: 700; font-size: 15px; }
		.inv-notes { margin-top: 32px; font-size: 12px; color: #444; }
	</style>
	<div class="inv-doc">
		<div class="inv-head">
			<div>
				<h1 class="inv-title">${escapeHtml(labels.invoice)}</h1>
				<div class="inv-number">${escapeHtml(doc.number)}</div>
			</div>
			<div class="inv-meta">
				<div><span class="inv-meta__label">${escapeHtml(labels.issued)}</span> ${escapeHtml(doc.issueDate)}</div>
				${dueRow}
			</div>
		</div>
		<div class="inv-parties">
			${renderParty(labels.from, doc.from)}
			${renderParty(labels.billTo, doc.billTo)}
		</div>
		<table class="inv-items">
			<thead>
				<tr>
					<th>${escapeHtml(labels.description)}</th>
					<th class="inv-num">${escapeHtml(labels.qty)}</th>
					<th class="inv-num">${escapeHtml(labels.unitPrice)}</th>
					<th class="inv-num">${escapeHtml(labels.amount)}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
		<table class="inv-totals">
			<tr><td class="inv-totals__label">${escapeHtml(labels.subtotal)}</td><td class="inv-num">${money(totals.subtotal)}</td></tr>
			${taxRow}
			<tr class="inv-totals__grand"><td>${escapeHtml(labels.total)}</td><td class="inv-num">${money(totals.total)}</td></tr>
		</table>
		${notesBlock}
	</div>`;
}

// ── Entity (de)serialization ────────────────────────────────────────────────
// Invoices persist as `Invoice/v1` entities. The doc fields map 1:1 to
// properties; `lineItems` / address arrays ride as JSON-able array values.

export const INVOICE_TYPE = "io.brainstorm.form-designer/Invoice/v1";

export function invoiceToProperties(doc: InvoiceDoc): Record<string, unknown> {
	const totals = computeInvoiceTotals(doc);
	return {
		// `name` is the vault-wide title surface — show the invoice number.
		name: doc.number,
		number: doc.number,
		issueDate: doc.issueDate,
		dueDate: doc.dueDate,
		currency: doc.currency,
		from: doc.from,
		billTo: doc.billTo,
		billToRef: doc.billToRef,
		lineItems: doc.lineItems,
		taxRatePct: doc.taxRatePct,
		notes: doc.notes,
		status: doc.status,
		// `total` is denormalised onto the entity ONLY so a Finances view (DT-7)
		// can sum it without re-running the compute; the render always recomputes.
		total: totals.total,
	};
}

const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const asNumber = (v: unknown, fallback = 0): number =>
	typeof v === "number" && Number.isFinite(v) ? v : fallback;

function asParty(v: unknown): PartyBlock {
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>;
		return {
			name: asString(o.name),
			addressLines: Array.isArray(o.addressLines) ? o.addressLines.map((l) => asString(l)) : [],
			email: asString(o.email),
		};
	}
	return emptyParty();
}

function asStatus(v: unknown): InvoiceStatus {
	return INVOICE_STATUSES.includes(v as InvoiceStatus) ? (v as InvoiceStatus) : InvoiceStatus.Draft;
}

export function invoiceFromProperties(props: Record<string, unknown>): InvoiceDoc {
	const rawItems = Array.isArray(props.lineItems) ? props.lineItems : [];
	const lineItems: InvoiceLineItem[] = rawItems.map((raw) => {
		const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
		return {
			description: asString(o.description),
			quantity: asNumber(o.quantity),
			unitPrice: asNumber(o.unitPrice),
		};
	});
	return {
		number: asString(props.number, asString(props.name, "INV-001")),
		issueDate: asString(props.issueDate),
		dueDate: typeof props.dueDate === "string" ? props.dueDate : null,
		currency: asString(props.currency, "USD"),
		from: asParty(props.from),
		billTo: asParty(props.billTo),
		billToRef: typeof props.billToRef === "string" ? props.billToRef : null,
		lineItems: lineItems.length > 0 ? lineItems : [{ description: "", quantity: 1, unitPrice: 0 }],
		taxRatePct: asNumber(props.taxRatePct),
		notes: asString(props.notes),
		status: asStatus(props.status),
	};
}
