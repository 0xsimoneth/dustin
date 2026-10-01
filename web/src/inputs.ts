/** What the form asks for. The three addresses are public keys; the page has no field for a secret. */
export interface PlanInputs {
  account: string;
  destination: string;
  sponsor: string;
  /** CLI `--partial`, SDK `allowPartial`: an option of the close, so the plan itself does not change. */
  allowPartial: boolean;
  /** CLI `--prefer-destination`, SDK `preferDestination`: the order of the disposal ladder. */
  preferDestination: boolean;
}

/** Reads the form; addresses are trimmed and otherwise left as typed, the SDK validates them. */
export function readInputs(form: HTMLFormElement): PlanInputs {
  const data = new FormData(form);
  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    account: text("account"),
    destination: text("destination"),
    sponsor: text("sponsor"),
    allowPartial: data.get("partial") === "on",
    preferDestination: data.get("prefer-destination") === "on",
  };
}
