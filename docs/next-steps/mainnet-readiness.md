# Dustin — Mainnet Readiness Gate (Post-Instaward, Outside the Current SOW)

> **Scope notice.** The accepted Instaward SOW (`SUCCESSFUL_SOW.md`, section 4.1) lists mainnet as explicitly out of scope: "Testnet only, no real value." Nothing in this document is Instaward work. It is the gate that must close before Dustin touches a mainnet account, applied to Dustin from the `deploy-stellar-mainnet` skill's three gates (pre-deployment verification, deployment mechanics, post-deployment). Produced on 2026-09-25.

Dustin has no Soroban contract. Where the skill's checklist item is contract-specific, the classic-tool equivalent is stated and the original item is marked N/A. Every item has a status column: `Instaward` (already covered by the delivered scope, pending the completion report), `Follow-on` (proposed follow-on Instaward in `scf-path.md` section 3.3), `Build Award Dn` (deliverable in `scf-path.md` section 6.3), or `Open` (not planned anywhere yet).

## 1. What changes on mainnet

- Real value. Recovered reserves, leftover balances and sponsor fees are real XLM and real assets. A wrong destination is a permanent loss.
- Irreversibility. `AccountMerge` deletes the account; there is no undo, no support ticket, no testnet reset.
- No friendbot. The sponsor must be funded, custodied and refilled by the integrator; its balance is an attack target.
- Fee market. Inclusion fees can surge; a fee-bump with an uncapped maximum can spend far more than the reserves it recovers.
- Adversaries. A public or weakly-scoped sponsor can be farmed: anyone can create accounts with subentries and ask the sponsor to pay for their closure ("sponsor griefing").
- Counterparties. Exchange deposit addresses require memos (SEP-29) and generally do not credit `AccountMerge`; issuers may have clawback or authorization flags; destinations may be contract accounts.

## 2. What must change before any mainnet use (summary)

| Area | Instaward state | Required before mainnet | Where planned |
|---|---|---|---|
| Sponsor key custody | Environment variable on the builder's machine (SOW: "The sponsor uses an env key for this scope") | Hardware-backed or HSM/KMS signer on an isolated host; hot sponsor with a capped balance; cold top-up account; rotation and revocation procedure; never in CI secrets | Build Award D8; design paperwork in Follow-on D |
| Spend caps | None | Per-fee-bump maximum fee; per-close budget; per-day and per-integrator budgets; refusal when the cap is hit; alert before the cap | Follow-on B (library), Build Award D2 and D8 (service, server-side) |
| Abuse controls | None (testnet, single operator) | Proof-of-control (closing account signs the inner transaction; sponsor only wraps); allowlists or integrator-scoped API keys; rate limits; one close per account; audit log; kill switch | Follow-on B; Build Award D2, D7, D8 |
| Memo-required destinations | Not checked | SEP-29 `config.memo_required` check on the destination; refuse merges to memo-required or known custodial addresses with a reason; no mediator account | Build Award D1 |
| Irreversible-merge confirmations | Dry run by default; CLI executes on request | Plan-hash pinning (execute only the previewed plan); re-plan and diff immediately before the merge; explicit typed confirmation naming the account and destination; time-bounded transactions; final report of what moved where | Build Award D1 |
| Monitoring | None | Sponsor balance and spend, submission failures by result code, refusals by reason, latency, RPC/Horizon health; alerting; dashboard; incident runbook | Build Award D8, D10 |
| Network selection | Testnet hard-wired | Explicit network switch with the mainnet passphrase verified at startup; refuse mixed configuration | Build Award D1 |
| Destination and asset policy | Destination chosen by the user; disposal ladder on testnet liquidity | Slippage bounds and minimum-received checks on path payments; refuse value-destroying sells; clawback and authorization flags surfaced before signing; contract-account destinations refused | Build Award D1, D6 |
| Review | Self-tested | Peer review by someone outside the team; written risk acceptance for anything skipped | Build Award D8 |

## 3. Gate 1 — Pre-deployment verification

### 3.1 Correctness (skill: "contract correctness", adapted)

| Item | Dustin equivalent | Status | How to verify |
|---|---|---|---|
| All contract tests pass on a deployed testnet copy | Full test matrix passes against the live testnet fixture, not only against recorded fixtures | Instaward | CI run link on the tagged commit |
| At least one end-to-end integration test (deploy → invoke → assert) | Fixture build → `planClose` → `executeClose` → assert account not found, sponsor paid all fees, destination balance increased by the expected amount | Instaward | Test name and transaction chain in the evidence package |
| Storage usage profiled, TTL wired | N/A (no contract state). Equivalent: plan determinism — the same account state produces the same plan hash | Build Award D1 | Property test: plan twice, compare hashes |
| Authorization paths reviewed | Signer set and thresholds inspected before planning; raised thresholds refused or handed off; `AUTH_IMMUTABLE` refused; accounts that sponsor other entries refused unless the plan unwinds them first | Instaward (detect/report), Build Award D5 (hand-off) | Matrix cases |
| CPI / reentrancy safety | N/A. Equivalent: mid-flow state changes (a new offer or trustline appears between plan and execute) are detected and stop execution | Build Award D1 | Adversarial test: mutate the account between steps |
| Sequence handling | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard; sequence bumped or plan refused; fee-bump inner sequence matches | Instaward | Matrix case |
| Operation limits | Plans above 100 operations split across transactions in dependency order | Open (verify whether the Instaward planner already splits) | Fixture with more than 100 subentries |
| Partial-failure recovery | Resume from the last confirmed step; never re-submit a merge that may have succeeded | Instaward (retry), Build Award D1 (resume semantics) | Kill the process mid-run; re-run; assert single merge |

### 3.2 Security (skill: "security", adapted)

| Item | Dustin equivalent | Status | How to verify |
|---|---|---|---|
| No `unwrap()` on user-controlled paths | No unhandled promise rejections; every Horizon/RPC field parsed defensively; unknown asset types, flags and result codes produce a typed refusal rather than a crash | Build Award D1 | Fuzz the account JSON |
| No panics on malformed input | Same as above, plus malformed destination strings (invalid checksum, muxed M-address, C-address, federation address) rejected before any signing | Build Award D1, D6 | Unit tests |
| Integer overflow handled | All amounts in stroops as `BigInt` or the SDK's fixed-point helpers; no floating point in amount math; fee arithmetic bounded by the cap | Open (audit the Instaward code) | Unit tests with 7-decimal edge values |
| Admin operations gated by role checks | Sponsor service: integrator-scoped API keys; kill switch and cap changes require a separate admin credential; audit log for every policy change | Build Award D8 | Access-control tests |
| SAC used correctly if accepting assets | N/A. Equivalent: issuer flags (`AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`) read and surfaced before disposal; clawback-enabled balances flagged | Instaward (matrix), Build Award D1 (surface before signing) | Matrix cases |
| Secrets handling | Secret keys never logged, never in plan files, never in error messages; environment-variable key only on testnet; mainnet key only via the custody path | Build Award D8 | Grep tests on logs; code review |
| Supply chain | Lockfile committed; dependencies pinned; npm publish with provenance; release signed and tagged | Follow-on D | Package page shows provenance |

### 3.3 Sponsor economics and abuse controls (Dustin-specific; no skill equivalent)

| Item | Requirement | Status |
|---|---|---|
| Fee cap per fee-bump | Maximum fee bounded to a stated multiple of the base fee; no automatic escalation beyond it; surge pricing handled by waiting or refusing, never by raising the cap | Follow-on B |
| Per-close budget | Total sponsor spend per close bounded (fees across all transactions in the plan); plan refused if the estimate exceeds it | Follow-on B |
| Per-day and per-integrator budgets | Server-side in the hosted service; alert at 80 percent; hard stop at 100 percent | Build Award D8 |
| Proof-of-control | The closing account signs every inner transaction; the sponsor never signs an inner transaction and never holds the closing account's key; the sponsor cannot redirect funds because the destination is inside the inner transaction the user signed | Follow-on B |
| Allowlist / API keys | Sponsor wraps only for accounts the integrator asserts custody of, or only for holders of an integrator-scoped API key; no public endpoint | Follow-on B, Build Award D2 |
| Rate limits | Per key and per account; one close per account lifetime (the account disappears anyway) | Build Award D2 |
| Sponsor griefing model | Written threat model covering attacker-created accounts, dust trustlines, offer spam, and repeated failed submissions that still consume fees | Follow-on D |
| Kill switch | One command stops all wrapping; documented owner | Follow-on B |
| Audit log | Every wrap request, refusal and submission logged with plan hash and result code; no personal data | Follow-on B |

### 3.4 Destination safety and irreversible-merge confirmations

| Item | Requirement | Status |
|---|---|---|
| SEP-29 memo-required | Read the destination's `config.memo_required` data entry; refuse the merge with a reason if set (a merge cannot satisfy a per-payment memo convention in a way an exchange will credit) | Build Award D1 |
| Custodial destinations | Maintain a refusal list of known exchange and custodial deposit patterns; recommend a user-controlled destination; no mediator account (the two funded SCF #44 tools use mediators; Dustin deliberately does not) | Build Award D1 |
| Destination validity | Destination exists, is a G address, is not the account being closed, and holds trustlines for any asset the plan transfers to it | Instaward (partial: destination trustline check in the disposal ladder), Build Award D1 |
| Muxed and contract destinations | M-addresses and C-addresses refused with a reason until explicitly supported | Build Award D6 |
| Plan-hash pinning | `executeClose` accepts only the plan hash it was shown; re-plans immediately before the merge and aborts on any difference | Build Award D1 |
| Typed confirmation | CLI requires the operator to type the closing account's public key prefix and the destination prefix; a flag such as `--i-understand-merge-is-irreversible` is required on mainnet | Build Award D1 |
| Time bounds | Every transaction carries a short validity window so a stale signed envelope cannot be replayed later | Build Award D1 |
| Final report | After the merge: what was sold, returned, transferred, reported unclosable, how much XLM reached the destination, how much the sponsor spent | Instaward (evidence package), Build Award D9 (human-readable) |

### 3.5 Review and audit

| Item | Requirement | Status |
|---|---|---|
| Informal peer review | At least one engineer outside the team reads the planner, the disposal ladder and the sponsor policy; findings tracked in the repository | Build Award D8 |
| Third-party audit | Not required by the skill's threshold (no contract, no TVL); the hosted sponsor service holds a capped hot balance only. If an integrator custodies large sponsor balances, request a review of the service before that integrator goes live | Open |
| Risk acceptance | Written statement of what is not reviewed and why, signed off by the builder and the first integrator | Build Award D8 |

### 3.6 Operational

| Item | Requirement | Status |
|---|---|---|
| Sponsor key custody | Who holds it, where it lives (hardware-backed signer or HSM/KMS on an isolated host), who can rotate it; never in CI secrets; separate sponsor per integrator; hot balance cap and cold top-up | Build Award D8 |
| Upgrade path | N/A for contracts. Equivalent: semantic versioning of the npm package; deprecation policy; the hosted service pins the SDK version it runs | Build Award D8 |
| Emergency pause | Kill switch (3.3) owned by the builder and the integrator; tested monthly | Build Award D8 |
| Deploy SOPs | One page: who can release, network configuration, sponsor public keys, where the deployment log lives, incident contacts | Follow-on D |

## 4. Gate 2 — Deployment mechanics (adapted: no contract to upload)

The skill's `stellar contract upload/deploy/invoke` sequence does not apply. The Dustin equivalent:

1. **Network configuration is explicit and verified at startup.**
   - Mainnet passphrase: `Public Global Stellar Network ; September 2015`
   - Testnet passphrase: `Test SDF Network ; September 2015`
   - Both contain "September 2015"; the tool must compare the full string, never a substring, and must refuse to run when the configured passphrase, the Horizon/RPC endpoint and the CLI `--network` flag disagree.
   - Mainnet Horizon: `https://horizon.stellar.org`. Mainnet RPC: choose a provider from the RPC providers directory (SDF does not run a public mainnet RPC). Testnet: `https://horizon-testnet.stellar.org` and `https://soroban-testnet.stellar.org`.
2. **Fund and configure the sponsor.** Create the hot sponsor account from the cold account; set a low balance; document both public keys; if the sponsor account itself uses multisig or a separate signer, record thresholds.
3. **Release.** Tag the commit; publish the npm package with provenance; record the version.
4. **Canary closes.** Close two of the builder's own deliberately messy mainnet accounts funded with a few XLM: one simple (no leftover balances), one with a dust trustline. Record every hash.
5. **Smoke test the sponsor policy on mainnet.** Attempt a close that exceeds the fee cap and one for an unallowlisted account; both must be refused and logged.
6. **Deployment log.** Commit `deployment-log.md` with date, package version, commit SHA, network, sponsor public key fingerprint, canary transaction hashes and explorer links, and who performed the release.
7. **Explorer check.** Open the canary accounts on a public explorer and confirm they no longer exist and that the destination received the expected XLM.

## 5. Gate 3 — Post-deployment

### 5.1 Monitoring

- Metrics: sponsor balance; fee spend per hour and per integrator; closes started, completed, refused (by reason), failed (by Horizon/RPC result code such as `tx_insufficient_fee`, `tx_bad_seq`, `op_low_reserve`); path-payment slippage; SEP-29 refusals; RPC/Horizon error rates and latency.
- Alerting: sponsor balance below refill threshold; spend cap at 80 percent; any submission failure streak; any admin policy change; kill switch activation.
- Dashboard: a simple public page is enough (the skill accepts a Streamlit or Notion page); it doubles as Build Award D10 traction evidence.
- Retention: no personal data; account public keys and hashes are public chain data; keep integrator identifiers pseudonymous.

### 5.2 Ecosystem distribution

- Announce with the package name, version and the canary explorer links.
- Submit the project to lumenloop.com and open a pull request to the `stellar-ecosystem-db` repository (both funded SCF #44 tools are already listed; Dustin should be listed as developer tooling with the sponsor-side positioning).
- Offer the planner and test matrix upstream to the funded projects (composability, see `scf-path.md` section 8).

### 5.3 Funding and grants

- After a Build Award: route tranche reports through the `scf-tranche-reporter` format (the Instaward template in `docs/next-steps/instaward-completion-report-template.md` already follows it).
- Before a Build Award: `scf-round-watcher` for round status (SCF #46 open until November 8, 2026, as of 2026-09-25), then `scf-submission-drafter`; both already run in `scf-path.md`.

## 6. Go / no-go rule

Dustin may not be pointed at a mainnet account, by the builder or by any integrator, until every row in sections 2 and 3 with status `Open`, `Follow-on` or `Build Award Dn` is either closed with evidence or explicitly accepted in the written risk statement (3.5). The skill's constraint applies: no Gate 1 item may be skipped, and a tool that holds or moves user funds is not released without peer-review evidence.

## Assumptions

- Dustin remains a classic-only JavaScript/TypeScript SDK and CLI with an optional hosted sponsor service; no Soroban contract is planned, so the skill's contract-specific items are mapped to classic equivalents and marked N/A where no equivalent exists.
- The Instaward sponsor key is an environment variable and the Instaward planner may not split plans above 100 operations; both are stated as things to verify, not as facts about the delivered code, which was not inspected for this document.
- Statuses referencing `Follow-on` and `Build Award Dn` assume the scopes proposed in `docs/next-steps/scf-path.md` sections 3.3 and 6.3; if those are not funded, every such row becomes `Open`.
- The reserve figures in the SOW and the funded applications (1 XLM base, 0.5 XLM per subentry) are taken as current; the developer documentation page on minimum balance is the authority if the network changes base reserves.
- Nothing here is legal advice; whether paying fees on behalf of third parties or moving their balances creates obligations for an integrator is for the integrator to assess.

## Sources

- `SUCCESSFUL_SOW.md`, section 4.1 "Out of Scope" (mainnet, production key management, C addresses, liquidity pool withdrawal, claimable balances, raised-threshold multisig, wallet UI)
- stellar-build skill `deploy-stellar-mainnet` (three gates; network passphrase warning; funding routes)
- Stellar developer documentation (URLs returned by the Raven MCP docs search on 2026-09-25):
  - Fee-bump transactions guide: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
  - Fees, resource limits and fee-bumps on past transactions: https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering#fee-bumps-on-past-transactions
  - Minimum balance and sponsored reserves: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
  - Base reserves and subentries: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#base-reserves
  - Account merge operation: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge
  - Revoke sponsorship operation: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#revoke-sponsorship
  - Liquidity pool withdraw operation: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#liquidity-pool-withdraw
  - Claimable balance operations: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#create-claimable-balance
  - Asset access control flags including clawback: https://developers.stellar.org/docs/tokens/control-asset-access#clawback-enabled-0x8
  - SEP list (SEP-29 memo required): https://developers.stellar.org/docs/learn/fundamentals/stellar-ecosystem-proposals#complete-list-of-active-proposals
  - RPC providers directory: https://developers.stellar.org/docs/data/apis/rpc/providers
- Stellar protocol proposals: CAP-15 fee-bump transactions (https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md); CAP-33 sponsored reserves (https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md); SEP-29 account memo requirements (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md)
- Competitor handling of exchange destinations and fee-bumped envelopes: SCF #44 submissions https://communityfund.stellar.org/submissions/recuKWaSdUL8Lkw9o and https://communityfund.stellar.org/submissions/recqvIs2iRu34ESGo (fetched 2026-09-25)
- SCF #46 status as of 2026-09-25: https://communityfund.stellar.org/awards
- Companion documents: `docs/next-steps/scf-path.md`, `docs/next-steps/instaward-completion-report-template.md`
