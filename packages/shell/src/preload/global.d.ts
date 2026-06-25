import type { BrainstormBridge } from "./index";

declare global {
	interface Window {
		brainstorm: BrainstormBridge;
	}
}
