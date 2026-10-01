import "./styles.css";
import { DEFAULT_EXPLORER_BASE, renderPlan } from "stellar-dustin";
import { EXAMPLE } from "./example";
import { readInputs } from "./inputs";
import { describeError, planInBrowser } from "./plan";
import { renderCommands, renderError, renderView } from "./render";
import { toView } from "./view";

/**
 * The page's wiring: read the form, plan with the SDK in the browser, render. Nothing here signs
 * or submits; the SDK's planner only sends GET requests to the testnet Horizon.
 */

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page is missing #${id}.`);
  return element as T;
}

const form = byId<HTMLFormElement>("plan-form");
const status = byId<HTMLDivElement>("status");
const result = byId<HTMLElement>("result");
const resultBody = byId<HTMLDivElement>("result-body");
const resultHeading = byId<HTMLHeadingElement>("result-heading");
const staleNote = byId<HTMLParagraphElement>("stale-note");
const commands = byId<HTMLDivElement>("commands");
const planButton = byId<HTMLButtonElement>("plan-button");
const loadExample = byId<HTMLButtonElement>("load-example");

/**
 * While Horizon is slow the status says so in plain words: the SDK's read client retries a failed
 * request three times with a growing pause (1, 2 and 4 s), so a Horizon that is down is reported
 * after about seven seconds (docs/web-demo.md); a request that never answers at all is named
 * after twenty (E5-S1 review, W10).
 */
const SLOW_AFTER_MS = 3_000;
const STUCK_AFTER_MS = 20_000;
const SLOW_MESSAGE =
  "Still waiting for Horizon: it is answering slowly, or not at all. The planner retries a failed request three times, about seven seconds in all, before it gives up and this page says what happened.";
const STUCK_MESSAGE =
  "Horizon has not answered for twenty seconds. Reload the page and try again; if it keeps happening, the testnet Horizon or your connection is down.";

function announce(message: string): void {
  status.replaceChildren(document.createTextNode(message));
}

function refreshCommands(): void {
  commands.replaceChildren(renderCommands(readInputs(form)));
}

/**
 * The plan on the page is for the inputs it was made from: once they change it is marked stale,
 * and the mark goes when planning starts again (E5-S1 review, W4).
 */
function markStale(): void {
  if (result.hidden) return;
  result.classList.add("stale");
  staleNote.hidden = false;
}

function clearStale(): void {
  result.classList.remove("stale");
  staleNote.hidden = true;
}

function inputsChanged(): void {
  refreshCommands();
  markStale();
}

let planning = false;

async function plan(): Promise<void> {
  if (planning) return;
  const inputs = readInputs(form);
  if (!inputs.account) {
    status.replaceChildren(
      renderError({
        code: null,
        title: "An account is needed",
        message: "Paste the public address (G...) of the account to plan for.",
        remedy: "Or press “Load the example account”.",
      }),
    );
    byId<HTMLInputElement>("account").focus();
    return;
  }
  planning = true;
  planButton.disabled = true;
  planButton.textContent = "Planning...";
  form.classList.add("planning");
  // The previous plan, if any, goes before the request leaves: it was for other inputs, or it is
  // being replaced.
  result.hidden = true;
  clearStale();
  announce("Asking the testnet Horizon... GET requests only; nothing is signed or submitted.");
  const slow = setTimeout(() => announce(SLOW_MESSAGE), SLOW_AFTER_MS);
  const stuck = setTimeout(() => announce(STUCK_MESSAGE), STUCK_AFTER_MS);
  try {
    const closePlan = await planInBrowser(inputs);
    const view = toView(closePlan, {
      allowPartial: inputs.allowPartial,
      explorerBase: DEFAULT_EXPLORER_BASE,
    });
    resultBody.replaceChildren(renderView(view, closePlan, renderPlan(closePlan)));
    result.hidden = false;
    const n = view.steps.length;
    announce(`Plan ready: ${view.status.word}, ${n} step${n === 1 ? "" : "s"}.`);
    resultHeading.focus();
  } catch (error) {
    status.replaceChildren(renderError(describeError(error)));
  } finally {
    clearTimeout(slow);
    clearTimeout(stuck);
    planning = false;
    planButton.disabled = false;
    planButton.textContent = "Plan";
    form.classList.remove("planning");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void plan();
});
form.addEventListener("input", inputsChanged);

loadExample.addEventListener("click", () => {
  byId<HTMLInputElement>("account").value = EXAMPLE.account;
  byId<HTMLInputElement>("destination").value = EXAMPLE.destination;
  byId<HTMLInputElement>("sponsor").value = EXAMPLE.sponsor;
  inputsChanged();
  announce("Example loaded: the baseline fixture, its destination and its sponsor. Press Plan.");
  planButton.focus();
});

refreshCommands();
