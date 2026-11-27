import parseRetryAfter from "../shared/retry-after.helper";
import type { FetchLike } from "../shared/fetch-like.type";
import type { PolicyAnswer } from "./types";

/** What the policy endpoint is asked about: the platform and the channel. */
type PolicyQuery = {
  readonly os: "windows" | "macos";
  readonly arch: "x64" | "arm64";
  readonly channel: "stable" | "beta";
};

/** The endpoint answered with something other than a policy or "no release". */
class PolicyRequestError extends Error {
  /** The HTTP status; `null` when the body was unreadable. */
  readonly status: number | null;
  /** For a `429`: how long the endpoint asked to wait, in seconds. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    status: number | null,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "PolicyRequestError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Asks the policy endpoint once. */
type PolicyRequest = (
  query: PolicyQuery,
  signal: AbortSignal
) => Promise<PolicyAnswer | null>;

type PolicyClientOptions = {
  readonly url: string;
  readonly fetch: FetchLike;
  readonly parse: (body: unknown) => PolicyAnswer | null;
  readonly timeoutMs: number;
  readonly now: () => number;
};

/** Reads `latestVersion` and `minSupportedVersion` from a JSON object; `null` for anything else. */
const parsePolicyAnswer = (body: unknown): PolicyAnswer | null => {
  if (typeof body !== "object" || body === null) return null;
  const { latestVersion, minSupportedVersion } = body as Readonly<
    Record<string, unknown>
  >;
  if (typeof latestVersion !== "string") return null;
  if (
    minSupportedVersion !== undefined &&
    minSupportedVersion !== null &&
    typeof minSupportedVersion !== "string"
  ) {
    return null;
  }
  return { latestVersion, minSupportedVersion: minSupportedVersion ?? null };
};

/**
 * Builds the request of the version policy. It resolves with the answer, with `null` when the
 * endpoint has no release for this platform (`404`), and rejects for everything else: the
 * caller treats a rejection as "no news" and never blocks the program on it.
 */
const createPolicyClient =
  ({ url, fetch, parse, timeoutMs, now }: PolicyClientOptions): PolicyRequest =>
  async (query, signal) => {
    const target = new URL(url);
    target.searchParams.set("os", query.os);
    target.searchParams.set("arch", query.arch);
    target.searchParams.set("channel", query.channel);

    const response = await fetch(target.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new PolicyRequestError(
        `the policy endpoint answered ${response.status}`,
        response.status,
        response.status === 429
          ? parseRetryAfter(response.headers.get("Retry-After"), now())
          : undefined
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PolicyRequestError("the policy is not JSON", null);
    }
    const answer = parse(body);
    if (answer === null) {
      throw new PolicyRequestError("the policy has an unknown shape", null);
    }
    return answer;
  };

export type { PolicyQuery, PolicyRequest };
export { parsePolicyAnswer, PolicyRequestError };
export default createPolicyClient;
