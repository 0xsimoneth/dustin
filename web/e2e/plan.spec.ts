import { expect, test, type Page, type Request } from "@playwright/test";
import { EXAMPLE } from "../src/example";
import { answerFor, loadRecorded, messyAccounts, type Recorded } from "../test/helpers/recorded";

/**
 * The page against the recorded messy fixture: every request to Horizon is answered from the
 * repository's fixtures, every other request to another host is refused, so the test needs no
 * network. The example account is planned and the rendered plan checked; then the error paths,
 * and the promises the page makes: no secret is ever asked for, nothing but the page's own
 * assets is loaded, nothing is ever posted.
 */

const HORIZON_HOST = "horizon-testnet.stellar.org";
const recorded = loadRecorded();
const messy = messyAccounts();

interface Observed {
  horizon: Request[];
  leaks: string[];
}

async function serveHorizon(
  page: Page,
  overrides: Record<string, Recorded | null> = {},
  unreachable = false,
): Promise<Observed> {
  const observed: Observed = { horizon: [], leaks: [] };
  await page.route(
    (url) => url.hostname !== HORIZON_HOST && url.hostname !== "127.0.0.1",
    (route) => {
      observed.leaks.push(route.request().url());
      return route.abort("blockedbyclient");
    },
  );
  await page.route(
    (url) => url.hostname === HORIZON_HOST,
    (route) => {
      observed.horizon.push(route.request());
      if (unreachable) return route.abort("connectionrefused");
      const url = new URL(route.request().url());
      const answer = answerFor(recorded, url.pathname + url.search, overrides);
      return route.fulfill({
        status: answer.status,
        contentType: "application/hal+json",
        body: JSON.stringify(answer.body),
      });
    },
  );
  return observed;
}

// The checkbox "--prefer-destination" is labelled with the word too, so the field is matched by
// its label's start.
const account = (page: Page) => page.getByLabel("Account to close");
const destination = (page: Page) => page.getByLabel(/^Destination \(/);
const sponsor = (page: Page) => page.getByLabel("Fee sponsor");
const planButton = (page: Page) => page.getByRole("button", { name: "Plan", exact: true });
const result = (page: Page) => page.locator("#result");
const status = (page: Page) => page.locator("#status");

test("plans the example account from the recorded fixture and renders the plan", async ({
  page,
}) => {
  const observed = await serveHorizon(page);
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/testnet/i);
  await expect(page.locator(".banner")).toContainText("Testnet only");
  await expect(page.locator(".lead")).toContainText(
    "This page only plans. It never asks for a secret key; closing happens in your terminal or your own code.",
  );

  await page.getByRole("button", { name: "Load the example account" }).click();
  await expect(account(page)).toHaveValue(EXAMPLE.account);
  await expect(destination(page)).toHaveValue(EXAMPLE.destination);
  await expect(sponsor(page)).toHaveValue(EXAMPLE.sponsor);
  expect(EXAMPLE.account).toBe(messy.fixture);

  await planButton(page).click();
  await expect(result(page)).toBeVisible();
  await expect(status(page)).toContainText("Plan ready: CLOSABLE, 12 steps.");

  // The status as a word, the figures, and the steps as the CLI orders them.
  await expect(result(page).locator(".status-word")).toHaveText("CLOSABLE");
  await expect(result(page)).toContainText("the plan ends in a merge");
  await expect(result(page)).toContainText(
    "4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0.0000000 XLM",
  );
  await expect(result(page)).toContainText("4.0000007 XLM arrives at GBQG...DH2C");
  await expect(result(page)).toContainText(
    "0.5000000 XLM reserve unlocked for sponsor GAFW...GGLE",
  );
  await expect(result(page)).toContainText(
    "bid up to 0.0625350 XLM (41,690 stroops per operation)",
  );
  await expect(result(page)).toContainText(
    "5.0000000 XLM per close for the sponsor; the bid above is within it",
  );
  const rows = result(page).locator("table.steps tbody tr");
  await expect(rows).toHaveCount(12);
  await expect(rows.first()).toContainText("cancel offer 826680: sells 0.0000002 DUSTA for XLM");
  await expect(rows.last()).toContainText("merge into GBQG...DH2C (cannot be undone)");
  await expect(result(page).locator(".transactions li")).toHaveCount(3);

  // Explorer links for the account, the destination, the sponsor and the issuer.
  const explorerLinks = result(page).locator(
    'a[href^="https://stellar.expert/explorer/testnet/account/"]',
  );
  await expect(explorerLinks).toHaveCount(4);
  await expect(explorerLinks.nth(0)).toHaveAttribute(
    "href",
    `https://stellar.expert/explorer/testnet/account/${messy.fixture}`,
  );
  await expect(explorerLinks.nth(3)).toHaveAttribute(
    "href",
    `https://stellar.expert/explorer/testnet/account/${messy.issuer}`,
  );

  // The two toggles: the plan JSON, and the plan as the CLI prints it.
  await page.getByText("Plan JSON", { exact: true }).click();
  await expect(result(page).locator("pre.json")).toContainText('"kind": "dustin-close-plan"');
  await expect(result(page).locator("pre.json")).toContainText('"planHash"');
  await page.getByText("As the CLI prints it", { exact: true }).click();
  await expect(result(page).locator("pre.cli")).toContainText(
    "Dustin plan  (dry run: nothing is signed, nothing is submitted)",
  );
  await expect(result(page).locator("pre.cli")).toContainText("Status       CLOSABLE");

  // The "Run it yourself" box: the exact commands, the variables' names, never a value.
  const commands = page.locator("#commands");
  await expect(commands.locator("pre").nth(0)).toHaveText(
    `npx stellar-dustin plan ${EXAMPLE.account} --to ${EXAMPLE.destination} --sponsor ${EXAMPLE.sponsor}`,
  );
  await expect(commands.locator("pre").nth(1)).toContainText("DUSTIN_ACCOUNT_SECRET");
  await expect(commands.locator("pre").nth(1)).toContainText("DUSTIN_SPONSOR_SECRET");
  await expect(commands.locator("pre").nth(1)).toContainText(
    `npx stellar-dustin close ${EXAMPLE.account} --to ${EXAMPLE.destination} --sponsor ${EXAMPLE.sponsor} --execute`,
  );
  // The two copy buttons are told apart by their accessible names (W5).
  await expect(
    commands.getByRole("button", { name: "Copy the plan command", exact: true }),
  ).toHaveCount(1);
  await expect(
    commands.getByRole("button", { name: "Copy the close command", exact: true }),
  ).toHaveCount(1);

  // The page carries its Content-Security-Policy, and nothing on it was refused by that policy
  // (W9): Horizon is the one host connect-src allows besides the page's own.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    "content",
    /connect-src 'self' https:\/\/horizon-testnet\.stellar\.org/,
  );
  expect(cspViolations).toEqual([]);

  // Horizon saw GET requests only, and nothing left for any other host.
  expect(observed.horizon.length).toBeGreaterThan(0);
  expect(observed.horizon.map((r) => r.method())).toEqual(observed.horizon.map(() => "GET"));
  expect(observed.horizon.some((r) => /transactions/.test(r.url()))).toBe(false);
  expect(observed.leaks).toEqual([]);
});

test("never asks for a secret and loads nothing but its own assets", async ({ page }) => {
  const observed = await serveHorizon(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load the example account" }).click();
  await planButton(page).click();
  await expect(result(page)).toBeVisible();

  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const controls = await page.locator("input, textarea, select").evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLInputElement;
      const labels = Array.from(element.labels ?? [])
        .map((l) => l.textContent ?? "")
        .join(" ");
      return [
        element.type,
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute("aria-label") ?? "",
        element.autocomplete,
        labels,
      ].join(" | ");
    }),
  );
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control).not.toMatch(/secret|seed|private|mnemonic|passphrase|password/i);
  }

  // Every script and stylesheet is the page's own; no external font or analytics.
  const external = await page.evaluate(() => {
    const own = location.origin;
    const urls = [
      ...Array.from(document.scripts).map((s) => s.src),
      ...Array.from(document.querySelectorAll("link[href]")).map(
        (l) => (l as HTMLLinkElement).href,
      ),
    ].filter(Boolean);
    return urls.filter((u) => new URL(u, location.href).origin !== own);
  });
  expect(external).toEqual([]);
  expect(observed.leaks).toEqual([]);
});

test("explains a malformed address in plain words without asking Horizon", async ({ page }) => {
  const observed = await serveHorizon(page);
  await page.goto("/");
  await account(page).fill("GABC");
  await planButton(page).click();
  await expect(status(page).getByRole("alert")).toContainText("That address is not valid");
  await expect(status(page)).toContainText("The account to close is not a valid G... address.");
  await expect(status(page)).toContainText("56 characters starting with G");
  expect(observed.horizon).toEqual([]);
  await expect(result(page)).toBeHidden();
});

test("a missing account is a BLOCKED plan with the 404 explained", async ({ page }) => {
  await serveHorizon(page, { [`/accounts/${messy.fixture}`]: null });
  await page.goto("/");
  await page.getByRole("button", { name: "Load the example account" }).click();
  await planButton(page).click();
  await expect(result(page)).toBeVisible();
  await expect(result(page).locator(".status-word")).toHaveText("BLOCKED");
  await expect(result(page)).toContainText("ACCOUNT_MISSING");
  await expect(result(page)).toContainText("Horizon answered 404");
  await expect(result(page).locator("table.steps")).toHaveCount(0);
});

test("without a destination the cleanup is listed and the plan is BLOCKED by DESTINATION_MISSING", async ({
  page,
}) => {
  await serveHorizon(page);
  await page.goto("/");
  await account(page).fill(EXAMPLE.account);
  await planButton(page).click();
  await expect(result(page)).toBeVisible();
  await expect(result(page).locator(".status-word")).toHaveText("BLOCKED");
  await expect(result(page)).toContainText("DESTINATION_MISSING");
  await expect(result(page).locator("table.steps tbody tr")).toHaveCount(11);
  await expect(result(page)).not.toContainText("cannot be undone");
  await expect(page.locator("#commands pre").nth(0)).toContainText("--to G<DESTINATION>");
});

test("an unreachable Horizon is said in plain words", async ({ page }) => {
  test.slow();
  await serveHorizon(page, {}, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Load the example account" }).click();
  await planButton(page).click();
  // Before the SDK gives up, the page says in plain words that Horizon is slow (W10).
  await expect(status(page)).toContainText("Still waiting for Horizon", { timeout: 6_000 });
  // The SDK retries three times with a growing pause (1, 2 and 4 s) before it gives up.
  await expect(status(page).getByRole("alert")).toContainText("Horizon could not be reached", {
    timeout: 30_000,
  });
  await expect(status(page)).toContainText("HORIZON_UNAVAILABLE");
  await expect(status(page)).toContainText("Check the network connection");
});

test("fits the viewport: no horizontal scrolling at any width", async ({ page }) => {
  await serveHorizon(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load the example account" }).click();
  await planButton(page).click();
  await expect(result(page)).toBeVisible();
  await page.getByText("Plan JSON", { exact: true }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("is operable from the keyboard: the form submits with Enter and focus moves to the plan", async ({
  page,
}) => {
  await serveHorizon(page);
  await page.goto("/");
  await account(page).fill(EXAMPLE.account);
  await destination(page).fill(EXAMPLE.destination);
  await destination(page).press("Enter");
  await expect(result(page)).toBeVisible();
  await expect(page.locator("#result-heading")).toBeFocused();
});

test("marks the plan stale once an input changes, until the next plan replaces it", async ({
  page,
}) => {
  await serveHorizon(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load the example account" }).click();
  await planButton(page).click();
  await expect(result(page)).toBeVisible();
  const note = page.locator("#stale-note");
  await expect(note).toBeHidden();

  await sponsor(page).fill("");
  await expect(note).toBeVisible();
  await expect(note).toContainText("The inputs changed since this plan was made");
  await expect(result(page)).toHaveClass(/stale/);
  await expect(page.locator("#commands pre").nth(0)).not.toContainText("--sponsor");

  await planButton(page).click();
  await expect(result(page)).toBeVisible();
  await expect(note).toBeHidden();
  await expect(result(page)).not.toHaveClass(/stale/);
  await expect(result(page).locator(".status-word")).toHaveText("CLOSABLE");
  await expect(result(page)).toContainText("the payer is named fee_sponsor");
});
