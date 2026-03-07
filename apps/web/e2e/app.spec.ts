import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end coverage of the reference app.
 *
 * The wallet is a browser extension and cannot be driven by Playwright, but
 * `FreighterSigner` reads `globalThis.freighterApi`, so a stub injected before
 * page load exercises the real connect path — the app code, the SDK adapter,
 * and the rendering that depends on a connected account. Everything short of
 * the extension itself is genuinely under test.
 */

const STUB_ADDRESS = "GC4RWN3HH5H5GMD3NT4MOIYC3H3Q3NUF4BFWATGDI7NKRVLRURKHSIMC";

/**
 * Waits for a connected session.
 *
 * Deliberately does not click. The stub reports the site as already
 * authorised, so the app restores the session on load — and clicking would
 * race that restore: the button is present on first paint and gone a tick
 * later, so the click lands on nothing.
 */
async function connect(page: Page) {
  await expect(page.getByText("Disconnect")).toBeVisible({ timeout: 10_000 });
}

/** Installs a fake Freighter that reports connected and returns an address. */
async function stubWallet(page: Page, options: { connected?: boolean } = {}) {
  const connected = options.connected ?? true;
  await page.addInitScript(
    ({ address, isConnected }) => {
      (globalThis as Record<string, unknown>)["freighterApi"] = {
        isConnected: async () => isConnected,
        getAddress: async () => ({ address }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
      };
    },
    { address: STUB_ADDRESS, isConnected: connected },
  );
}

test.describe("shell", () => {
  test("every route renders and keeps the testnet warning visible", async ({
    page,
  }) => {
    for (const path of ["/", "/payroll", "/streams", "/vesting", "/escrow"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      // The unaudited warning is a permanent fixture, not dismissible.
      await expect(page.getByText("Testnet only.")).toBeVisible();
      await expect(page.getByText("unaudited")).toBeVisible();
    }
  });

  test("navigation marks the current section", async ({ page }) => {
    await page.goto("/");
    // Scoped to the nav: the overview page also has a tile linking to /streams.
    await page.locator("nav").getByRole("link", { name: "Streams" }).click();
    await expect(page).toHaveURL(/\/streams$/);
    await expect(
      page.getByRole("heading", { name: "Streams", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("wallet", () => {
  test("reconnects an already-authorised wallet without a click", async ({
    page,
  }) => {
    await stubWallet(page);
    await page.goto("/");
    // No click: Freighter reports the site is already authorised, so the
    // session is restored silently and no popup is raised.
    await expect(page.getByText("Disconnect")).toBeVisible();
    // The address is shortened but the full value is in the title attribute.
    await expect(page.locator(`[title="${STUB_ADDRESS}"]`).first()).toBeVisible();
  });

  test("explains itself when no wallet is present", async ({ page }) => {
    // No stub at all: the extension is simply not installed.
    await page.goto("/");
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await expect(page.getByText(/Freighter was not found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "friendbot" })).toBeVisible();
  });

  test("reports a locked wallet distinctly from a missing one", async ({ page }) => {
    await stubWallet(page, { connected: false });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await expect(page.getByText(/not connected/i)).toBeVisible();
  });

  test("disconnect returns to the connect prompt", async ({ page }) => {
    await stubWallet(page);
    await page.goto("/");
    await connect(page);
    await page.getByText("Disconnect").click();
    await expect(
      page.getByRole("button", { name: "Connect wallet" }).first(),
    ).toBeVisible();
  });
});

test.describe("payroll", () => {
  test.beforeEach(async ({ page }) => {
    await stubWallet(page);
    await page.goto("/payroll");
    await connect(page);
  });

  test("validates each CSV line separately", async ({ page }) => {
    await page.locator("textarea").fill(
      [
        `${STUB_ADDRESS},10`,
        "not-an-address,5",
        `${STUB_ADDRESS},abc`,
        `${STUB_ADDRESS},0`,
      ].join("\n"),
    );

    // An operator must see WHICH row is wrong, not "invalid CSV".
    await expect(page.getByText("Not a valid account address (G…)")).toBeVisible();
    await expect(page.getByText(/not a valid decimal amount/i)).toBeVisible();
    await expect(page.getByText("Amount must be greater than zero")).toBeVisible();
    await expect(page.getByText("3 line(s) to fix")).toBeVisible();
  });

  test("refuses to send while any line is invalid", async ({ page }) => {
    await page.locator("textarea").fill(`${STUB_ADDRESS},10\nbroken,1`);
    await expect(page.getByRole("button", { name: /^Pay/ })).toBeDisabled();
  });

  test("totals valid lines with tabular figures", async ({ page }) => {
    await page.locator("textarea").fill(
      `${STUB_ADDRESS},10.5\n${STUB_ADDRESS},4.5`,
    );
    await expect(page.getByText("2 recipients")).toBeVisible();
    // 10.5 + 4.5 = 15, formatted by the SDK.
    await expect(page.locator(".amount--lg")).toContainText("15");
  });

  test("warns about duplicates without blocking them", async ({ page }) => {
    await page.locator("textarea").fill(
      `${STUB_ADDRESS},10\n${STUB_ADDRESS},20`,
    );
    await expect(page.getByText(/appears more than once/i)).toBeVisible();
    // Duplicates are legitimate on chain, so the button stays enabled.
    await expect(page.getByRole("button", { name: /^Pay/ })).toBeEnabled();
  });

  test("ignores comment lines", async ({ page }) => {
    await page.locator("textarea").fill(`# payroll for March\n${STUB_ADDRESS},10`);
    await expect(page.getByText("1 recipient")).toBeVisible();
  });

  test("confirmation states the consequence before the wallet prompt", async ({
    page,
  }) => {
    await page.locator("textarea").fill(`${STUB_ADDRESS},10`);
    await page.getByRole("button", { name: /^Pay/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("This cannot be undone")).toBeVisible();
    await expect(dialog.getByText(/nobody is paid/i)).toBeVisible();
    await expect(dialog.getByText(/Nothing is sent until you do/i)).toBeVisible();

    // Cancelling must send nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("position registry", () => {
  test.beforeEach(async ({ page }) => {
    await stubWallet(page);
  });

  test("empty state says what to do next", async ({ page }) => {
    await page.goto("/streams");
    await expect(page.getByText("No streams tracked yet")).toBeVisible();
    await expect(page.getByText(/paste its address below/i)).toBeVisible();
  });

  test("rejects something that is not a contract address", async ({ page }) => {
    await page.goto("/streams");
    await page.locator("#stream-id").fill("nonsense");
    await page.getByRole("button", { name: "Track stream" }).click();
    await expect(page.getByText(/should start with C and be 56 characters/i)).toBeVisible();
  });

  test("tracks an address and survives a reload", async ({ page }) => {
    const contractId = "CBEE4SRXRGCJDWXP6DDOSX6FR4S2PJ5KHUQCHI3ABY3SQTCHYSA7CGC7";
    await page.goto("/streams");
    await page.locator("#stream-id").fill(contractId);
    await page.locator("#stream-label").fill("Ada's stream");
    await page.getByRole("button", { name: "Track stream" }).click();

    await expect(page.getByRole("heading", { name: "Ada's stream" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ada's stream" })).toBeVisible();

    // Untracking is local only and must not claim to touch the chain.
    const stop = page.getByRole("button", { name: "Stop tracking" });
    await expect(stop).toHaveAttribute("title", /contract is untouched/i);
    await stop.click();
    await expect(page.getByText("No streams tracked yet")).toBeVisible();
  });
});

test.describe("session restore", () => {
  test("stays connected across a full page load", async ({ page }) => {
    // Regression: the connection lived only in React state, so a refresh or a
    // direct link landed the user disconnected. Freighter reports an existing
    // authorisation, so it is restored without a popup.
    await stubWallet(page);
    await page.goto("/");
    await connect(page);

    await page.goto("/payroll");
    await expect(page.getByText("Disconnect")).toBeVisible();
    await expect(
      page.getByText("Connect a wallet to run a payout."),
    ).toBeHidden();
  });

  test("an explicit disconnect is not undone by the restore", async ({ page }) => {
    await stubWallet(page);
    await page.goto("/");
    await connect(page);
    await page.getByText("Disconnect").click();
    // Must stay disconnected rather than silently reconnecting.
    await expect(
      page.getByRole("button", { name: "Connect wallet" }).first(),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByText("Disconnect")).toBeHidden();
  });
});
