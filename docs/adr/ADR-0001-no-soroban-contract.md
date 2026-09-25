# ADR-0001: No Soroban contract in scope

- Status: Accepted
- Date: 2026-09-25
- Deciders: the builder (system architect role)
- Related: `docs/architecture.md` section 12, ADR-0002, ADR-0003

## Context

The SOW states the work is "classic Stellar work with the JavaScript SDK, with no smart contracts involved" and lists contract accounts (`C...`) as out of scope. Dustin must cancel offers, dispose of balances, remove trustlines and data entries, unwind sponsored reserves and merge a `G...` account, with every transaction fee-bumped by a sponsor.

Everything in that list is a classic operation or a classic envelope feature:

- `manageSellOffer`, `pathPaymentStrictSend`, `payment`, `changeTrust`, `manageData`, `accountMerge` are classic operations with documented thresholds and result codes (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations).
- Fee bumps are a transaction-envelope feature whose `feeSource` is an account and whose fee is paid by that account (CAP-0015, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md).
- Sponsored reserves are classic operations (`beginSponsoringFutureReserves`, `endSponsoringFutureReserves`, `revokeSponsorship`) with account sponsors; removing a sponsored entry unlocks the reserve on the sponsor (CAP-0033, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md).

A Soroban contract cannot be the source account of a classic operation, cannot produce an ed25519 signature for a `G` account, cannot be the `feeSource` of a fee-bump, and cannot hold or merge a classic account. The one contract-adjacent capability that exists, the Stellar Asset Contract, moves classic asset balances between addresses but does not remove trustlines, cancel offers, or merge accounts (https://developers.stellar.org/docs/tokens/anatomy-of-an-asset).

## Decision

Dustin ships no Soroban contract. The repository contains no Rust, no `contracts/` directory and no RPC-based contract invocation. The SDK depends on `@stellar/stellar-sdk` for classic transaction building and on Horizon for reads and submission (ADR-0004).

## Would a contract ever help?

Honestly: not for account closing. Two adjacent ideas were considered and rejected as contracts:

1. **On-chain sponsor treasury.** A contract could hold XLM intended for fee sponsorship, but fee bumps must be signed by an account holding the XLM; the contract would have to transfer XLM to an account first, which is a treasury-management concern, not a closing concern. A hosted sponsor with a plain account (ADR-0002, stretch) covers the same need with less machinery.
2. **Soroban-only liquidity for disposal.** Some assets may be tradable only on Soroban AMMs. Reaching that liquidity means calling existing contracts (an aggregator or a pool) from the disposal ladder, not deploying a contract of our own. It is outside the SOW, which specifies the SDEX path payment as rung 1, and is listed as stretch.

Neither case changes the planner, the fee-bump layer or the merge.

## Consequences

- Smaller surface: no contract build, deploy, upgrade, audit or TTL concerns.
- The 30-day budget is spent entirely on ordering logic, the ladder, sponsorship and tests.
- If a future stretch adds Soroban-based disposal, it enters as a new ladder rung behind a feature flag, with its own ADR.

## Alternatives considered

- **"Account closer" contract that a wallet invokes.** Rejected: it cannot sign for the user's account, so the wallet would still sign every classic transaction; the contract adds a hop and no capability.
- **Contract-held fee treasury.** Rejected as described above.

## Sources

- SOW: `SUCCESSFUL_SOW.md` (Objective, Out of Scope)
- List of operations: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- CAP-0015 Fee-Bump Transactions: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- CAP-0033 Sponsored Reserve: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- Anatomy of an asset (SAC scope): https://developers.stellar.org/docs/tokens/anatomy-of-an-asset
