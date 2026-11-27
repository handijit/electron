/** The part of `fetch` this package calls; Electron's `net.fetch` and Node's `fetch` both fit. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type { FetchLike };
