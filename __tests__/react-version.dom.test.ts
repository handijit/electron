import { version } from "react";
import { describe, expect, test } from "vitest";

// The react18 project aliases React to the react18/ workspace; this proves the alias holds, so
// the page tests really run on both majors of the peer range.
describe("React under test", () => {
  test("should be the major the Vitest project names", () => {
    expect(version.split(".")[0]).toBe(process.env.REACT_MAJOR ?? "19");
  });
});
