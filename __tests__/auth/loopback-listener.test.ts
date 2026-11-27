import { createServer } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import startLoopbackListener from "../../lib/auth/loopback-listener";
import type { LoopbackListener } from "../../lib/auth/loopback-listener";
import { rawRequest } from "../helpers/auth-fakes";

const STATE = "state-of-this-attempt";

let listener: LoopbackListener | undefined;

const start = async (
  options: Partial<Parameters<typeof startLoopbackListener>[0]> = {}
): Promise<LoopbackListener> => {
  listener = await startLoopbackListener({ state: STATE, ...options });
  return listener;
};

const callback = (query: string): string => `/callback?${query}`;

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

describe("startLoopbackListener", () => {
  test("should bind 127.0.0.1 on a free port and name the redirect address", async () => {
    const current = await start();
    expect(current.port).toBeGreaterThanOrEqual(1024);
    expect(current.redirectUri).toBe(
      `http://127.0.0.1:${current.port}/callback`
    );
  });

  test("should accept the first good callback, redirect it and serve the done page", async () => {
    const current = await start();
    const answer = await rawRequest(
      current.port,
      callback(`code=abc&state=${STATE}`)
    );
    expect(answer.status).toBe(303);
    expect(answer.headers.location).toBe("/done");
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.headers["referrer-policy"]).toBe("no-referrer");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["content-security-policy"]).toContain(
      "default-src 'none'"
    );
    await expect(current.outcome).resolves.toEqual({
      kind: "code",
      code: "abc",
    });

    // The same callback again changes nothing; another code is refused.
    expect(
      (await rawRequest(current.port, callback(`code=abc&state=${STATE}`)))
        .status
    ).toBe(303);
    expect(
      (await rawRequest(current.port, callback(`code=xyz&state=${STATE}`)))
        .status
    ).toBe(400);

    const done = await rawRequest(current.port, "/done");
    expect(done.status).toBe(200);
    expect(done.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(done.body).toContain("Programa dönebilirsiniz");
    await current.closed;
  });

  test("should serve the program's own texts", async () => {
    const current = await start({
      pages: {
        lang: "en",
        done: { title: "Done", heading: "Go back", text: "Close this tab." },
      },
    });
    await rawRequest(current.port, callback(`code=abc&state=${STATE}`));
    const done = await rawRequest(current.port, "/done");
    expect(done.body).toContain("Go back");
  });

  test("should end the wait when the user declined on the consent page", async () => {
    const current = await start({ lingerMs: 10 });
    const answer = await rawRequest(
      current.port,
      callback(`error=access_denied&state=${STATE}`)
    );
    expect(answer.status).toBe(200);
    expect(answer.body).toContain("Giriş onaylanmadı");
    await expect(current.outcome).resolves.toEqual({
      kind: "denied",
      error: "access_denied",
    });
    // The linger timer closes the listener.
    await current.closed;
  });

  test.each([
    ["a foreign state", `code=abc&state=other`],
    ["no state", `code=abc`],
    ["two states", `code=abc&state=${STATE}&state=${STATE}`],
    ["no code", `state=${STATE}`],
    ["an empty code", `code=&state=${STATE}`],
    ["two codes", `code=a&code=b&state=${STATE}`],
    ["a code and an error", `code=a&error=x&state=${STATE}`],
    ["an overlong code", `code=${"c".repeat(2049)}&state=${STATE}`],
    ["an error with a quote", `error=a%22b&state=${STATE}`],
    ["an error with a foreign state", `error=access_denied&state=other`],
    ["two errors", `error=a&error=b&state=${STATE}`],
  ])("should refuse a callback with %s", async (_name, query) => {
    const current = await start();
    const answer = await rawRequest(current.port, callback(query));
    expect(answer.status).toBe(400);
    expect(answer.body).toContain("Bu bağlantı geçersiz");
  });

  test("should refuse a callback without a query", async () => {
    const current = await start();
    expect((await rawRequest(current.port, "/callback")).status).toBe(400);
  });

  test("should refuse a foreign Host, other paths and other methods", async () => {
    const current = await start();
    const query = callback(`code=abc&state=${STATE}`);
    const foreign = await rawRequest(current.port, query, {
      host: "evil.example:80",
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toBe("");
    expect((await rawRequest(current.port, "/favicon.ico")).status).toBe(404);
    expect((await rawRequest(current.port, "/done")).status).toBe(404);
    expect(
      (await rawRequest(current.port, query, { method: "POST" })).status
    ).toBe(404);
  });

  test("should give up after too many refused requests", async () => {
    const current = await start({ maxRefusedRequests: 2 });
    await rawRequest(current.port, "/favicon.ico");
    await rawRequest(current.port, "/other");
    await expect(current.outcome).resolves.toEqual({ kind: "refused" });
    // Over: even a good callback is refused now, without counting further.
    expect(
      (await rawRequest(current.port, callback(`code=abc&state=${STATE}`)))
        .status
    ).toBe(400);
  });

  test("should close after the linger time when the done page is never asked", async () => {
    const current = await start({ lingerMs: 10 });
    await rawRequest(current.port, callback(`code=abc&state=${STATE}`));
    await current.closed;
  });

  test("should close more than once without failing", async () => {
    const current = await start();
    await current.close();
    await current.close();
  });

  test("should accept a fixed port and refuse one outside the range", async () => {
    const probe = await start();
    const port = probe.port;
    await probe.close();
    const fixed = await start({ port });
    expect(fixed.port).toBe(port);
    await expect(
      startLoopbackListener({ state: STATE, port: 80 })
    ).rejects.toThrow(RangeError);
  });

  test("should reject when the port is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen({ host: "127.0.0.1", port: 0 }, resolve);
    });
    const address = blocker.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    await expect(startLoopbackListener({ state: STATE, port })).rejects.toThrow(
      /EADDRINUSE/
    );
    await new Promise((resolve) => blocker.close(resolve));
  });
});
