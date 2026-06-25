# sync-spike-10.0

**This is throwaway.** A sync-spike proof-of-concept from the 10.0 work.

Plan iteration `10.0` — de-risk spike for the per-entity-DEK + encrypted Yjs update envelopes + blind relay invariant that the v1 sync layer is built on. Surfaces positions on **OQ-10 / OQ-26 / OQ-27 / OQ-28 / OQ-29** before 10.1 commits.

## What this is

- Two Node clients (Alice's device + Bob's device, same sovereign user, different Ed25519 device keys) editing one shared `entities.db`-style entity Y.Doc.
- One blind in-process relay (`src/relay.ts`) that has **no import of any crypto module and no access to any key material**. It sees framed bytes and a routing header only.
- A documented edit sequence:
  1. Alice creates an entity, generates a per-entity 256-bit DEK, wraps it under her own X25519 device pubkey, attaches the wrap to the entity, types two characters into `Y.Text("title")`.
  2. Pairing: Alice signs an `add-device` record under her Ed25519 user identity adding Bob's device pubkey, then wraps the same DEK under Bob's X25519 device pubkey and attaches that wrap.
  3. Both clients connect to the relay; Bob receives the snapshot, unwraps the DEK with his device key, decrypts, sees the title.
  4. Concurrent edit: Alice and Bob each type a different character. The relay forwards both ciphertext envelopes; both clients converge on the merged text.
- The relay prints the bytes it saw — hex/base64, sizes, frame count — and a "what would a malicious relay learn" section enumerates the surviving side-channels.

## Why in-process and not real `y-websocket`

`y-websocket` is not in the workspace's `node_modules` (the v1 sync transport is iterated under `10.4`; the spike is the gate **before** that pick). Pulling in `ws` for a throwaway spike was rejected per the constraint "no new workspace deps to root". The blind-relay invariant is preserved structurally — the relay module imports nothing from `@noble/*`, has no DEK reference, and only sees the wire envelopes the clients hand it. A real `y-websocket` relay does exactly the same thing over a TCP socket; the proof of "the relay sees ciphertext only" does not depend on which transport carries the framed bytes.

## Run it

```sh
# from the repo root, after `bun install`:
cd experiments/sync-spike-10.0
bun run src/spike.ts
```

The experiment resolves its deps (`yjs`, `@noble/*`) via a `node_modules` symlink into `packages/shell/node_modules` — no extra install needed once the shell's are present. This is deliberately not a workspace member (the constraint was "no new workspace deps to root"); the symlink keeps the spike isolated.

Output: a transcript of the relay's view of one full pairing + edit-converge round, then the side-channel summary. The run ends with `[spike] done.` on success; it throws on any failure (CRDT non-convergence, signature mismatch, replay accepted when it shouldn't, or a structural-blindness import detected in `relay.ts`).

## Files

- `src/spike.ts` — entrypoint; runs the full scenario, prints the proof transcript.
- `src/relay.ts` — the blind relay. **No crypto imports. No keys.** Hands envelopes through; the test harness pulls its full byte log.
- `src/client.ts` — one device. Generates Ed25519 user/device keys, opens an entity Y.Doc, wraps/unwraps the per-entity DEK, encrypts/decrypts Yjs updates under XChaCha20-Poly1305, signs the routing envelope.
- `src/wire.ts` — pure framing helpers (envelope encode/decode, routing header layout). No crypto.
- `src/crypto.ts` — thin wrappers over `@noble/*` for X25519 ECDH + HKDF wrap, XChaCha20-Poly1305 AEAD, Ed25519 sign/verify. Imported by `client.ts`, **never by `relay.ts`**.

## What this prototype does **not** do

- No persistence (DEKs and Yjs docs are in-memory).
- No real WebSocket; the relay is in-process (see above).
- No revocation flow (OQ-29's revocation half is design-only here; the rotation-on-remove primitive is sketched in the proof doc, not run).
- No replay-protection database (sketched in the proof; not enforced).
- No org-relay routing test (OQ-28 is single-user / single-relay here by design — v1 scope).

The code is a thin scaffold around the cryptographic primitives so we can observe the relay's view. The architecture decisions it forces are the deliverable.
