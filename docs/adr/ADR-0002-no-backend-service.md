# ADR-0002: No backend service in scope; sponsor key from the environment

- Status: Accepted
- Date: 2026-09-25
- Deciders: the builder (system architect role)
- Related: `docs/architecture.md` sections 4.6, 4.7, 11, 12; ADR-0003

## Context

Two things usually push a tool like this toward a server: someone has to pay fees for an account that cannot, and someone has to keep the key that pays. The SOW settles both for this scope: "Production key management. The sponsor uses an env key for this scope" and "Wallet UI. A CLI demo is the interface". The SOW also criticises the existing tool for a server-side co-signing step that cannot be inspected.

The other reason for a server, state, does not apply: the ledger is the state of record. `planClose()` derives the plan from chain state and the executor re-plans from chain state after any failure, so no database is needed for resume (architecture section 4.7).

## Decision

1. Dustin is a library plus CLI. No HTTP service, no database, no queue.
2. The sponsor is an `EnvSponsor` implementing the `FeeBumpSigner` interface: it reads `DUSTIN_SPONSOR_SECRET` once at startup, keeps the `Keypair` in memory, signs fee-bump envelopes only, never serialises the key, and refuses to sign an inner transaction hash the executor did not build in the current run.
3. The closing account's key comes from `DUSTIN_ACCOUNT_SECRET` or stdin, never from argv.
4. An optional local journal file (hashes and XDR of submitted transactions) exists for evidence and faster resume; deleting it loses nothing. As built, the report copies published through `onReport` and the CLI's `--report` file play that part, and there is no resume option: running the close again is the resume (PRD decision D-2).
5. The sponsor budget per close (`sponsorBudgetStroops`, default 5 XLM) and the per-operation fee cap (`maxBaseFeeStroops`, default 0.1 XLM) are enforced in the library, so the same limits will apply unchanged if a service later wraps it.

## Consequences

- The reviewer can run everything from a clone with two environment variables and a Friendbot-funded sponsor (10,000 XLM per funding, https://developers.stellar.org/docs/networks).
- The sponsor key's blast radius is the fee budget: the sponsor never signs an inner transaction and is never an operation source (ADR-0003).
- Wallet integrators can already use the split: the wallet signs inner transactions with the user's key, and the integrator's own process wraps them with its sponsor key through the same `FeeBumpSigner` interface.

## Stretch (outside SOW): hosted sponsor / fee-bump relay

If Dustin is later offered as a service, the service is a fee-bump relay and nothing more: it receives a signed inner transaction, validates it, wraps it with the relay's sponsor key and submits it. Abuse controls it must have before it exists on any network with value:

- **Content validation before signing.** Parse the inner transaction; accept only the operation types Dustin emits (`manageSellOffer` with amount 0, `pathPaymentStrictSend` to self, `payment` to an issuer or to the declared destination, `changeTrust` with limit 0, `manageData` with null value, `accountMerge`); every operation source must equal the inner source; the merge destination must not be the relay's sponsor; no operation may reference the sponsor at all.
- **Plan binding.** The relay recomputes `planClose()` from chain state and accepts the inner transaction only if it matches a transaction of that plan (same operations in the same order), so the relay cannot be used to pay for arbitrary traffic.
- **Fee policy and budgets.** Per-account lifetime budget, per-IP and global daily budgets, `maxBaseFee` cap, and refusal during extreme surge (Horizon `fee_stats` p90 above a threshold).
- **Replay and rate limiting.** One outstanding fee bump per inner sequence number; reject a second wrap of the same inner hash while the first is within its time bounds (replace-by-fee needs 10x and is never done by the relay, https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions).
- **Authentication.** SEP-10 challenge signed by the closing account (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) proves the requester controls the account being closed; the relay refuses to sponsor accounts it has not authenticated.
- **Key management.** Sponsor key in a KMS or HSM with signing quotas; hot balance kept small and topped up; alerting on budget consumption.
- **Observability.** Every wrapped inner hash, outer hash, fee and outcome logged with secrets redacted; a public status page for the relay's balance and limits.

None of this is needed for the SOW, and none of it changes the planner.

## Alternatives considered

- **Small hosted API from day one** (like the existing tool's co-signing endpoint). Rejected: hosting, secrets, uptime and abuse controls would consume the budget of D2 and D3 and would reintroduce the opacity the SOW criticises.
- **Sponsor key in a file.** Rejected in favour of environment variables and stdin, which do not risk being committed and do not appear in process listings.

## Sources

- SOW: `SUCCESSFUL_SOW.md` (Out of Scope; Deliverable 2)
- Networks (Friendbot funding, testnet availability): https://developers.stellar.org/docs/networks
- Fee-bump transactions guide (replace-by-fee rule): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- SEP-0010 Web Authentication: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
- Demolisher view with server approval endpoint (the co-signing step): https://github.com/stellar-expert/stellar-expert-explorer/blob/master/views/demolisher/account-demolisher-view.js
