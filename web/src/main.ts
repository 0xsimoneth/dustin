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
const commands = byId<HTMLDivElement>("commands");
const planButton = byId<HTMLButtonElement>("plan-button");
const loadExample = byId<HTMLButtonElement>("load-example");

function announce(message: string): void {
  status.replaceChildren(document.createTextNode(message));
}

function refreshCommands(): void {
  commands.replaceChildren(renderCommands(readInputs(form)));
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
  result.hidden = true;
  announce("Asking the testnet Horizon... GET requests only; nothing is signed or submitted.");
  try {
    const closePlan = await planInBrowser(inputs);
    const view = toView(closePlan, {
      allowPartial: inputs.allowPartial,
      explorerBase: DEFAULT_EXPLORER_BASE,
    });
    resultBody.replaceChildren(renderView(view, closePlan, renderPlan(closePlan)));
    result.hidden = false;
    announce(`Plan ready: ${view.status.word}, ${view.steps.length} steps.`);
    resultHeading.focus();
  } catch (error) {
    status.replaceChildren(renderError(describeError(error)));
  } finally {
    planning = false;
    planButton.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void plan();
});
form.addEventListener("input", refreshCommands);

loadExample.addEventListener("click", () => {
  byId<HTMLInputElement>("account").value = EXAMPLE.account;
  byId<HTMLInputElement>("destination").value = EXAMPLE.destination;
  byId<HTMLInputElement>("sponsor").value = EXAMPLE.sponsor;
  refreshCommands();
  announce("Example loaded: the baseline fixture, its destination and its sponsor. Press Plan.");
  planButton.focus();
});

refreshCommands();
