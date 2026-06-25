/**
 * `<QrCode>` — pure render of a payload string as a square QR canvas.
 *
 * Used by the pairing flow (Stage 10.5b — Settings → Devices → Add a
 * device). Renders to `<canvas>` so the high-density pairing payload
 * (~250 chars) doesn't blow up the React tree with SVG `<rect>` nodes.
 *
 * The `qrcode` package's browser entry is dynamically imported on first
 * render to keep it out of the dashboard's initial bundle — pairing UI
 * is opened on demand, never on app boot.
 */

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/t";

export type QrCodeProps = {
	payload: string;
	size?: number;
	ariaLabel?: string;
	className?: string;
};

export function QrCode({ payload, size = 240, ariaLabel, className }: QrCodeProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (payload.length === 0) {
			setError("empty payload");
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas) return;
		let cancelled = false;
		setError(null);
		void import("qrcode")
			.then(async (mod) => {
				if (cancelled) return;
				try {
					await mod.toCanvas(canvas, payload, {
						width: size,
						margin: 1,
						errorCorrectionLevel: "M",
					});
				} catch (err) {
					if (!cancelled) {
						setError(err instanceof Error ? err.message : String(err));
					}
				}
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [payload, size]);

	if (payload.length === 0) {
		throw new Error("QrCode: payload must be a non-empty string");
	}

	const label = ariaLabel ?? t("shell.settings.devices.add.qrAlt");

	return (
		<canvas
			ref={canvasRef}
			width={size}
			height={size}
			className={className}
			role="img"
			aria-label={label}
			data-error={error ?? undefined}
			data-testid="qr-code"
			data-payload-length={payload.length}
			style={{ width: size, height: size, display: "block" }}
		/>
	);
}
