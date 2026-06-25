#![deny(clippy::all)]

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
	aead::{Aead, KeyInit, Payload},
	ChaCha20Poly1305, XChaCha20Poly1305, XNonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use napi::bindgen_prelude::{Error, Result, Status, Uint8Array};
use napi_derive::napi;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret as X25519StaticSecret};

const ED25519_SEED_LEN: usize = 32;
const ED25519_PUBKEY_LEN: usize = 32;
const ED25519_SIGNATURE_LEN: usize = 64;
const X25519_KEY_LEN: usize = 32;
const XCHACHA_KEY_LEN: usize = 32;
const XCHACHA_NONCE_LEN: usize = 24;

#[napi]
pub fn smoke_sum(a: i32, b: i32) -> i32 {
	a + b
}

/// Derive `out_len` bytes from `passphrase` + `salt` via Argon2id v1.3
/// (RFC 9106). Replaces `@noble/hashes/argon2.js` in the shell's
/// `keystore-passphrase.ts`. Parameter semantics match @noble:
///
/// - `m_kib`: memory cost in KiB (e.g. 65536 = 64 MiB)
/// - `t_cost`: iteration count
/// - `p_cost`: parallelism (lanes)
/// - `out_len`: derived-key length in bytes (32 for the wrap-key path)
///
/// Output is byte-identical to `@noble/hashes/argon2.js` for the same
/// inputs (pinned by `test/argon2.test.ts`); existing on-disk vaults
/// derived under @noble continue to open after the swap.
/// Derive the 32-byte Ed25519 public key from a 32-byte seed (the canonical
/// "secret key" the shell stores via the keystore). Byte-identical to
/// `ed25519.getPublicKey(seed)` from `@noble/curves/ed25519.js`.
#[napi(js_name = "ed25519GetPublicKey")]
pub fn ed25519_get_public_key(seed: Uint8Array) -> Result<Uint8Array> {
	let bytes = seed.as_ref();
	if bytes.len() != ED25519_SEED_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("ed25519 seed must be {ED25519_SEED_LEN} bytes (got {})", bytes.len()),
		));
	}
	let seed_arr: [u8; ED25519_SEED_LEN] = bytes.try_into().unwrap();
	let signing_key = SigningKey::from_bytes(&seed_arr);
	let public = signing_key.verifying_key().to_bytes();
	Ok(Uint8Array::from(public.to_vec()))
}

/// Produce a 64-byte Ed25519 signature over `payload` using the 32-byte
/// `seed`. Byte-identical to `ed25519.sign(payload, seed)` from
/// `@noble/curves/ed25519.js` (RFC 8032 deterministic signature).
#[napi(js_name = "ed25519Sign")]
pub fn ed25519_sign(seed: Uint8Array, payload: Uint8Array) -> Result<Uint8Array> {
	let seed_bytes = seed.as_ref();
	if seed_bytes.len() != ED25519_SEED_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("ed25519 seed must be {ED25519_SEED_LEN} bytes (got {})", seed_bytes.len()),
		));
	}
	let seed_arr: [u8; ED25519_SEED_LEN] = seed_bytes.try_into().unwrap();
	let signing_key = SigningKey::from_bytes(&seed_arr);
	let signature = signing_key.sign(payload.as_ref());
	Ok(Uint8Array::from(signature.to_bytes().to_vec()))
}

/// Verify a 64-byte Ed25519 signature against `payload` under
/// `public_key`. Returns `false` (never throws) on any malformed input or
/// verification failure — matches the shell's existing call-site contract,
/// which calls `verifySignature` inside a `try` and treats throws as
/// failure. Uses RFC 8032 cofactored verification (same as @noble).
#[napi(js_name = "ed25519Verify")]
pub fn ed25519_verify(public_key: Uint8Array, payload: Uint8Array, signature: Uint8Array) -> bool {
	let pk_bytes = public_key.as_ref();
	let sig_bytes = signature.as_ref();
	if pk_bytes.len() != ED25519_PUBKEY_LEN || sig_bytes.len() != ED25519_SIGNATURE_LEN {
		return false;
	}
	let pk_arr: [u8; ED25519_PUBKEY_LEN] = pk_bytes.try_into().unwrap();
	let sig_arr: [u8; ED25519_SIGNATURE_LEN] = sig_bytes.try_into().unwrap();
	let Ok(verifying_key) = VerifyingKey::from_bytes(&pk_arr) else { return false };
	let signature = Signature::from_bytes(&sig_arr);
	verifying_key.verify(payload.as_ref(), &signature).is_ok()
}

/// Derive the 32-byte X25519 public key from a 32-byte secret. Byte-identical
/// to `x25519.getPublicKey(secret)` from `@noble/curves/ed25519.js`. The
/// secret is accepted as-is — clamping happens inside the scalar multiply per
/// RFC 7748, so any 32-byte input produces a valid keypair.
#[napi(js_name = "x25519GetPublicKey")]
pub fn x25519_get_public_key(secret: Uint8Array) -> Result<Uint8Array> {
	let bytes = secret.as_ref();
	if bytes.len() != X25519_KEY_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("x25519 secret must be {X25519_KEY_LEN} bytes (got {})", bytes.len()),
		));
	}
	let secret_arr: [u8; X25519_KEY_LEN] = bytes.try_into().unwrap();
	let static_secret = X25519StaticSecret::from(secret_arr);
	let public = X25519PublicKey::from(&static_secret);
	Ok(Uint8Array::from(public.to_bytes().to_vec()))
}

/// X25519 scalar multiplication: derive the 32-byte shared secret between
/// `secret` and the peer's `public_key`. Byte-identical to
/// `x25519.getSharedSecret(secret, public_key)` from
/// `@noble/curves/ed25519.js`, **including @noble's RFC 7748 §6.1 rejection
/// of low-order peer pubkeys** — any peer key that lies in the small
/// subgroup of curve25519 produces an all-zero scalar-mult output, which is
/// the canonical signature of a small-subgroup attack against an unmasked
/// static key. Returning zeros to the caller would let a malicious peer
/// force a deterministic-shared-secret outcome (catastrophic for pairing
/// handshakes that feed the DH into an HKDF). Throws `Status::InvalidArg`
/// instead, matching @noble's `invalid private or public key received`
/// throw-path so existing call-site `try/catch` semantics are preserved.
#[napi(js_name = "x25519GetSharedSecret")]
pub fn x25519_get_shared_secret(secret: Uint8Array, public_key: Uint8Array) -> Result<Uint8Array> {
	let sec_bytes = secret.as_ref();
	let pk_bytes = public_key.as_ref();
	if sec_bytes.len() != X25519_KEY_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("x25519 secret must be {X25519_KEY_LEN} bytes (got {})", sec_bytes.len()),
		));
	}
	if pk_bytes.len() != X25519_KEY_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("x25519 public key must be {X25519_KEY_LEN} bytes (got {})", pk_bytes.len()),
		));
	}
	let sec_arr: [u8; X25519_KEY_LEN] = sec_bytes.try_into().unwrap();
	let pk_arr: [u8; X25519_KEY_LEN] = pk_bytes.try_into().unwrap();
	let static_secret = X25519StaticSecret::from(sec_arr);
	let peer_public = X25519PublicKey::from(pk_arr);
	let shared = static_secret.diffie_hellman(&peer_public);
	let shared_bytes = shared.to_bytes();
	if shared_bytes.iter().all(|&b| b == 0) {
		return Err(Error::new(
			Status::InvalidArg,
			"x25519: peer public key is in the small subgroup (all-zero shared secret)".to_string(),
		));
	}
	Ok(Uint8Array::from(shared_bytes.to_vec()))
}

/// SHA-256 of `input`. Byte-identical to `sha256(input)` from
/// `@noble/hashes/sha2.js` (FIPS 180-4).
#[napi(js_name = "sha256")]
pub fn sha256(input: Uint8Array) -> Uint8Array {
	let mut hasher = Sha256::new();
	hasher.update(input.as_ref());
	let digest = hasher.finalize();
	Uint8Array::from(digest.to_vec())
}

/// HKDF-SHA256 (RFC 5869): `expand(extract(salt, ikm), info, out_len)`.
/// Byte-identical to `hkdf(sha256, ikm, salt, info, out_len)` from
/// `@noble/hashes/hkdf.js`. Per RFC 5869 §3.1 a missing / empty `salt` is
/// treated as `HashLen` zeros — the `hkdf` crate's `Hkdf::new(None, ikm)`
/// already does that, and we map an empty `Some(&[])` to the same path
/// to match @noble's `salt: undefined` ⇔ `salt: new Uint8Array(0)`
/// equivalence.
#[napi(js_name = "hkdfSha256")]
pub fn hkdf_sha256(
	ikm: Uint8Array,
	salt: Option<Uint8Array>,
	info: Uint8Array,
	out_len: u32,
) -> Result<Uint8Array> {
	let out_len_usize = out_len as usize;
	if out_len_usize == 0 {
		return Err(Error::new(Status::InvalidArg, "out_len must be > 0"));
	}
	let salt_bytes = salt.as_ref().map(|b| b.as_ref());
	let salt_arg = match salt_bytes {
		Some(s) if !s.is_empty() => Some(s),
		_ => None,
	};
	let hk = Hkdf::<Sha256>::new(salt_arg, ikm.as_ref());
	let mut okm = vec![0u8; out_len_usize];
	hk.expand(info.as_ref(), &mut okm)
		.map_err(|e| Error::new(Status::InvalidArg, format!("hkdf expand failed: {e}")))?;
	Ok(Uint8Array::from(okm))
}

/// IETF XChaCha20-Poly1305 AEAD seal. Byte-identical to
/// `xchacha20poly1305(key, nonce, aad).encrypt(plaintext)` from
/// `@noble/ciphers/chacha.js` (the construction the shell's credential
/// store seals secrets/blobs under): the 32-byte `key` and 24-byte `nonce`
/// drive the extended-nonce ChaCha20-Poly1305 AEAD, and the returned bytes
/// are the ciphertext with the 16-byte Poly1305 tag appended. An empty
/// `aad` is equivalent to no AAD for this AEAD. Pinned byte-for-byte by
/// `test/xchacha20poly1305.test.ts` so existing on-disk sealed secrets keep
/// opening after the swap.
#[napi(js_name = "xchacha20Poly1305Seal")]
pub fn xchacha20_poly1305_seal(
	key: Uint8Array,
	nonce: Uint8Array,
	plaintext: Uint8Array,
	aad: Uint8Array,
) -> Result<Uint8Array> {
	let key_bytes = key.as_ref();
	let nonce_bytes = nonce.as_ref();
	if key_bytes.len() != XCHACHA_KEY_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("xchacha20poly1305: key must be {XCHACHA_KEY_LEN} bytes (got {})", key_bytes.len()),
		));
	}
	if nonce_bytes.len() != XCHACHA_NONCE_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!(
				"xchacha20poly1305: nonce must be {XCHACHA_NONCE_LEN} bytes (got {})",
				nonce_bytes.len()
			),
		));
	}
	let cipher = XChaCha20Poly1305::new_from_slice(key_bytes)
		.map_err(|e| Error::new(Status::GenericFailure, format!("xchacha20poly1305: key error: {e}")))?;
	let xnonce = XNonce::from_slice(nonce_bytes);
	let ct = cipher
		.encrypt(xnonce, Payload { msg: plaintext.as_ref(), aad: aad.as_ref() })
		.map_err(|e| Error::new(Status::GenericFailure, format!("xchacha20poly1305: seal failed: {e}")))?;
	Ok(Uint8Array::from(ct))
}

/// IETF XChaCha20-Poly1305 AEAD open, inverse of `xchacha20Poly1305Seal`.
/// Byte-identical to `xchacha20poly1305(key, nonce, aad).decrypt(ciphertext)`
/// from `@noble/ciphers/chacha.js`. `ciphertext` carries the appended
/// 16-byte Poly1305 tag. Throws on a wrong key, a wrong `aad`, or a tampered
/// ciphertext (Poly1305 tag mismatch) — matching the throw-path the shell's
/// `openSecret`/`openBytes` already expect.
#[napi(js_name = "xchacha20Poly1305Open")]
pub fn xchacha20_poly1305_open(
	key: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array,
	aad: Uint8Array,
) -> Result<Uint8Array> {
	let key_bytes = key.as_ref();
	let nonce_bytes = nonce.as_ref();
	if key_bytes.len() != XCHACHA_KEY_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!("xchacha20poly1305: key must be {XCHACHA_KEY_LEN} bytes (got {})", key_bytes.len()),
		));
	}
	if nonce_bytes.len() != XCHACHA_NONCE_LEN {
		return Err(Error::new(
			Status::InvalidArg,
			format!(
				"xchacha20poly1305: nonce must be {XCHACHA_NONCE_LEN} bytes (got {})",
				nonce_bytes.len()
			),
		));
	}
	let cipher = XChaCha20Poly1305::new_from_slice(key_bytes)
		.map_err(|e| Error::new(Status::GenericFailure, format!("xchacha20poly1305: key error: {e}")))?;
	let xnonce = XNonce::from_slice(nonce_bytes);
	let pt = cipher
		.decrypt(xnonce, Payload { msg: ciphertext.as_ref(), aad: aad.as_ref() })
		.map_err(|e| Error::new(Status::GenericFailure, format!("xchacha20poly1305: open failed: {e}")))?;
	Ok(Uint8Array::from(pt))
}

// ── HPKE base mode (RFC 9180) ────────────────────────────────────────────
//
// Suite (pinned for v1, matches packages/shell/src/main/credentials/hpke.ts):
//   KEM  : DHKEM(X25519, HKDF-SHA256)   kem_id  = 0x0020
//   KDF  : HKDF-SHA256                  kdf_id  = 0x0001
//   AEAD : ChaCha20-Poly1305            aead_id = 0x0003
//
// Hand-composed from the in-tree primitives (x25519-dalek + hkdf + sha2 +
// chacha20poly1305). Mirrors the existing TS impl 1:1 — same suite id bytes,
// same labels, same key-schedule context construction, same base-nonce
// (sequence 0 single-shot, so no XOR with seq is needed). info and aad pass
// through bytes-exactly; never re-encoded or normalised.

const HPKE_KEM_ID: u16 = 0x0020;
const HPKE_KDF_ID: u16 = 0x0001;
const HPKE_AEAD_ID: u16 = 0x0003;
const HPKE_N_SECRET: usize = 32;
const HPKE_N_ENC: usize = 32;
const HPKE_N_K: usize = 32;
const HPKE_N_N: usize = 12;
const HPKE_MODE_BASE: u8 = 0x00;
const HPKE_VERSION: &[u8] = b"HPKE-v1";

fn hpke_suite_id_kem() -> Vec<u8> {
	let mut out = Vec::with_capacity(3 + 2);
	out.extend_from_slice(b"KEM");
	out.extend_from_slice(&HPKE_KEM_ID.to_be_bytes());
	out
}

fn hpke_suite_id_hpke() -> Vec<u8> {
	let mut out = Vec::with_capacity(4 + 6);
	out.extend_from_slice(b"HPKE");
	out.extend_from_slice(&HPKE_KEM_ID.to_be_bytes());
	out.extend_from_slice(&HPKE_KDF_ID.to_be_bytes());
	out.extend_from_slice(&HPKE_AEAD_ID.to_be_bytes());
	out
}

fn hpke_labeled_extract(
	salt: &[u8],
	label: &[u8],
	ikm: &[u8],
	suite_id: &[u8],
) -> [u8; 32] {
	// labeled_ikm = HPKE_VERSION || suite_id || label || ikm
	let mut labeled_ikm = Vec::with_capacity(HPKE_VERSION.len() + suite_id.len() + label.len() + ikm.len());
	labeled_ikm.extend_from_slice(HPKE_VERSION);
	labeled_ikm.extend_from_slice(suite_id);
	labeled_ikm.extend_from_slice(label);
	labeled_ikm.extend_from_slice(ikm);
	let (prk, _) = Hkdf::<Sha256>::extract(if salt.is_empty() { None } else { Some(salt) }, &labeled_ikm);
	let mut out = [0u8; 32];
	out.copy_from_slice(&prk);
	out
}

fn hpke_labeled_expand(
	prk: &[u8],
	label: &[u8],
	info: &[u8],
	length: usize,
	suite_id: &[u8],
) -> Result<Vec<u8>> {
	// labeled_info = I2OSP(length, 2) || HPKE_VERSION || suite_id || label || info
	let mut labeled_info = Vec::with_capacity(2 + HPKE_VERSION.len() + suite_id.len() + label.len() + info.len());
	let len_be = (length as u16).to_be_bytes();
	labeled_info.extend_from_slice(&len_be);
	labeled_info.extend_from_slice(HPKE_VERSION);
	labeled_info.extend_from_slice(suite_id);
	labeled_info.extend_from_slice(label);
	labeled_info.extend_from_slice(info);
	let hk = Hkdf::<Sha256>::from_prk(prk)
		.map_err(|e| Error::new(Status::GenericFailure, format!("hpke: hkdf prk import failed: {e}")))?;
	let mut out = vec![0u8; length];
	hk.expand(&labeled_info, &mut out)
		.map_err(|e| Error::new(Status::GenericFailure, format!("hpke: hkdf expand failed: {e}")))?;
	Ok(out)
}

fn hpke_extract_and_expand(dh: &[u8], kem_context: &[u8]) -> Result<[u8; HPKE_N_SECRET]> {
	let suite_id = hpke_suite_id_kem();
	let eae_prk = hpke_labeled_extract(&[], b"eae_prk", dh, &suite_id);
	let shared = hpke_labeled_expand(&eae_prk, b"shared_secret", kem_context, HPKE_N_SECRET, &suite_id)?;
	let mut out = [0u8; HPKE_N_SECRET];
	out.copy_from_slice(&shared);
	Ok(out)
}

struct HpkeContext {
	key: [u8; HPKE_N_K],
	base_nonce: [u8; HPKE_N_N],
}

fn hpke_key_schedule_base(shared_secret: &[u8], info: &[u8]) -> Result<HpkeContext> {
	let suite_id = hpke_suite_id_hpke();
	let psk_id_hash = hpke_labeled_extract(&[], b"psk_id_hash", &[], &suite_id);
	let info_hash = hpke_labeled_extract(&[], b"info_hash", info, &suite_id);
	let mut key_schedule_context = Vec::with_capacity(1 + psk_id_hash.len() + info_hash.len());
	key_schedule_context.push(HPKE_MODE_BASE);
	key_schedule_context.extend_from_slice(&psk_id_hash);
	key_schedule_context.extend_from_slice(&info_hash);
	let secret = hpke_labeled_extract(shared_secret, b"secret", &[], &suite_id);
	let key_vec = hpke_labeled_expand(&secret, b"key", &key_schedule_context, HPKE_N_K, &suite_id)?;
	let nonce_vec =
		hpke_labeled_expand(&secret, b"base_nonce", &key_schedule_context, HPKE_N_N, &suite_id)?;
	let mut key = [0u8; HPKE_N_K];
	let mut base_nonce = [0u8; HPKE_N_N];
	key.copy_from_slice(&key_vec);
	base_nonce.copy_from_slice(&nonce_vec);
	Ok(HpkeContext { key, base_nonce })
}

struct EncapResult {
	shared_secret: [u8; HPKE_N_SECRET],
	enc: [u8; HPKE_N_ENC],
}

fn hpke_encap(pk_r: &[u8; 32], ephemeral_secret: Option<[u8; 32]>) -> Result<EncapResult> {
	let sk_e_bytes = ephemeral_secret.unwrap_or_else(|| {
		let mut buf = [0u8; 32];
		OsRng.fill_bytes(&mut buf);
		buf
	});
	let sk_e = X25519StaticSecret::from(sk_e_bytes);
	let pk_e = X25519PublicKey::from(&sk_e);
	let peer = X25519PublicKey::from(*pk_r);
	let dh = sk_e.diffie_hellman(&peer);
	let dh_bytes = dh.to_bytes();
	if dh_bytes.iter().all(|&b| b == 0) {
		return Err(Error::new(
			Status::InvalidArg,
			"hpke: peer public key is in the small subgroup (all-zero shared secret)".to_string(),
		));
	}
	let enc = pk_e.to_bytes();
	let mut kem_context = Vec::with_capacity(64);
	kem_context.extend_from_slice(&enc);
	kem_context.extend_from_slice(pk_r);
	let shared_secret = hpke_extract_and_expand(&dh_bytes, &kem_context)?;
	Ok(EncapResult { shared_secret, enc })
}

fn hpke_decap(enc: &[u8; 32], sk_r_bytes: &[u8; 32]) -> Result<[u8; HPKE_N_SECRET]> {
	let sk_r = X25519StaticSecret::from(*sk_r_bytes);
	let pk_r = X25519PublicKey::from(&sk_r);
	let peer = X25519PublicKey::from(*enc);
	let dh = sk_r.diffie_hellman(&peer);
	let dh_bytes = dh.to_bytes();
	if dh_bytes.iter().all(|&b| b == 0) {
		return Err(Error::new(
			Status::InvalidArg,
			"hpke: peer public key is in the small subgroup (all-zero shared secret)".to_string(),
		));
	}
	let mut kem_context = Vec::with_capacity(64);
	kem_context.extend_from_slice(enc);
	kem_context.extend_from_slice(pk_r.as_bytes());
	hpke_extract_and_expand(&dh_bytes, &kem_context)
}

#[napi(object)]
pub struct HpkeSealResult {
	pub enc: Uint8Array,
	pub ct: Uint8Array,
}

/// HPKE SealBase per RFC 9180 §6.1 over the pinned suite
/// (DHKEM(X25519,HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305). Byte-identical
/// to the @noble-composed `sealBase` in `credentials/hpke.ts`, pinned by the
/// RFC 9180 A.2.1 KAT in `native/test/hpke.test.ts`.
///
/// `info` is bound into the KDF; `aad` into the AEAD — both pass through
/// bytes-exactly with no re-encoding. `ephemeral_secret` is test-only; in
/// production callers pass `None` and a fresh CSPRNG ephemeral keypair is
/// generated. Returns `(enc, ct)` where `enc` is the 32-byte ephemeral sender
/// pubkey and `ct` is the ciphertext concatenated with the 16-byte Poly1305 tag.
#[napi(js_name = "hpkeSealBase")]
pub fn hpke_seal_base(
	pk_r: Uint8Array,
	info: Uint8Array,
	aad: Uint8Array,
	pt: Uint8Array,
	ephemeral_secret: Option<Uint8Array>,
) -> Result<HpkeSealResult> {
	let pk_r_bytes = pk_r.as_ref();
	if pk_r_bytes.len() != HPKE_N_ENC {
		return Err(Error::new(
			Status::InvalidArg,
			format!("hpke: pkR must be 32 bytes (got {})", pk_r_bytes.len()),
		));
	}
	let pk_r_arr: [u8; 32] = pk_r_bytes.try_into().unwrap();
	let eph = match ephemeral_secret {
		None => None,
		Some(ref e) => {
			let b = e.as_ref();
			if b.len() != HPKE_N_ENC {
				return Err(Error::new(
					Status::InvalidArg,
					format!("hpke: ephemeralSecret must be 32 bytes (got {})", b.len()),
				));
			}
			let mut arr = [0u8; 32];
			arr.copy_from_slice(b);
			Some(arr)
		}
	};
	let EncapResult { shared_secret, enc } = hpke_encap(&pk_r_arr, eph)?;
	let ctx = hpke_key_schedule_base(&shared_secret, info.as_ref())?;
	let cipher = ChaCha20Poly1305::new_from_slice(&ctx.key)
		.map_err(|e| Error::new(Status::GenericFailure, format!("hpke: aead key error: {e}")))?;
	let ct = cipher
		.encrypt(
			(&ctx.base_nonce).into(),
			Payload { msg: pt.as_ref(), aad: aad.as_ref() },
		)
		.map_err(|e| Error::new(Status::GenericFailure, format!("hpke: seal failed: {e}")))?;
	Ok(HpkeSealResult {
		enc: Uint8Array::from(enc.to_vec()),
		ct: Uint8Array::from(ct),
	})
}

/// HPKE OpenBase per RFC 9180 §6.1, inverse of `hpkeSealBase`. Derives the
/// same shared secret from `(enc, skR)`, runs the same key schedule with
/// `info`, and decrypts `ct` with `aad`. Throws on AEAD tag mismatch
/// (tampered ciphertext, wrong info, wrong aad, wrong recipient key) — every
/// wrong-input case in `hpke.test.ts` exercises this throw.
#[napi(js_name = "hpkeOpenBase")]
pub fn hpke_open_base(
	enc: Uint8Array,
	sk_r: Uint8Array,
	info: Uint8Array,
	aad: Uint8Array,
	ct: Uint8Array,
) -> Result<Uint8Array> {
	let enc_bytes = enc.as_ref();
	let sk_r_bytes = sk_r.as_ref();
	if enc_bytes.len() != HPKE_N_ENC {
		return Err(Error::new(
			Status::InvalidArg,
			format!("hpke: enc must be 32 bytes (got {})", enc_bytes.len()),
		));
	}
	if sk_r_bytes.len() != HPKE_N_ENC {
		return Err(Error::new(
			Status::InvalidArg,
			format!("hpke: skR must be 32 bytes (got {})", sk_r_bytes.len()),
		));
	}
	let enc_arr: [u8; 32] = enc_bytes.try_into().unwrap();
	let sk_r_arr: [u8; 32] = sk_r_bytes.try_into().unwrap();
	let shared_secret = hpke_decap(&enc_arr, &sk_r_arr)?;
	let ctx = hpke_key_schedule_base(&shared_secret, info.as_ref())?;
	let cipher = ChaCha20Poly1305::new_from_slice(&ctx.key)
		.map_err(|e| Error::new(Status::GenericFailure, format!("hpke: aead key error: {e}")))?;
	let pt = cipher
		.decrypt(
			(&ctx.base_nonce).into(),
			Payload { msg: ct.as_ref(), aad: aad.as_ref() },
		)
		.map_err(|e| Error::new(Status::GenericFailure, format!("hpke: open failed: {e}")))?;
	Ok(Uint8Array::from(pt))
}

#[napi(js_name = "argon2idDerive")]
pub fn argon2id_derive(
	passphrase: Uint8Array,
	salt: Uint8Array,
	m_kib: u32,
	t_cost: u32,
	p_cost: u32,
	out_len: u32,
) -> Result<Uint8Array> {
	let out_len_usize = out_len as usize;
	if out_len_usize == 0 {
		return Err(Error::new(Status::InvalidArg, "out_len must be > 0"));
	}
	let params = Params::new(m_kib, t_cost, p_cost, Some(out_len_usize))
		.map_err(|e| Error::new(Status::InvalidArg, format!("invalid argon2 params: {e}")))?;
	let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
	let mut out = vec![0u8; out_len_usize];
	argon2
		.hash_password_into(passphrase.as_ref(), salt.as_ref(), &mut out)
		.map_err(|e| Error::new(Status::GenericFailure, format!("argon2id failed: {e}")))?;
	Ok(Uint8Array::from(out))
}
