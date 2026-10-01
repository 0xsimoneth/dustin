import type { ClosePlan } from "stellar-dustin";
import { closeCommand, planCommand } from "./commands";
import { h, text } from "./dom";
import type { PlanInputs } from "./inputs";
import type { PlainError } from "./plan";
import { shortAddress, type Link, type PlanView } from "./view";

/** The plan for people: the status in words, the facts, the steps as the CLI orders them. */
export function renderView(view: PlanView, plan: ClosePlan, planText: string): HTMLElement {
  const root = h("div", { class: "plan" });

  root.append(
    h("p", { class: "status-line" }, [
      h("strong", { class: "status-word", "data-status": view.status.word }, [view.status.word]),
      `: ${view.status.sentence}.`,
    ]),
    text("p", view.status.closeNote, "close-note"),
  );

  root.append(facts(view));

  if (view.steps.length > 0) {
    root.append(stepsTable(view));
    const txs = h(
      "ol",
      { class: "transactions" },
      view.transactions.map((t) =>
        h("li", {}, [
          h("strong", {}, [`tx ${t.number}`]),
          ` ${t.phase}, ${t.opCount} op${t.opCount === 1 ? "" : "s"}, bid ${t.bid}. `,
          t.reason,
        ]),
      ),
    );
    root.append(
      h("h3", {}, [
        `Transactions (${view.transactions.length}, each fee-bumped by the sponsor; inner fee 0)`,
      ]),
      txs,
    );
  }

  if (view.unclosable.length > 0) {
    root.append(
      h("h3", {}, ["Cannot be disposed of (the account is not merged while these remain)"]),
      h(
        "ul",
        { class: "items" },
        view.unclosable.map((u) =>
          h("li", {}, [
            h("p", {}, [h("code", {}, [u.code]), ` ${u.subject}`]),
            text("p", u.reason),
            u.rungs.length > 0
              ? h(
                  "ul",
                  {},
                  u.rungs.map((r) => h("li", {}, [`${r.rung}: ${r.reason}`])),
                )
              : null,
            h("p", {}, [h("strong", {}, ["Remedy: "]), u.remedy]),
          ]),
        ),
      ),
    );
  }

  if (view.blockers.length > 0) {
    root.append(
      h("h3", {}, ["Blockers (the merge is not possible while these hold)"]),
      h(
        "ul",
        { class: "items" },
        view.blockers.map((b) =>
          h("li", {}, [
            h("p", {}, [h("code", {}, [b.code]), b.permanent ? " (permanent)" : ""]),
            text("p", b.reason),
            h("p", {}, [h("strong", {}, ["Remedy: "]), b.remedy]),
          ]),
        ),
      ),
    );
  }

  if (view.warnings.length > 0) {
    root.append(
      h("h3", {}, ["Warnings"]),
      h(
        "ul",
        { class: "items" },
        view.warnings.map((w) => text("li", w)),
      ),
    );
  }

  root.append(h("h3", {}, ["Look it up on the testnet explorer"]), linkList(view.links));

  root.append(
    h("details", {}, [
      h("summary", {}, ["Plan JSON"]),
      h("pre", { class: "json", tabindex: "0" }, [JSON.stringify(plan, null, 2)]),
    ]),
    h("details", {}, [
      h("summary", {}, ["As the CLI prints it"]),
      h("pre", { class: "cli", tabindex: "0" }, [planText]),
    ]),
  );
  return root;
}

function facts(view: PlanView): HTMLElement {
  const dl = h("dl", { class: "facts" });
  const row = (term: string, ...detail: Array<Node | string>) =>
    dl.append(h("dt", {}, [term]), h("dd", {}, detail));
  row("Network", `testnet, ledger ${view.observed.ledger}, observed ${view.observed.closedAt}`);
  row("Account", h("code", {}, [view.account]));
  row(
    "Destination",
    view.destination
      ? h("code", {}, [view.destination])
      : "none given: the account is inspected, but a plan without a destination cannot merge",
  );
  row(
    "Fee sponsor",
    view.sponsor
      ? h("code", {}, [view.sponsor])
      : "not given: the fees are estimated and the payer is named fee_sponsor",
  );
  row(
    "Balance",
    view.balance
      ? `${view.balance.balance} XLM, minimum balance ${view.balance.minimum} XLM, spendable ${view.balance.spendable} XLM (base reserve ${view.balance.baseReserve})`
      : "not known: the account does not exist on the ledger (Horizon answered 404)",
  );
  if (view.recovery) {
    const r = view.recovery;
    const where = view.destination ? shortAddress(view.destination) : "the destination";
    // Only a closable plan merges; for any other the row says so instead of "0 XLM arrives" (W5).
    row(
      "Recovered",
      r.merges
        ? `${r.toDestination} arrives at ${where} (${r.detail}); the account pays 0.0000000 XLM in fees`
        : `${r.detail}, so the XLM stays in the account; the account pays 0.0000000 XLM in fees`,
    );
    row(
      "Reserves released to sponsors",
      r.sponsors.length === 0
        ? "none"
        : h(
            "ul",
            {},
            r.sponsors.map((s) =>
              h("li", {}, [
                `${s.xlm} reserve unlocked for sponsor ${shortAddress(s.sponsor)} (${s.entries.join(", ")}), never this account's`,
              ]),
            ),
          ),
    );
  } else {
    row("Recovered", "nothing: the account does not exist, so no XLM moves and no fee is paid");
  }
  if (view.fees) {
    const f = view.fees;
    row(
      "Fees",
      `bid up to ${f.bid} (${f.perOperation}), paid by the sponsor ${f.payer === "fee_sponsor" ? "" : shortAddress(f.payer)}`.trimEnd() +
        "; the account pays 0",
    );
    row(
      "Budget",
      f.withinBudget
        ? `${f.budget} per close for the sponsor; the bid above is within it`
        : `${f.budget} per close for the sponsor; the bid above EXCEEDS it: wait for network fees to fall or lower the bid (--base-fee)`,
    );
  } else {
    row("Fees", "none: the plan has no transaction to submit");
  }
  if (view.sequenceGuard) row("Sequence guard", view.sequenceGuard);
  row("Plan hash", h("code", {}, [view.planHash]));
  return dl;
}

function stepsTable(view: PlanView): HTMLElement {
  return h("table", { class: "steps" }, [
    h("caption", {}, [`Steps, in execution order (${view.steps.length})`]),
    h("thead", {}, [
      h("tr", {}, [
        h("th", { scope: "col" }, ["Step"]),
        h("th", { scope: "col" }, ["Tx"]),
        h("th", { scope: "col" }, ["Action"]),
        h("th", { scope: "col" }, ["Why"]),
      ]),
    ]),
    h(
      "tbody",
      {},
      view.steps.map((s) =>
        // data-label: at phone width the CSS stacks the cells and prints the column's name first.
        h("tr", {}, [
          h("th", { scope: "row" }, [s.id]),
          h("td", { "data-label": "Tx" }, [String(s.tx)]),
          h("td", { "data-label": "Action" }, [s.action]),
          h("td", { "data-label": "Why" }, [s.why]),
        ]),
      ),
    ),
  ]);
}

/**
 * Every address as text; a link only where the view found a G... or M... address with a valid
 * checksum, and for a muxed address the link opens the base account it wraps (W3).
 */
function linkList(links: Link[]): HTMLElement {
  const anchor = (url: string, address: string) =>
    h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, [h("code", {}, [address])]);
  return h(
    "ul",
    { class: "links" },
    links.map((l) =>
      h("li", {}, [
        `${l.label}: `,
        ...(l.url === null || l.target === null
          ? [h("code", {}, [l.address])]
          : l.target === l.address
            ? [anchor(l.url, l.address)]
            : [
                h("code", {}, [l.address]),
                " (muxed; its base account ",
                anchor(l.url, l.target),
                ")",
              ]),
      ]),
    ),
  );
}

export function renderError(error: PlainError): HTMLElement {
  return h("div", { class: "error", role: "alert" }, [
    h("p", {}, [h("strong", {}, [error.title]), error.code ? ` (${error.code})` : ""]),
    text("p", error.message),
    error.remedy ? h("p", {}, [h("strong", {}, ["What to do: "]), error.remedy]) : null,
  ]);
}

/** The "Run it yourself" box: the plan command and the close command, each with a copy button. */
export function renderCommands(inputs: PlanInputs): HTMLElement {
  const box = h("div", { class: "commands" });
  box.append(
    command(
      "Plan from the CLI (read-only, no secret)",
      planCommand(inputs),
      "copy-plan",
      "Copy the plan command",
    ),
    command(
      "Close from the CLI (after the plan, with the typed confirmation)",
      closeCommand(inputs),
      "copy-close",
      "Copy the close command",
    ),
  );
  return box;
}

function command(title: string, commandText: string, id: string, label: string): HTMLElement {
  const note = h("span", { class: "copied", "aria-live": "polite" });
  // Both buttons read "Copy"; the accessible name says which command (W5).
  const button = h("button", { type: "button", id, "aria-label": label }, ["Copy"]);
  button.addEventListener("click", () => void copyText(commandText, note));
  return h("div", { class: "command" }, [
    h("h3", {}, [title]),
    h("pre", { tabindex: "0" }, [h("code", {}, [commandText])]),
    h("div", { class: "copy-row" }, [button, note]),
  ]);
}

/**
 * The timer that clears a note, one per note: a second press within the four seconds restarts it,
 * where before the first timer cleared the second note early (W5).
 */
const clearers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

async function copyText(value: string, note: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    note.textContent = "Copied.";
  } catch {
    note.textContent = "Copying is not available here; select the text and copy it.";
  }
  const previous = clearers.get(note);
  if (previous !== undefined) clearTimeout(previous);
  clearers.set(
    note,
    setTimeout(() => {
      note.textContent = "";
      clearers.delete(note);
    }, 4000),
  );
}
