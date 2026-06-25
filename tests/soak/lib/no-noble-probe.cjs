// Stage 10.9a — relay-process @noble/* require fence.
//
// Loaded via `bun --require` ahead of the relay's own module graph. The
// runtime complement of the 12th structural CI fence (which scans source
// text under `packages/relay-server/src/**`): even if a future change
// imported a noble package via dynamic loader / transitive dependency
// edge the static analyzer missed, the relay process throws on first
// resolve — frame bodies stay opaque by construction.
//
// CommonJS so it runs without ESM bootstrap overhead before any user
// module loads.

const Module = require("node:module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function patchedRequire(spec, ...rest) {
	if (typeof spec === "string" && spec.startsWith("@noble/")) {
		const err = new Error(
			`[relay-soak] forbidden @noble import inside relay process: ${spec} — the relay must remain relay-blind at runtime. If you genuinely need a crypto primitive in a non-relay module, add a per-line \`// relay-blind-exempt\` review note and update this probe.`,
		);
		err.code = "RELAY_BLIND_VIOLATION";
		throw err;
	}
	return originalRequire.call(this, spec, ...rest);
};
