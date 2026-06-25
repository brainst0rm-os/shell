/**
 * `<QrCode>` — SSR smoke + invariants. The dynamic `qrcode` import only
 * runs in a `useEffect`, so the SSR pass renders the `<canvas>` element
 * with the declared ARIA label + size attributes; that's the contract
 * downstream consumers (devices-add-flow, storybook) actually rely on.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QrCode } from "./qr-code";

describe("QrCode", () => {
	it("renders a canvas at the requested size with an ARIA label", () => {
		const html = renderToStaticMarkup(<QrCode payload="abc123" size={128} ariaLabel="Test QR" />);
		expect(html).toContain("<canvas");
		expect(html).toContain('width="128"');
		expect(html).toContain('height="128"');
		expect(html).toContain('aria-label="Test QR"');
		expect(html).toContain('role="img"');
		expect(html).toContain('data-testid="qr-code"');
	});

	it("stamps payload-length so consumers can sanity-check the bytes routed in", () => {
		const html = renderToStaticMarkup(<QrCode payload="hello" />);
		expect(html).toContain('data-payload-length="5"');
	});

	it("throws on an empty payload (pairing payloads are never empty)", () => {
		expect(() => renderToStaticMarkup(<QrCode payload="" />)).toThrow(/non-empty/i);
	});
});
