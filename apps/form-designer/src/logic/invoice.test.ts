import { describe, expect, it } from "vitest";
import {
	type InvoiceDoc,
	InvoiceStatus,
	computeInvoiceTotals,
	emptyInvoice,
	escapeHtml,
	formatMoney,
	invoiceFromProperties,
	invoiceToProperties,
	renderInvoiceHtml,
} from "./invoice";

const LABELS = {
	invoice: "Invoice",
	from: "From",
	billTo: "Bill to",
	issued: "Issued",
	due: "Due",
	description: "Description",
	qty: "Qty",
	unitPrice: "Unit price",
	amount: "Amount",
	subtotal: "Subtotal",
	tax: "Tax",
	total: "Total",
	notes: "Notes",
};

function sample(overrides: Partial<InvoiceDoc> = {}): InvoiceDoc {
	return {
		...emptyInvoice("2026-06-22", "INV-014"),
		from: { name: "Northbound", addressLines: ["1 Studio Way"], email: "mira@northbound.co" },
		billTo: { name: "Vertex Labs", addressLines: ["500 Market St"], email: "ap@vertex.com" },
		lineItems: [
			{ description: "Advisory retainer", quantity: 10, unitPrice: 250 },
			{ description: "Research deep-dive", quantity: 1, unitPrice: 4800 },
		],
		taxRatePct: 0,
		...overrides,
	};
}

describe("computeInvoiceTotals", () => {
	it("sums line amounts into a subtotal and total (no tax)", () => {
		const t = computeInvoiceTotals(sample());
		expect(t.lineAmounts).toEqual([2500, 4800]);
		expect(t.subtotal).toBe(7300);
		expect(t.tax).toBe(0);
		expect(t.total).toBe(7300);
	});

	it("applies a tax rate to the subtotal", () => {
		const t = computeInvoiceTotals(sample({ taxRatePct: 8.5 }));
		expect(t.subtotal).toBe(7300);
		expect(t.tax).toBe(620.5);
		expect(t.total).toBe(7920.5);
	});

	it("rounds to cents without binary-float drift", () => {
		const t = computeInvoiceTotals(
			sample({ lineItems: [{ description: "x", quantity: 3, unitPrice: 0.1 }], taxRatePct: 0 }),
		);
		// 3 × 0.1 = 0.30000000000000004 in IEEE754 — must read as 0.3.
		expect(t.lineAmounts).toEqual([0.3]);
		expect(t.subtotal).toBe(0.3);
		expect(t.total).toBe(0.3);
	});

	it("treats non-finite quantities/prices as zero (never NaN)", () => {
		const t = computeInvoiceTotals(
			sample({
				lineItems: [{ description: "bad", quantity: Number.NaN, unitPrice: 5 }],
			}),
		);
		expect(t.subtotal).toBe(0);
		expect(t.total).toBe(0);
		expect(Number.isNaN(t.total)).toBe(false);
	});

	it("handles an empty line-item list", () => {
		const t = computeInvoiceTotals(sample({ lineItems: [] }));
		expect(t.lineAmounts).toEqual([]);
		expect(t.total).toBe(0);
	});
});

describe("formatMoney", () => {
	it("formats in the requested currency", () => {
		expect(formatMoney(7300, "USD", "en-US")).toBe("$7,300.00");
	});

	it("falls back without throwing on an unknown currency code", () => {
		const out = formatMoney(10, "ZZZ", "en-US");
		expect(out).toContain("10");
		expect(typeof out).toBe("string");
	});
});

describe("renderInvoiceHtml", () => {
	it("renders the number, parties, a row per line item, and the total", () => {
		const html = renderInvoiceHtml(sample({ taxRatePct: 10 }), LABELS, "en-US");
		expect(html).toContain("INV-014");
		expect(html).toContain("Vertex Labs");
		expect(html).toContain("Northbound");
		expect(html).toContain("Advisory retainer");
		expect(html).toContain("Research deep-dive");
		// subtotal 7300, tax 730, total 8030
		expect(html).toContain("$8,030.00");
		expect(html).toContain("Tax (10%)");
	});

	it("omits the tax row when the rate is zero", () => {
		const html = renderInvoiceHtml(sample({ taxRatePct: 0 }), LABELS, "en-US");
		expect(html).not.toContain("Tax (");
	});

	it("omits the due-date row when there is no due date", () => {
		const html = renderInvoiceHtml(sample({ dueDate: null }), LABELS, "en-US");
		expect(html).not.toContain(">Due<");
	});

	it("escapes user-supplied text (no raw markup injection)", () => {
		const html = renderInvoiceHtml(
			sample({
				billTo: { name: "<script>x</script>", addressLines: [], email: "" },
				lineItems: [{ description: "a & b <c>", quantity: 1, unitPrice: 1 }],
			}),
			LABELS,
			"en-US",
		);
		expect(html).not.toContain("<script>x</script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("a &amp; b &lt;c&gt;");
	});
});

describe("escapeHtml", () => {
	it("escapes the five significant characters", () => {
		expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
	});
});

describe("entity (de)serialization round-trips", () => {
	it("invoiceToProperties → invoiceFromProperties preserves the doc", () => {
		const doc = sample({ taxRatePct: 7.25, status: InvoiceStatus.Sent, dueDate: "2026-07-22" });
		const restored = invoiceFromProperties(invoiceToProperties(doc));
		expect(restored).toEqual(doc);
	});

	it("denormalises the total onto the entity for a Finances rollup", () => {
		const props = invoiceToProperties(sample({ taxRatePct: 10 }));
		expect(props.total).toBe(8030);
		expect(props.name).toBe("INV-014");
		expect(props.status).toBe(InvoiceStatus.Draft);
	});

	it("tolerates missing / malformed stored properties", () => {
		const doc = invoiceFromProperties({});
		expect(doc.number).toBe("INV-001");
		expect(doc.currency).toBe("USD");
		expect(doc.status).toBe(InvoiceStatus.Draft);
		expect(doc.lineItems).toHaveLength(1);
	});

	it("coerces a malformed status back to Draft", () => {
		expect(invoiceFromProperties({ status: "bogus" }).status).toBe(InvoiceStatus.Draft);
	});
});
