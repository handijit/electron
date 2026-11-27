import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import UpdateGate from "../../lib/update-ui/update-gate";
import { createFakeClient } from "../helpers/update-client";
import { INFO, makeState, policyOf } from "../helpers/update-fixtures";

afterEach(cleanup);

const REQUIRED = policyOf("required");
const ERROR = { code: "SERVER", message: "Sunucu yok." } as const;

const renderGate = (
  state: ReturnType<typeof makeState> | null,
  props: Partial<Parameters<typeof UpdateGate>[0]> = {}
) => {
  const fake = createFakeClient(state);
  const view = render(
    <UpdateGate client={fake.client} productName="Notlar" {...props}>
      <button type="button">Kaydet</button>
    </UpdateGate>
  );
  const content = view.container.querySelector(".hdu-gate__content");
  return { ...fake, view, content };
};

const required = (overrides: Record<string, unknown>) =>
  makeState({ policy: REQUIRED, ...overrides });

describe("UpdateGate", () => {
  test("should render only the program while nothing is required", () => {
    for (const state of [
      null,
      makeState({ policy: policyOf("recommended") }),
    ]) {
      const { content } = renderGate(state);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(content?.hasAttribute("inert")).toBe(false);
      expect(screen.getByRole("button", { name: "Kaydet" })).toBeTruthy();
      cleanup();
    }
  });

  test("should cover the program, make it inert and name both versions", () => {
    const { content } = renderGate(
      required({ status: "available", update: INFO }),
      {
        titleBar: <span>window controls</span>,
      }
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(screen.getByText("Güncelleme gerekli")).toBeTruthy();
    expect(screen.getByText(/Notlar programının kurulu sürümü/)).toBeTruthy();
    expect(screen.getByText("1.4.0")).toBeTruthy();
    expect(screen.getByText("1.5.0")).toBeTruthy();
    expect(screen.getByText("window controls")).toBeTruthy();
    expect(screen.getByText("İndirme boyutu 83,9 MB.")).toBeTruthy();
  });

  test("should update now on the one button and focus it", () => {
    const { client } = renderGate(
      required({ status: "available", update: INFO })
    );
    const button = screen.getByRole("button", { name: "Şimdi güncelle" });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(client.install).toHaveBeenCalledTimes(1);
  });

  test("should leave out a size the feed did not give", () => {
    const { view } = renderGate(
      required({ status: "available", update: { ...INFO, sizeBytes: null } })
    );
    expect(view.container.querySelector(".hdu-gate__note")?.textContent).toBe(
      ""
    );
  });

  test("should focus the gate itself while searching", () => {
    renderGate(required({ status: "checking" }));
    expect(
      screen.getByText("Yeni sürüm aranıyor…", { selector: "p" })
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("alertdialog"));
    // No update known: the version comes from the policy.
    expect(screen.getByText("Yeni sürüm")).toBeTruthy();
  });

  test("should name no new version when nothing tells it", () => {
    renderGate(
      makeState({ status: "checking", policy: policyOf("required", null) })
    );
    expect(screen.queryByText("Yeni sürüm")).toBeNull();
  });

  test("should show the download with its sizes and speed", () => {
    const { view } = renderGate(
      required({
        status: "downloading",
        update: INFO,
        progress: {
          percent: 50,
          transferredBytes: 1024 * 1024,
          totalBytes: 2 * 1024 * 1024,
          bytesPerSecond: 512 * 1024,
        },
      })
    );
    expect(view.container.querySelector(".hdu-gate__meter")?.textContent).toBe(
      "1,0 MB / 2,0 MB · 512 KB/sn"
    );
    expect(view.container.querySelector(".hdu-gate__note")?.textContent).toBe(
      "Güncelleme indiriliyor"
    );
  });

  test("should say that it restarts after the download it was asked for", () => {
    const { view } = renderGate(
      required({
        status: "downloading",
        update: INFO,
        isInstallPending: true,
        progress: {
          percent: 0,
          transferredBytes: 0,
          totalBytes: 0,
          bytesPerSecond: 0,
        },
      })
    );
    expect(view.container.querySelector(".hdu-gate__meter")?.textContent).toBe(
      "0 KB"
    );
    expect(view.container.querySelector(".hdu-gate__note")?.textContent).toBe(
      "Güncelleme indiriliyor. İndirme bitince program kendiliğinden yeniden başlayacak."
    );
  });

  test("should restart into a downloaded update, then show it restarting", () => {
    const { client, set } = renderGate(
      required({ status: "downloaded", update: INFO })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Yeniden başlat ve güncelle" })
    );
    expect(client.install).toHaveBeenCalledTimes(1);
    act(() =>
      set(
        required({
          status: "downloaded",
          update: INFO,
          isInstallPending: true,
          revision: 2,
        })
      )
    );
    expect(
      within(screen.getByRole("alertdialog")).queryByRole("button")
    ).toBeNull();
    expect(
      screen.getByText("Yeniden başlatılıyor…", { selector: "p" })
    ).toBeTruthy();
  });

  test("should offer a retry and the manual download after a failure", () => {
    const { client } = renderGate(
      required({ status: "error", error: ERROR, update: null })
    );
    expect(screen.getByText("Sunucu yok.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    fireEvent.click(screen.getByRole("button", { name: "Yeni sürümü indir" }));
    expect(client.install).toHaveBeenCalledTimes(1);
    expect(client.openDownloadPage).toHaveBeenCalledTimes(1);
  });

  test("should offer only the manual download where the build cannot update itself", () => {
    const { client } = renderGate(
      required({ status: "unsupported", reason: "unsigned" })
    );
    const button = screen.getByRole("button", { name: "Yeni sürümü indir" });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(client.openDownloadPage).toHaveBeenCalledTimes(1);
  });

  test("should say the version has not arrived yet and offer a retry", () => {
    for (const status of ["idle", "not-available"]) {
      const { client } = renderGate(required({ status }), {
        labels: { retry: "Try again" },
      });
      expect(screen.getByText(/henüz ulaşmadı/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(client.check).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  test("should never turn a refused click into an unhandled rejection", async () => {
    const { client } = renderGate(required({ status: "not-available" }));
    client.check.mockRejectedValue(new Error("no bridge"));
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    await act(async () => undefined);
    expect(client.check).toHaveBeenCalledTimes(1);
  });

  test("should give the program back when the update stops being required", () => {
    const { set, content } = renderGate(required({ status: "not-available" }));
    act(() => set(makeState({ status: "not-available", revision: 2 })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(content?.hasAttribute("inert")).toBe(false);
  });
});
