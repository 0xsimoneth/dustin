# ADR-0004: Horizon for classic reads and submission; Stellar RPC optional

- Status: Accepted
- Date: 2026-09-25
- Deciders: the builder (system architect role)
- Related: `docs/architecture.md` sections 4.2, 4.7, 9

## Context

Dustin needs, for one account: every trustline with balances, liabilities, authorisation and clawback flags and sponsor; every open offer; every data entry; thresholds, signers and flags; the destination's existence, trustlines and SEP-29 marker; issuer flags; a strict-send path quote to XLM for every non-native balance; fee statistics; a transaction submit with a result; and lookups by transaction hash.

Capabilities on the public testnet endpoints (verified 2026-09-25):

| Need | Horizon (`https://horizon-testnet.stellar.org`) | Stellar RPC (`https://soroban-testnet.stellar.org`) |
|---|---|---|
| Enumerate an account's trustlines, data, signers, flags, thresholds, sponsorship counters | `GET /accounts/{id}` returns all of it, including per-balance `sponsor`, `is_authorized`, `is_authorized_to_maintain_liabilities`, `is_clawback_enabled`, `liquidity_pool_id` (https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object, https://github.com/stellar/go/blob/master/protocols/horizon/main.go) | `getLedgerEntries` returns the Account entry (flags, thresholds, signers, seq, counters) but trustlines and data must be requested by exact `LedgerKey`, which requires knowing the asset or data name in advance; "keys must be known in advance", no enumeration (https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries) |
| Enumerate offers | `GET /accounts/{id}/offers` (observed 200) | Offer entries need `offerID`; no listing |
| Path finding | `GET /paths/strict-send` (https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths) | none |
| Fee statistics | `GET /fee_stats` (surge percentiles) | `getFeeStats` exists for inclusion fees (not used; Horizon's is sufficient, and mixing two sources for one number adds nothing) |
| Submit with SEP-29 check | `Horizon.Server.submitTransaction` checks memo-required destinations, unwrapping fee bumps (https://github.com/stellar/js-stellar-sdk/blob/main/src/horizon/server.ts) | `sendTransaction` submits raw XDR; no SEP-29 check |
| Failure detail | `extras.result_codes.transaction / inner_transaction / operations` | result XDR only |
| Async submit | `POST /transactions_async` (`PENDING`, `DUPLICATE`, `TRY_AGAIN_LATER`, `ERROR`) | `sendTransaction` (`PENDING`, `DUPLICATE`, `TRY_AGAIN_LATER`, `ERROR`) |
| Rate limits | Per-IP `PER_HOUR_RATE_LIMIT`, default 3600/hour, HTTP 429 (https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting); the SDF instance's configured value is unverified | Not published on the pages consulted; unverified |
| Availability | SDF does not guarantee testnet availability (https://developers.stellar.org/docs/networks) | Same |
| Entry-level sponsorship of data entries | Not exposed on the account resource | `LedgerEntry.ext.v1.sponsoringID` per entry (https://github.com/stellar/stellar-xdr/blob/curr/Stellar-ledger-entries.x) |

The ecosystem guidance "prefer RPC for new projects" targets smart-contract workloads; it does not remove the enumeration and path-finding gaps for classic account teardown.

## Decision

1. Horizon is the only required data source and the only submission path. `LedgerReader` is implemented by `HorizonReader`; `Executor` submits through `Horizon.Server.submitTransaction` with the SEP-29 check enabled.
2. Stellar RPC is not a dependency of the SOW build. An `RpcSponsorshipReader` that resolves per-data-entry sponsors through `getLedgerEntries` is **stretch (outside SOW)**; until then the inspector infers data-entry sponsorship from `num_sponsored` arithmetic and labels the attribution as inferred.
3. Request discipline: at most 12 requests for a plan and under 100 for a close including re-plans; exponential backoff on 429 (1 s, 2 s, 4 s, 8 s, 16 s, then fail); a single `Horizon.Server` instance per run; no streaming.
4. The Horizon URL is configurable (`DUSTIN_HORIZON_URL`) for a self-hosted testnet Horizon, but the passphrase check in `assertTestnet()` still applies.

## Consequences

- One HTTP client, one error-mapping table, one set of recorded fixtures for offline tests.
- If the public Horizon is down, Dustin is down; the SOW accepts testnet best-effort availability and the CLI prints a clear `HORIZON_UNAVAILABLE` error with a retry hint.
- A later migration of reads to RPC would touch `HorizonReader` only, because the planner consumes `AccountSnapshot`, never Horizon shapes.

## Alternatives considered

- **RPC-only.** Rejected: cannot enumerate trustlines, offers or data; no path finding.
- **Horizon plus RPC from day one.** Rejected for the SOW: the only gain is per-entry sponsorship attribution for data entries, which affects a report line, not correctness.
- **Third-party indexer APIs.** Rejected: extra dependency, no capability Horizon lacks for this task.

## Sources

- Horizon account resource: https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object
- Horizon protocol structs: https://github.com/stellar/go/blob/master/protocols/horizon/main.go
- Horizon strict-send paths: https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths
- Horizon rate limiting: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- Horizon async submit: https://developers.stellar.org/docs/data/apis/horizon/api-reference/submit-async-transaction
- JS SDK Horizon server (SEP-29 check): https://github.com/stellar/js-stellar-sdk/blob/main/src/horizon/server.ts
- RPC `getLedgerEntries`: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries
- Stellar XDR ledger entries: https://github.com/stellar/stellar-xdr/blob/curr/Stellar-ledger-entries.x
- Networks: https://developers.stellar.org/docs/networks
