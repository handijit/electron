import type { AuthState } from "../types";

/** Before the stored session has been read (main) or the first answer has arrived (renderer). */
const LOADING_STATE: AuthState = Object.freeze({
  status: "loading",
  user: null,
  error: null,
  isRemembered: false,
});

/** Nobody is signed in and nothing went wrong. */
const SIGNED_OUT_STATE: AuthState = Object.freeze({
  status: "signed-out",
  user: null,
  error: null,
  isRemembered: false,
});

export { LOADING_STATE, SIGNED_OUT_STATE };
