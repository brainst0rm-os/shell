/**
 * Property-ui chrome glyph shim — phosphor-react under the hood so the
 * property surface stays bit-identical with the rest of the shell + SDK
 * chrome instead of carrying a parallel hand-rolled SVG family.
 */

import { Check, DotsSixVertical, DotsThree, Plus, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

const SIZE = 16;

export function CheckIcon(): ReactNode {
	return <Check size={SIZE} aria-hidden focusable={false} />;
}

export function CloseXIcon(): ReactNode {
	return <X size={SIZE} aria-hidden focusable={false} />;
}

export function PlusIcon(): ReactNode {
	return <Plus size={SIZE} aria-hidden focusable={false} />;
}

export function MoreIcon(): ReactNode {
	return <DotsThree size={SIZE} weight="bold" aria-hidden focusable={false} />;
}

export function GripIcon(): ReactNode {
	return <DotsSixVertical size={SIZE} aria-hidden focusable={false} />;
}
