import { createHash, randomBytes } from "node:crypto";

// PKCE (RFC 7636) and the loopback redirect (RFC 8252 section 7.3), written here with
// node:crypto instead of being taken from a peer package: four small functions are cheaper
// than a dependency every program would have to install.

/** 32 random bytes: the entropy RFC 7636 section 4.1 recommends, 43 characters long. */
const VERIFIER_BYTE_COUNT = 32;
/** 128 bits: unguessable. */
const STATE_BYTE_COUNT = 16;
/** The first port that needs no privileges. */
const MIN_LOOPBACK_PORT = 1024;
const MAX_LOOPBACK_PORT = 65535;

/** A fresh code verifier: 43 characters of unpadded base64url. */
const createCodeVerifier = (): string =>
  randomBytes(VERIFIER_BYTE_COUNT).toString("base64url");

/** The S256 challenge of a verifier: the unpadded base64url of the SHA-256 of its ASCII bytes. */
const codeChallengeOf = (codeVerifier: string): string =>
  createHash("sha256").update(codeVerifier, "ascii").digest("base64url");

/** A fresh `state` for one sign-in: 22 characters of unpadded base64url. */
const createState = (): string =>
  randomBytes(STATE_BYTE_COUNT).toString("base64url");

/** `http://127.0.0.1:<port>/callback`: the literal IPv4 loopback address, never `localhost`. */
const loopbackRedirectUri = (port: number): string => {
  if (
    !Number.isInteger(port) ||
    port < MIN_LOOPBACK_PORT ||
    port > MAX_LOOPBACK_PORT
  ) {
    throw new RangeError(
      `loopbackRedirectUri: port must be an integer from ${MIN_LOOPBACK_PORT} to ${MAX_LOOPBACK_PORT}, received ${String(port)}`
    );
  }
  return `http://127.0.0.1:${port}/callback`;
};

export {
  codeChallengeOf,
  createCodeVerifier,
  createState,
  loopbackRedirectUri,
};
