// The types of scripts/evidence-check.mjs as the offline tests use them (the script is plain
// JavaScript, outside the TypeScript project's modules).

export interface Link {
  target: string;
  line: number;
}
export type Classified =
  | { kind: "anchor"; fragment: string }
  | { kind: "mailto" }
  | { kind: "relative"; path: string; fromRoot: boolean; fragment: string | null }
  | { kind: "invalid"; reason: string }
  | { kind: "tx"; hash: string; via: "horizon" | "stellar.expert" }
  | { kind: "hash"; hash: string }
  | { kind: "account"; account: string; via: "horizon" | "stellar.expert" }
  | { kind: "https"; url: string }
  | { kind: "refused"; reason: string };
export type Verdict = "ok" | "gone" | "skipped" | "failed" | "unchecked";
export interface Checked {
  file: string;
  line: number;
  target: string;
  verdict: Verdict;
  detail: string;
  source?: "link" | "hash";
}
export interface Answer {
  status: number | null;
  tries?: number;
  error?: string;
  retryAfterMs?: number;
  tooManyRedirects?: boolean;
  server?: string;
  refusedRedirect?: { location: string; reason: string };
  body?: unknown;
}
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface MainDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  env?: Record<string, string | undefined>;
  cwd?: string;
  git?: { root: string; files: Set<string> } | null;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}
export interface EvidenceCheck {
  TESTNET_HORIZON: string;
  EXIT: { OK: 0; FAILED: 1; USAGE: 2; UNCHECKED: 3 };
  USAGE: string;
  RETRY_AFTER_MAX_MS: number;
  extractLinks(markdown: string): Link[];
  extractHashes(markdown: string): Array<{ hash: string; line: number }>;
  blankCodeBlocks(markdown: string): string;
  githubSlug(text: string): string;
  headingAnchors(markdown: string): Set<string>;
  classifyLink(target: string): Classified;
  refusalOf(url: URL): string | null;
  parseRetryAfter(value: string | null, now?: number): number | null;
  judgeResponse(c: Classified, answer: Answer): { verdict: Verdict | "history"; detail: string };
  judgeAccountHistory(account: string, answer: Answer): { verdict: Verdict; detail: string };
  judgeRelative(
    path: string,
    context: { git: { root: string; files: Set<string> } | null; root: string },
  ): { verdict: Verdict; detail: string };
  get(
    url: string,
    net: { fetch: FetchLike; sleep?: (ms: number) => Promise<unknown>; now?: () => number },
    wantBody?: boolean,
  ): Promise<Answer>;
  defaultFiles(root: string): string[];
  gitCheckout(cwd: string): { root: string; files: Set<string> } | null;
  horizonFromEnv(env: Record<string, string | undefined>): string;
  assertTestnetHorizon(url: string): void;
  render(results: Checked[], notes?: string[]): string;
  exitCodeOf(results: Checked[]): number;
  main(argv: string[], deps?: MainDeps): Promise<number>;
}

/** Loads the script; a variable path keeps TypeScript from resolving its plain JavaScript. */
export async function loadEvidenceCheck(): Promise<EvidenceCheck> {
  const path = "../../../scripts/evidence-check.mjs";
  return (await import(path)) as EvidenceCheck;
}
