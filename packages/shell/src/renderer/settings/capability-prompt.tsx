/**
 * Capability-prompt modal per §Granting. The main process
 * pushes a `capabilities:prompt` over IPC; the dashboard renderer subscribes
 * via `window.brainstorm.capabilityPrompt.on(...)`, surfaces this modal, and
 * `respond(requestId, accept)` resolves the pending grant in main.
 *
 * Only one prompt is in flight at a time (the host serializes them). The
 * modal renders the literal scope so the user sees exactly what's being
 * asked — no soft-claim language.
 *
 * Chrome (backdrop / panel / Escape) comes from the shared `<Popover>` per
 * CLAUDE.md. KBN-S-cap-prompt — this is a SECURITY decision, so the keyboard
 * contract fails safe: there is NO global Enter-grants shortcut (a stray Enter
 * must never silently grant a capability), Escape denies (Popover `onClose`),
 * and initial focus lands on **Deny** (`initialFocusRef`) so the default
 * action a keyboard/SR user activates is the safe one. Granting requires
 * deliberately focusing and activating Allow.
 */

import { AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { CapabilityPromptRequest } from "../../preload";
import { t } from "../i18n/t";
import { Button, ButtonVariant } from "../ui/button";
import { Popover } from "../ui/popover";
import { PopoverSize } from "../ui/popover-types";

export function CapabilityPromptHost() {
	const [request, setRequest] = useState<CapabilityPromptRequest | null>(null);
	const denyRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		return window.brainstorm.capabilityPrompt.on((req) => {
			setRequest(req);
		});
	}, []);

	const respond = (accept: boolean) => {
		if (!request) return;
		window.brainstorm.capabilityPrompt.respond(request.requestId, accept);
		setRequest(null);
	};

	return (
		<AnimatePresence mode="wait">
			{request && (
				<Popover
					key={request.requestId}
					title={t("shell.capabilities.prompt.title")}
					onClose={() => respond(false)}
					size={PopoverSize.Medium}
					initialFocusRef={denyRef}
					testId="capability-prompt"
				>
					<p className="capability-prompt__app">
						<code>{request.appId}</code> {t("shell.capabilities.prompt.wants")}
					</p>
					<p className="capability-prompt__capability">
						<code>{request.capability}</code>
					</p>
					<p className="capability-prompt__reason">{request.reason}</p>
					<div className="capability-prompt__actions">
						<Button ref={denyRef} onClick={() => respond(false)}>
							{t("shell.capabilities.prompt.deny")}
						</Button>
						<Button variant={ButtonVariant.Primary} onClick={() => respond(true)}>
							{t("shell.capabilities.prompt.allow")}
						</Button>
					</div>
				</Popover>
			)}
		</AnimatePresence>
	);
}
