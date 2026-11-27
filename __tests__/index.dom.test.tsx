import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import * as authReact from "@handijitcom/electron/auth-react";
import * as updateReact from "@handijitcom/electron/update-react";
import * as updateUi from "@handijitcom/electron/update-ui";

describe("@handijitcom/electron/auth-react", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(authReact).sort()).toEqual(["useAuth"]);
  });
});

describe("@handijitcom/electron/update-react", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(updateReact).sort()).toEqual(["useUpdate"]);
  });
});

describe("@handijitcom/electron/update-ui", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(updateUi).sort()).toEqual([
      "DEFAULT_UPDATE_LABELS",
      "UpdateButton",
      "UpdateGate",
    ]);
  });

  test("should render the program through the barrel when no update is required", () => {
    const { getByText } = render(
      <updateUi.UpdateGate productName="Notes">
        <p>program</p>
      </updateUi.UpdateGate>
    );
    expect(getByText("program").textContent).toBe("program");
  });
});
