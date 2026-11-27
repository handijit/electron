import { request } from "node:http";

import { vi } from "vitest";

import type { SecretStore } from "../../lib/main/secret-store";

/** A secret store kept in a Map; each method is a spy whose behaviour a test may replace. */
const createFakeSecretStore = (
  initial: Record<string, string> = {}
): SecretStore & { values: Map<string, string> } => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    isAvailable: vi.fn(async () => true),
    get: vi.fn(async (name: string) => values.get(name) ?? null),
    set: vi.fn(async (name: string, value: string) => {
      values.set(name, value);
    }),
    delete: vi.fn(async (name: string) => {
      values.delete(name);
    }),
  };
};

/** A JSON answer of a fake server. */
const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** An OAuth token answer. */
const tokenAnswer = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: { id: "u1", name: "Ayşe", email: "ayse@example.com" },
  ...overrides,
});

type RawAnswer = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
};

/** A request to the loopback listener with full control over the method and the Host header. */
const rawRequest = (
  port: number,
  path: string,
  { method = "GET", host }: { method?: string; host?: string } = {}
): Promise<RawAnswer> =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { host: host ?? `127.0.0.1:${port}` },
        agent: false,
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          body += chunk;
        });
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body,
          });
        });
      }
    );
    outgoing.on("error", reject);
    outgoing.end();
  });

/** Resolves on the next turn of the event loop, after every pending promise reaction. */
const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export { createFakeSecretStore, flush, jsonResponse, rawRequest, tokenAnswer };
