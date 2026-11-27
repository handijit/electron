import { describe, expect, test, vi } from "vitest";

import createPolicyClient, {
  parsePolicyAnswer,
  PolicyRequestError,
} from "../../lib/update/policy-client";

const QUERY = { os: "windows", arch: "x64", channel: "stable" } as const;
const URL_BASE = "https://api.example.com/products/notes/update-policy?key=1";

const clientWith = (
  response: Response | (() => Promise<Response>),
  parse = parsePolicyAnswer
) => {
  const fetch = vi.fn(
    typeof response === "function" ? response : async () => response
  );
  const request = createPolicyClient({
    url: URL_BASE,
    fetch,
    parse,
    timeoutMs: 1000,
    now: () => Date.parse("2026-11-10T09:00:00Z"),
  });
  return { fetch, request };
};

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), init);

describe("parsePolicyAnswer", () => {
  test("should read the two versions", () => {
    expect(parsePolicyAnswer({ latestVersion: "1.5.0" })).toEqual({
      latestVersion: "1.5.0",
      minSupportedVersion: null,
    });
    expect(
      parsePolicyAnswer({
        latestVersion: "1.5.0",
        minSupportedVersion: "1.4.0",
      })
    ).toEqual({ latestVersion: "1.5.0", minSupportedVersion: "1.4.0" });
  });

  test.each([
    null,
    "1.5.0",
    {},
    { latestVersion: 1 },
    { latestVersion: "1.5.0", minSupportedVersion: 1 },
  ])("should refuse %j", (body) => {
    expect(parsePolicyAnswer(body)).toBeNull();
  });
});

describe("createPolicyClient", () => {
  test("should ask with the platform in the query and read the answer", async () => {
    const { fetch, request } = clientWith(
      json({ latestVersion: "1.5.0", minSupportedVersion: null })
    );
    const answer = await request(QUERY, new AbortController().signal);
    expect(answer).toEqual({
      latestVersion: "1.5.0",
      minSupportedVersion: null,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.example.com/products/notes/update-policy?key=1&os=windows&arch=x64&channel=stable"
    );
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("should answer null for a 404", async () => {
    const { request } = clientWith(new Response("", { status: 404 }));
    expect(await request(QUERY, new AbortController().signal)).toBeNull();
  });

  test("should reject a 429 with its Retry-After", async () => {
    const { request } = clientWith(
      new Response("", { status: 429, headers: { "Retry-After": "120" } })
    );
    const error = await request(QUERY, new AbortController().signal).catch(
      (cause: unknown) => cause
    );
    expect(error).toBeInstanceOf(PolicyRequestError);
    expect(error).toMatchObject({
      status: 429,
      retryAfterSeconds: 120,
      name: "PolicyRequestError",
      message: "the policy endpoint answered 429",
    });
  });

  test("should reject another error status without a wait", async () => {
    const { request } = clientWith(new Response("", { status: 503 }));
    await expect(
      request(QUERY, new AbortController().signal)
    ).rejects.toMatchObject({ status: 503, retryAfterSeconds: undefined });
  });

  test("should reject a body that is not JSON or not a policy", async () => {
    const { request } = clientWith(new Response("<html>"));
    await expect(
      request(QUERY, new AbortController().signal)
    ).rejects.toMatchObject({
      status: null,
      message: "the policy is not JSON",
    });

    const refused = clientWith(json({ latest: "1.5.0" }));
    await expect(
      refused.request(QUERY, new AbortController().signal)
    ).rejects.toMatchObject({ message: "the policy has an unknown shape" });
  });

  test("should let the program parse its own shape", async () => {
    const { request } = clientWith(json({ v: "2.0.0" }), (body) => ({
      latestVersion: (body as { v: string }).v,
    }));
    expect(await request(QUERY, new AbortController().signal)).toEqual({
      latestVersion: "2.0.0",
    });
  });

  test("should pass a network failure on", async () => {
    const { request } = clientWith(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(request(QUERY, new AbortController().signal)).rejects.toThrow(
      "fetch failed"
    );
  });
});
