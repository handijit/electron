import { UISize } from "@handijitcom/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import UpdateButton from "../../lib/update-ui/update-button";
import { createFakeClient } from "../helpers/update-client";
import { INFO, makeState } from "../helpers/update-fixtures";

const PROGRESS = {
  percent: 40.7,
  transferredBytes: 40,
  totalBytes: 100,
  bytesPerSecond: 10,
};
const ERROR = { code: "OFFLINE", message: "İnternet yok." } as const;

afterEach(cleanup);

const renderWith = (
  state: ReturnType<typeof makeState> | null,
  props: Partial<Parameters<typeof UpdateButton>[0]> = {}
) => {
  const fake = createFakeClient(state);
  const view = render(<UpdateButton client={fake.client} {...props} />);
  return { ...fake, view };
};

describe("UpdateButton", () => {
  test("should draw nothing but an empty live region while there is nothing to do", () => {
    for (const state of [
      null,
      makeState(),
      makeState({ status: "checking" }),
      makeState({ status: "not-available" }),
      makeState({ status: "unsupported", reason: "platform" }),
    ]) {
      const { view } = renderWith(state);
      expect(view.container.querySelector(".hdu-update")).toBeNull();
      expect(screen.getByRole("status").textContent).toBe("");
      cleanup();
    }
  });

  test("should offer a check in a settings page", async () => {
    const { client, view } = renderWith(makeState(), {
      isAlwaysVisible: true,
      className: "extra",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Güncellemeleri denetle" })
    );
    expect(client.check).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".hdu-update")?.className).toBe(
      "hdu-update extra"
    );
    cleanup();
    renderWith(null, { isAlwaysVisible: true });
    expect(screen.getByRole("button").textContent).toContain("denetle");
  });

  test("should show checking, up to date and unsupported in a settings page", () => {
    renderWith(makeState({ status: "checking" }), { isAlwaysVisible: true });
    expect(
      (
        screen.getByRole("button", {
          name: /Denetleniyor/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    cleanup();
    renderWith(makeState({ status: "not-available" }), {
      isAlwaysVisible: true,
    });
    expect(screen.getByText("Program güncel")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Güncellemeleri denetle" })
    ).toBeTruthy();
    cleanup();
    renderWith(makeState({ status: "unsupported", reason: "unsigned" }), {
      isAlwaysVisible: true,
    });
    expect(screen.getByText("Bu kurulum kendini güncelleyemiyor")).toBeTruthy();
  });

  test("should offer the published version and announce it", () => {
    const { client } = renderWith(
      makeState({ status: "available", update: INFO })
    );
    fireEvent.click(screen.getByRole("button", { name: "Güncelle 1.5.0" }));
    expect(client.download).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe(
      "1.5.0 sürümü yayımlandı. Güncelleyebilirsiniz."
    );
  });

  test("should show the download's progress", () => {
    const { view } = renderWith(
      makeState({ status: "downloading", update: INFO, progress: PROGRESS }),
      { size: UISize.MEDIUM }
    );
    expect(
      view.container.querySelector(".hdu-update__percent")?.textContent
    ).toBe("%40");
    expect(
      view.container
        .querySelector(".hdu-update__progress")
        ?.getAttribute("data-size")
    ).toBe("MEDIUM");
    expect(screen.queryByText("Güncelleme indiriliyor")).toBeNull();
    cleanup();
    renderWith(
      makeState({ status: "downloading", update: INFO, progress: PROGRESS }),
      {
        isAlwaysVisible: true,
      }
    );
    expect(screen.getByText("Güncelleme indiriliyor")).toBeTruthy();
  });

  test("should offer the restart, and show it running", () => {
    const { client } = renderWith(
      makeState({ status: "downloaded", update: INFO })
    );
    fireEvent.click(screen.getByRole("button", { name: "Yeniden başlat" }));
    expect(client.install).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("indirildi");
    cleanup();
    renderWith(
      makeState({ status: "downloaded", update: INFO, isInstallPending: true })
    );
    expect(screen.getByRole("button").textContent).toContain(
      "Yeniden başlatılıyor…"
    );
  });

  test("should retry a failed check by checking and a failed download by downloading", () => {
    const failedCheck = renderWith(
      makeState({ status: "error", error: ERROR, update: null })
    );
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(failedCheck.client.check).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("İnternet yok.");
    expect(
      screen.queryByText("İnternet yok.", { selector: ".hdu-update__note" })
    ).toBeNull();
    cleanup();

    const failedDownload = renderWith(
      makeState({ status: "error", error: ERROR, update: INFO }),
      { isAlwaysVisible: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(failedDownload.client.download).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("İnternet yok.", { selector: ".hdu-update__note" })
    ).toBeTruthy();
  });

  test("should take replacement labels and follow state changes", () => {
    const { set } = renderWith(makeState(), {
      isAlwaysVisible: true,
      labels: { check: "Check for updates" },
    });
    expect(
      screen.getByRole("button", { name: "Check for updates" })
    ).toBeTruthy();
    act(() =>
      set(makeState({ status: "available", update: INFO, revision: 2 }))
    );
    expect(screen.getByRole("button", { name: "Güncelle 1.5.0" })).toBeTruthy();
  });

  test("should never turn a refused click into an unhandled rejection", async () => {
    const { client } = renderWith(
      makeState({ status: "available", update: INFO })
    );
    client.download.mockRejectedValue(new Error("no bridge"));
    fireEvent.click(screen.getByRole("button", { name: "Güncelle 1.5.0" }));
    await act(async () => undefined);
    expect(client.download).toHaveBeenCalledTimes(1);
  });
});
