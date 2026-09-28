---
title: Dustin UX Design
status: draft v1, produced in a non-interactive run of the create-ux-design workflow
date: 2026-09-25
author: the builder
scope: accepted 30-day Stellar Instaward SOW (SUCCESSFUL_SOW.md)
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
inputDocuments: ["SUCCESSFUL_SOW.md"]
---

# Dustin UX Design

Dustin is a JavaScript/TypeScript SDK and CLI that closes messy Stellar classic (G) accounts on testnet, including accounts that hold zero spendable XLM and therefore cannot pay a single fee themselves. The SOW is explicit that the wallet UI is out of scope: "A CLI demo is the interface for this scope, integration UI is left to the integrator." So the two user-facing surfaces this document designs are the CLI and the objects the SDK hands to an integrator. Everything else (a web page, a wallet screen) appears only as guidance or as a clearly marked stretch idea.

The one sentence that every design decision below serves: **a person should be able to read exactly what will happen to their account before anything is signed, watch it happen one transaction at a time, and hand the result to a stranger who can verify it in two minutes.**

## 0. Design principles

| # | Principle | What it means in practice |
|---|---|---|
| P1 | Read before you sign | Every command is a dry run unless the user says `--execute`, and even then a typed confirmation stands between the plan and the first signature. Planning never mutates anything. |
| P2 | Name every outcome | Every item on the account ends in exactly one of `done`, `skipped`, `unclosable` or `failed`, always with a reason in plain words. Nothing is silently dropped. |
| P3 | The account pays nothing | The sponsor is named at the top of the plan, on every transaction line and in the report. The user can see that the closed account never paid a fee. |
| P4 | Verifiable by a stranger | Every transaction is printed with its hash and an explorer link. The report is the evidence package; the reviewer does not need to run anything. |
| P5 | One truth, three shapes | The human table, the `--json` document and the SDK objects are projections of the same `ClosePlan` / `CloseReport`. They cannot drift. |
| P6 | Words, not colors | Colors are decoration. Status is always a word, tables are plain ASCII, and everything works with `NO_COLOR`, in a pipe, and under a screen reader. |

Design system: none. A CLI does not need a component library; section 2.11 is the twelve-line terminal style guide that replaces it.

## 1. Users and jobs

### 1.1 The stranded holder (individual user)

Picture someone who tried Stellar two years ago. They hold a G account with a few dust balances from a token airdrop, one offer they forgot about, a data entry some app wrote, and exactly the minimum XLM reserve. They want the XLM out and the account gone. They tried the existing web tool and it declined: the account cannot pay a fee, so nothing can start (SOW section 3).

- Job: move whatever XLM is locked in the account to an account they control, and stop thinking about it.
- Fears: pasting a secret key into something they do not understand; an irreversible step they did not see coming; losing dust they did not know they had.
- What they need from Dustin: a plan in plain words with one headline number ("4 XLM will arrive at your destination"), a clear statement of what cannot be done and why, a confirmation that proves they looked at the destination address, and a receipt with links.
- Emotional target: relief and control. They should end with "I understood every step and nothing surprised me", not "I hope that worked".
- How they meet Dustin in this scope: the CLI (`npx dustin plan G...`). They are comfortable enough with a terminal to run one command, but they are not Stellar experts, so every protocol word in the output gets a gloss the first time it appears.

### 1.2 The wallet integrator

An engineer on a wallet team who wants to offer "Close account" without writing the teardown logic. Their users will never see Dustin's CLI; they will see whatever the wallet renders from the plan.

- Job: call `planClose()`, render the plan in the wallet's own UI, get the user's approval, run `executeClose()` with the wallet's sponsor key, and survive partial failure without corrupting state or surprising the user.
- What they need: typed, stable objects; deterministic ordering; a plan that is a pure function of the ledger (no hidden mutation); progress events they can map to a UI; cancellation between transactions; the guarantee that what the user approved is what runs; and signing through callbacks so the wallet's key store (or a hardware wallet) does the signing, never a raw secret handed to the SDK.
- Emotional target: trust. "I can read this and I can test it."

### 1.3 The evidence reviewer (Ambassador Chapter Lead)

The SOW (section 6) says evidence must be "easy to review by the Ambassador Chapter Lead with minimal technical expertise". The reviewer does not clone the repo. They watch a 60-second video, click a few links, and tick a binary checklist (SOW Appendix B).

- Job: decide, in minutes, whether the success metric holds: a zero-spendable-XLM account with at least 3 funded trustlines, at least 1 offer and at least 1 data entry was fully closed with every fee paid by the sponsor, and the account no longer exists on a public explorer.
- What they need: a before/after they can see; one number that matters (recovered XLM); links that open in a browser; captions in plain language; and no requirement to interpret raw XDR, result codes or JSON.
- Emotional target: certainty. "I saw it disappear and I could check it myself."

### 1.4 Secondary users

- The builder, running `fixture`, `baseline` and the test matrix many times a day: needs speed, idempotence and `--json`.
- CI and scripts: need stable exit codes, no prompts, no ANSI codes when piped.

## 2. CLI interaction design

### 2.1 Command surface

Binary: `dustin`. Every command accepts `--network testnet` (the only network accepted in this scope; `--network public` is refused with exit code 2 and the sentence "Dustin is testnet-only in this release"), `--horizon <url>`, `--json`, `--no-color`, `--quiet`, `--verbose`, `--help`, `--version`.

| Command | What it does | Secrets needed | Mutates the ledger |
|---|---|---|---|
| `dustin plan <G-account> [--to <G-destination>] [--sponsor <G-sponsor>]` | Inspects the account and prints the ordered close plan. `--to` is optional here (the destination rung of the disposal ladder shows as "needs --to" until given); `--sponsor` only affects the fee estimate line. | None | Never |
| `dustin close <G-account> --to <G-destination> [--execute] [--yes] [--partial] [--prefer-destination] [--max-fee <stroops>] [--run-file <path>]` | Re-plans, prints the plan, and stops. With `--execute` it asks for confirmation and runs. With `--execute --yes` it runs without a prompt (scripts). `--partial` allows a teardown that cannot end in a merge (section 2.7). | Account secret and sponsor secret (section 2.3) | Only after `--execute` and confirmation |
| `dustin fixture create [--profile messy\|edge] [--out <dir>]` | Builds a testnet fixture account (friendbot-funded issuers, trustlines with dust, offers, data entry, a sponsored trustline, then drains spendable XLM to zero). Writes keys to a mode-600 JSON file. There is no `simple` profile: the week 2 close used fresh `messy` accounts instead (PRD decision D-4); `edge` is in progress. | None (generates its own, testnet only) | Yes, on throwaway testnet accounts |
| `dustin fixture show <G-account>` | Prints the same inventory the planner sees, without a plan. Used for the "before" snapshot. | None | Never |
| `dustin baseline snapshot <G-account> [--out <dir>]` | Saves the account's before-state as JSON and prints it in the plan's table format for the evidence package. | None | Never |
| `dustin baseline unsponsored <G-account>` | Dry-runs the plan with the account as its own fee payer and prints where it would stop. Complements, and does not replace, the required recording of the existing web tool (SOW D3). | None | Never |
| `dustin report --from <run-file> [--format md\|json]` | Renders a finished or partial run as the evidence package: numbers, per-item outcomes, hashes, explorer links, verification steps. | None | Never |

`--prefer-destination` (decision D-1, approved 2026-09-25) tries the destination transfer before the return to issuer for each leftover balance and falls back to the burn; without it the disposal ladder runs in the SOW order. The plan's "why" column names the order used, so the evidence stays readable either way.

Design notes:

- `plan` and `close` share one renderer. `close` without `--execute` prints exactly what `plan` prints plus the line `Next: add --execute to run this plan`. There is no way to reach a signature without typing `--execute`.
- The command names are verbs a non-expert can guess. There is no `demolish`, `nuke` or `purge`; the SOW's language is "close" and "merge", so the CLI uses those.
- `--run-file` defaults to `./dustin-run-<UTC timestamp>.json` and is created on the first submission. It is the input of `report` and the memory of a failed run (section 2.7).

### 2.2 Dry run by default, execution explicitly confirmed

Three gates stand between the user and the first signature:

1. **The flag.** Nothing is signed unless `--execute` is present. `plan` does not even accept it.
2. **The plan on screen.** `close --execute` always re-inspects the account and prints the full plan first, even if the user ran `plan` a second ago. What is executed is what is on screen; the plan carries a content hash and the run refuses to start if the account changed between rendering and confirmation (it re-plans and shows the diff instead).
3. **The typed confirmation.** In a terminal the user must type the last four characters of the destination address. This is deliberate: the destination is the one field where a typo loses money forever, and typing its tail proves the user read it. `--yes` skips the prompt and is only honoured together with `--execute`. When stdin is not a terminal and `--yes` is absent, Dustin prints the plan and exits with code 3 ("confirmation required, nothing was executed").

The confirmation block shows exactly what will happen, in this order, because these are the four facts a user must not get wrong:

```
You are about to close GDMESSYQ4K7...7Q2K on testnet.

  4.0000000 XLM  will be sent to  GDESTIN3A9R...M4RX
  3 transactions  signed by the account, every fee paid by sponsor GSPONSOR2H...9KLA
  0 items         unclosable
  Transaction 3 (the merge) cannot be undone.

Type the last 4 characters of the destination address to continue: M4RX
```

Anything other than the exact four characters aborts with "Not confirmed. Nothing was executed." and exit code 3. There is no "are you sure? y/N": a single keystroke is not proof of attention.

### 2.3 Secrets

Rules, in priority order:

1. **Never on the command line.** A value on argv leaks into shell history and process listings. If any argument looks like a Stellar secret (56 characters starting with `S`), Dustin refuses to run, prints why, and exits with code 2 without echoing the value.
2. **Environment variables first.** `DUSTIN_ACCOUNT_SECRET` (the account being closed) and `DUSTIN_SPONSOR_SECRET` (the fee payer). The SOW fixes this for the sponsor: "The sponsor uses an env key for this scope."
3. **Files second.** `--account-secret-file` and `--sponsor-secret-file` read one line from a file; Dustin warns if the file is readable by others.
4. **Hidden prompt last.** In a terminal, a missing secret is asked for with input hidden. In a non-terminal it is an error (exit 2) that names the variable to set.

Before anything else, Dustin derives the public key from each secret and checks it: the account secret must match `<G-account>`, the sponsor secret must belong to a funded testnet account. A mismatch is reported as "The secret in DUSTIN_ACCOUNT_SECRET belongs to GXXX..., not to GDME...7Q2K" so the user knows which one is wrong. Secrets never appear in output, logs, run files or `--json`; the run file stores public keys only.

### 2.4 The plan (mockup)

The fixture used throughout this document is the SOW's messy account with four trustlines (three with dust plus one sponsored line that also holds a balance, which satisfies "at least 3 trustlines with non-zero balances" under either reading of the SOW), two open offers selling tokens, one data entry, and a native balance that equals its minimum reserve exactly. Hashes, ledger numbers and addresses are illustrative.

Minimum reserve arithmetic shown to the user follows the documented formula `(2 + numSubEntries + numSponsoring - numSponsored) * baseReserve` with a base reserve of 0.5 XLM: 7 subentries, 1 of them sponsored, gives (2 + 7 - 1) * 0.5 = 4.0 XLM.

```
$ dustin plan GDMESSYQ4K7XN2LWJ6P5QBHT3R7UYCV8ZD4FS6KM9WA2NEXQ1GT7Q2K --to GDESTIN3A9R...M4RX

Dustin plan  (dry run: nothing is signed, nothing is submitted)
Network      testnet   ledger 1,204,377   inspected 2026-09-25 14:02:11 UTC
Account      GDME...7Q2K   balance 4.0000000 XLM   spendable 0 XLM   locked as reserve 4.0000000 XLM
Destination  GDES...M4RX   exists, can receive XLM
Sponsor      GSPO...9KLA   pays every fee, estimated 0.00015 XLM total

What is holding the account open, and what Dustin will do about it
  #   item                                    found              action                        why
  1   offer 4471  sell 0.01 SPON for XLM      open               cancel offer                  open offers block the merge
  2   offer 4472  sell 0.3 ILLQ for XLM       open               cancel offer                  open offers block the merge
  3   data "wallet.note"                      1 entry            delete data entry             data entries block the merge
  4   USDT   issuer GBUS...QP3T               0.0000012 (dust)   sell for XLM (path payment)   a path exists on the DEX right now
  5   ILLQ   issuer GBIL...7LNE               0.5000000          return to issuer              no path found; an issuer always accepts its own asset
  6   DEMO   issuer GBDE...4T1V               0.0000100 (dust)   send to destination           destination holds a DEMO trustline
  7   SPON   issuer GBSP...1C9A   sponsored   0.0300000          return to issuer              no path found
  8   trustline USDT                          reserve 0.5 XLM    remove trustline              unlocks 0.5 XLM of your balance
  9   trustline ILLQ                          reserve 0.5 XLM    remove trustline              unlocks 0.5 XLM of your balance
 10   trustline DEMO                          reserve 0.5 XLM    remove trustline              unlocks 0.5 XLM of your balance
 11   trustline SPON   sponsored by GSPO...   reserve is the     remove trustline              the reserve unlocks for the sponsor,
                                              sponsor's                                        not for you
 12   account                                 4.0000000 XLM      merge into GDES...M4RX        last step, cannot be undone

Transactions  (3, the fewest that keep failures isolated)
  tx 1   cleanup    items 1-3     3 ops   fee est. 0.00004 XLM (400 stroops)   sponsor pays
  tx 2   disposal   items 4-11    8 ops   fee est. 0.00009 XLM (900 stroops)   sponsor pays
  tx 3   merge      item 12       1 op    fee est. 0.00002 XLM (200 stroops)   sponsor pays   sequence guard: ok

If everything succeeds
  4.0000000 XLM   arrives at GDES...M4RX
  0.5 XLM         reserve unlocked for sponsor GSPO...9KLA (it was never yours)
  0 XLM           paid by the account; all fees are sponsored
  0 items         unclosable

Glossary  trustline: permission to hold an asset, costs 0.5 XLM of reserve while it exists
          reserve: XLM that must stay in the account while it has entries; it moves with the merge
          sponsor: an account that pays fees and reserves on behalf of another (fee-bump, CAP-15)

Next: dustin close GDME...7Q2K --to GDES...M4RX --execute
```

Reading rules baked into the layout:

- The first three lines answer "what do I have, where does it go, who pays" before any detail.
- The item table is ordered exactly as the operations will run. The `why` column is mandatory for every row; it is the SOW's "reason per step" and it is what turns a list of operations into something a non-expert can approve.
- Grouping rule (printed on request with `--verbose`): everything deterministic goes in tx 1 (cancel offers, delete data, remove already-empty trustlines); everything market-dependent goes in tx 2 (disposals and the trustline removals that depend on them, ordered so each trustline is emptied before it is removed inside the same transaction); the merge is always alone in the last transaction so the user sees a clean account before the irreversible step and so the sequence guard applies to one operation. An account with no leftover balances gets 2 transactions; an account that only needs a merge gets 1. A group is split when it would exceed 100 operations.
- Fee estimates use the documented minimum of 100 stroops per operation plus one operation for the fee-bump envelope; the fee actually bid may be higher (the SDK example bids twice the base fee) and the report shows what was paid.
- The sequence guard line is always present on the merge row, because it is the one failure a user cannot fix by retrying (section 2.7).

When the plan finds blockers, the "If everything succeeds" block is replaced:

```
Plan result: this account cannot be fully closed yet.

  blocker   ILLQ 0.5000000: issuer GBIL...7LNE has revoked authorization for this trustline,
            so the balance cannot be sent anywhere, not even back to the issuer.
            remedy: ask the issuer to re-authorize the trustline or claw the balance back, then run this plan again.

  Dustin can still cancel 2 offers, delete 1 data entry, dispose of 3 balances, remove 3 trustlines
  and move 2.5000000 XLM (spendable after that cleanup) to GDES...M4RX.
  1.5000000 XLM stays locked with the ILLQ trustline until the issuer acts.

  To do that part now:  dustin close GDME...7Q2K --to GDES...M4RX --execute --partial
```

Blockers the planner detects and reports, with the wording shown to the user (protocol facts from the AccountMerge documentation, see Sources):

| Condition | Shown as | Remedy line |
|---|---|---|
| Account has `AUTH_IMMUTABLE` set | "this account can never be merged (immutable flag)" | none; Dustin offers `--partial` to recover spendable XLM only |
| Account sponsors reserves for others (`numSponsoring > 0`, including claimable balances it created) | "this account is sponsoring N entries for other accounts; a sponsoring account cannot be merged" | "revoke or let those sponsorships end first"; claimable balance cleanup is out of scope per the SOW |
| Liquidity pool shares held | "N pool share trustlines found; Dustin detects them but does not withdraw (out of scope)" | "withdraw from the pool first" |
| Raised thresholds / multisig | "the merge needs signature weight N; the provided key has weight M" (AccountMerge is a high-threshold operation) | "collect the extra signatures outside Dustin" |
| Trustline not authorized (or authorized to maintain liabilities only) with a balance | "issuer has revoked authorization; the balance cannot be sent anywhere" | "ask the issuer to re-authorize or claw back" |
| Issuer account no longer exists | Not a blocker: a payment to an issuer that was merged away still succeeds and burns the balance, so the balance returns to the issuer as usual (day-1 experiment 4, `docs/progress-log.md`; `docs/README.md` open question 3, resolved 2026-09-26) | none needed |
| Destination missing / same as account / cannot receive | "destination does not exist" / "destination must differ from the account" / "destination cannot receive this much XLM because of its own offers" | change `--to` |
| Sequence number too far ahead | "the merge would be rejected (sequence number too high); Dustin will wait about N ledgers (~M min) before tx 3" | none needed; if the wait is longer than `--max-wait`, the plan reports it as unclosable for now |

### 2.5 Progress rendering

Execution prints one block per transaction. In a terminal the `submitting` line updates in place; in a pipe or under a screen reader every state is its own line and nothing is overwritten.

```
Closing GDME...7Q2K -> GDES...M4RX on testnet.  Sponsor GSPO...9KLA pays every fee.

tx 1/3  cleanup    cancel 2 offers, delete 1 data entry
        signed by account, fee-bumped by sponsor, submitting...
        confirmed   ledger 1,204,381   8.1 s
        hash 3f9a2c1e6b7d...e21b
        https://stellar.expert/explorer/testnet/tx/3f9a2c1e6b7d0f4a9c2e8b1d5a7f3c6e9b0d2f4a6c8e1b3d5f7a9c0e2b4d6f8a

tx 2/3  disposal   sell USDT, return ILLQ and SPON to their issuers, send DEMO to destination, remove 4 trustlines
        confirmed   ledger 1,204,383   6.4 s
        hash 9b04d1aa3c5e...77af
        https://stellar.expert/explorer/testnet/tx/9b04d1aa3c5e7f9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7f

tx 3/3  merge      sequence guard ok, merging 4.0000000 XLM into GDES...M4RX
        confirmed   ledger 1,204,385   5.9 s
        hash c77e10f3b2a4...0d4c
        https://stellar.expert/explorer/testnet/tx/c77e10f3b2a4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6

Verifying   Horizon /accounts/GDME...7Q2K -> 404 Resource Missing.  The account no longer exists.
```

Rules:

- Each transaction line carries the plain-language summary of its operations, never opcode names. `manageSellOffer(amount 0)` is "cancel offer"; `changeTrust(limit 0)` is "remove trustline".
- The hash is printed in full on its own line so it can be copied, and the explorer link is the full URL so it can be clicked from a terminal. The short form is used only in the same block as the full form.
- Time per transaction is shown because testnet ledgers close roughly every five seconds; a user who sees "6.4 s" learns that waiting is normal.
- The explorer is StellarExpert testnet (`https://stellar.expert/explorer/testnet/tx/<hash>` and `/account/<G>`), the same explorer the Stellar docs link to for testnet transactions. `--explorer <base-url>` swaps it.
- The final `Verifying` line is the machine-checkable proof of the success metric: Horizon answers 404 for an account that no longer exists.

### 2.6 Final report (mockup)

The report is printed at the end of `close --execute` and re-rendered by `dustin report --from <run-file>`. Its first line is the verdict.

```
Dustin report   CLOSED
Account         GDMESSYQ4K7XN2LWJ6P5QBHT3R7UYCV8ZD4FS6KM9WA2NEXQ1GT7Q2K   no longer exists (Horizon 404 at 14:09:52 UTC)
Destination     GDESTIN3A9R5T2WV7X4Z6B8D1F3H5J7L9N2P4R6T8V1X3Z5B7D9F2H4M4RX   received 4.0000000 XLM
Sponsor         GSPONSOR2H4K6M8P1R3T5V7X9Z2B4D6F8H1J3L5N7Q9S2U4W6Y8A1C39KLA   paid 0.00015 XLM in fees, 0.5 XLM reserve unlocked
Fees paid by the closed account   0 XLM
Duration        41 s   3 transactions   ledgers 1,204,381 to 1,204,385

Items
  #   item                          outcome   detail
  1   offer 4471                    done      cancelled in tx 1
  2   offer 4472                    done      cancelled in tx 1
  3   data "wallet.note"            done      deleted in tx 1
  4   0.0000012 USDT                done      sold for 0.0000009 XLM in tx 2
  5   0.5000000 ILLQ                done      returned to issuer GBIL...7LNE in tx 2
  6   0.0000100 DEMO                done      sent to destination in tx 2
  7   0.0300000 SPON                done      returned to issuer GBSP...1C9A in tx 2
  8   trustline USDT                done      removed in tx 2, 0.5 XLM unlocked for you
  9   trustline ILLQ                done      removed in tx 2, 0.5 XLM unlocked for you
 10   trustline DEMO                done      removed in tx 2, 0.5 XLM unlocked for you
 11   trustline SPON (sponsored)    done      removed in tx 2, 0.5 XLM unlocked for the sponsor
 12   account                       done      merged into GDES...M4RX in tx 3

Transactions   (every fee paid by sponsor GSPO...9KLA, the closed account paid nothing)
  tx 1   cleanup    3f9a2c1e6b7d...e21b   ledger 1,204,381   https://stellar.expert/explorer/testnet/tx/3f9a2c1e6b7d...
  tx 2   disposal   9b04d1aa3c5e...77af   ledger 1,204,383   https://stellar.expert/explorer/testnet/tx/9b04d1aa3c5e...
  tx 3   merge      c77e10f3b2a4...0d4c   ledger 1,204,385   https://stellar.expert/explorer/testnet/tx/c77e10f3b2a4...

Verify it yourself
  Account page    https://stellar.expert/explorer/testnet/account/GDMESSYQ4K7...7Q2K   (shows the merge as the last operation)
  Horizon         https://horizon-testnet.stellar.org/accounts/GDMESSYQ4K7...7Q2K     -> 404 "Resource Missing"
  Destination     https://stellar.expert/explorer/testnet/account/GDESTIN3A9R...M4RX   (shows 4.0000000 XLM arriving)
  Evidence file   dustin-run-20260925-140911.json   render with: dustin report --from dustin-run-20260925-140911.json --format md
```

The partial and failed variants change the verdict line and the affected rows only:

```
Dustin report   PARTIAL   (exit code 4)
...
  5   0.5000000 ILLQ                unclosable   issuer GBIL...7LNE revoked authorization; nothing can move this balance
                                                 except the issuer (re-authorize or claw back)
 12   account                       not done     merge blocked while item 5 remains; 1.5000000 XLM stays locked
 13   sweep                         done         2.5000000 XLM sent to GDES...M4RX in tx 3 (spendable after cleanup)
```

`--format md` produces the same content as Markdown with real links, which is what the SOW evidence package needs. The `Verify it yourself` block is written for the reviewer: three links and what each should show.

### 2.7 Failure and resume states

Ground truth is the ledger, never the run file. A re-run of the same `close` command always re-inspects the account, so steps that already succeeded simply disappear from the plan and the run continues from wherever the ledger says it is. Re-running is therefore the resume mechanism; `--run-file <same file>` appends the new attempt so the evidence keeps every hash, including failed attempts that were charged a fee.

| What happened | What the user sees | What Dustin does | Exit |
|---|---|---|---|
| A path payment fails because the path disappeared (`op_too_few_offers`) | "The path Dustin found at planning time is gone. Re-planning: USDT will be returned to its issuer instead (rung 2 of the ladder)." | Re-plans, descends the ladder for that asset, resubmits tx 2 | continues |
| Fee too low during surge pricing (`tx_insufficient_fee`) | "Network fees rose. Raising the sponsor's bid to 0.0002 XLM (limit --max-fee)." | Retries with a higher fee-bump fee up to `--max-fee`; stops and reports if the limit is hit | continues or 5 |
| Sequence number consumed by someone else (`tx_bad_seq`) | "Another transaction used this account's sequence number. Re-planning." | Re-plans once, then retries; a second occurrence stops the run | continues or 5 |
| Merge would fail on sequence number (guarded before submission) | "The merge would be rejected until ledger 1,204,900 (about 43 min). Waiting... (Ctrl-C to stop; run again later to finish)." | Waits with a visible countdown up to `--max-wait`; the account is already clean, so waiting is safe | continues or 5 |
| Horizon unreachable or a submission times out | "Could not reach Horizon. Checking whether tx 2 made it by its hash..." | Looks the transaction up by hash before retrying; never blind-resubmits | continues or 6 |
| An item is unclosable and `--partial` was not given | The blocker block from section 2.4 | Executes nothing | 3 |
| User declined the confirmation or Ctrl-C before the first submission | "Not confirmed. Nothing was executed." | Nothing | 3 |
| Ctrl-C between transactions | "Stopped after tx 1. The account is consistent; run the same command again to continue." | Finishes the in-flight submission, never abandons a submitted transaction, writes the run file | 5 |
| Run finished but the account still exists (`--partial`, or unclosable items) | Report with verdict PARTIAL | Sweeps spendable XLM to the destination if `--partial` allowed it | 4 |

Two wording rules for every failure: say what happened in one sentence a non-expert can read, then say what Dustin is doing about it or what the user can do. The raw result code is printed in parentheses after the sentence for people who search for it, never instead of the sentence.

### 2.8 `--json` output

- `plan --json` prints one JSON document (the `ClosePlan`, section 3.2) on stdout and nothing else there.
- `close --execute --json` prints one JSON document (the `CloseReport`) on stdout at the end, and streams progress events as newline-delimited JSON on stderr so a wrapper can show progress while stdout stays parseable.
- `schemaVersion` is the first field. No ANSI codes, no prompts (`--json` implies non-interactive, so `--execute` without `--yes` exits 3), no secrets, full addresses and full hashes.

```json
{"schemaVersion":1,"kind":"plan","network":"testnet","ledger":1204377,"account":"GDMESSY...","destination":"GDESTIN...","sponsor":"GSPONSOR...","closable":true,
 "recovery":{"xlmToDestination":"4.0000000","xlmUnlockedForSponsor":"0.5000000","feesPaidByAccount":"0","feesEstimatedForSponsor":"0.0001500"},
 "items":[{"id":"offer:4471","kind":"offer","action":"cancel_offer","reason":"open offers block the merge","tx":1}, ...],
 "transactions":[{"index":1,"label":"cleanup","items":["offer:4471","offer:4472","data:wallet.note"],"ops":3,"feeEstimateStroops":400,"feeSource":"sponsor"}, ...],
 "blockers":[],"warnings":[]}
```

Event lines on stderr: `{"event":"tx:confirmed","tx":1,"hash":"3f9a...","ledger":1204381,"elapsedMs":8100}`.

### 2.9 Exit codes

| Code | Meaning | Ledger changed? |
|---|---|---|
| 0 | Plan printed, or account fully closed and verified gone | plan: no; close: yes, fully |
| 1 | Unexpected error (bug); stack trace only with `--verbose` | unknown; run again to find out |
| 2 | Usage or validation error: bad address, secret on argv, wrong secret, mainnet requested | no |
| 3 | Nothing executed: confirmation missing or declined, blockers without `--partial`, or a sponsor or budget precondition failed (the fee bids exceed the per-close budget, or the sponsor cannot cover it; canonical decision 5 as widened on 2026-09-28, PRD decision D-6) | no |
| 4 | Partial: the run completed what it could, the account still exists | yes |
| 5 | Stopped or failed during execution; the account is consistent; re-run to continue | yes, partly |
| 6 | Network: Horizon unreachable before anything was submitted | no |

Scripts can rely on: 0 means the success metric holds; 3 and 6 mean nothing happened; 4 and 5 mean look at the report.

### 2.10 Color, no-color and accessibility

- Color is never the only carrier of meaning. Every status is a word (`confirmed`, `failed`, `unclosable`, `done`, `not done`, `waiting`). A colour-blind user, a screen reader and a log file all get the same information.
- Colour is on only when stdout is a terminal, `NO_COLOR` is unset (the no-color.org convention) and `--no-color` is absent. Only four semantic colours exist: green for done/confirmed, yellow for waiting/partial, red for failed/unclosable, dim for hashes and URLs.
- Output is ASCII by default: no box-drawing characters, no emoji, no spinner glyphs. Tables are aligned columns with a dashed rule under the header. Screen readers read `|` and box characters aloud and drown the content; aligned spaces are quiet. `--unicode` opts in to nicer rules for screenshots.
- Every table row starts with its item number, so a screen-reader user can navigate by number and the video captions can refer to "item 5".
- Addresses are shortened to first four and last four characters in tables and printed in full in the header, the report and JSON; `--wide` prints full values everywhere.
- Nothing is overwritten in place unless stdout is a terminal; in a pipe each state is a new line.
- Line length stays at or under 120 characters, and every block is readable when wrapped at 80.
- Numbers use up to seven decimals (a stroop is 0.0000001 XLM) and never scientific notation; stroops are shown in parentheses where fees are involved so the two units are never confused.

### 2.11 Terminal style guide (replaces a design system)

1. Verbs for commands, nouns for items, one screen per command.
2. First three lines of any output answer: what, where, who pays.
3. Every action has a `why`. Every non-success has a reason and, where one exists, a remedy.
4. Protocol words get a one-line gloss the first time they appear in a run (trustline, reserve, sponsor, path payment, merge).
5. Irreversibility is stated on the row where it applies ("cannot be undone"), not in a banner.
6. Hashes and URLs are complete and on their own line.
7. Time is shown in UTC in reports and as elapsed seconds in progress.
8. Status is a word; colour is optional; ASCII is default.
9. Secrets are never printed, echoed, logged or accepted on argv.
10. `--json` output is one document on stdout; events go to stderr.
11. The same renderer serves `plan`, `close` and `report`, so the reviewer sees one visual language in the video and in the evidence package.
12. Never blame the user: "the destination does not exist" rather than "invalid input".

### 2.12 `fixture`, `baseline` and `report` in use

```
$ dustin fixture create --profile messy
Creating the messy fixture on testnet (about 2 minutes)
  fund issuers via friendbot           GBUS...QP3T  GBIL...7LNE  GBDE...4T1V  GBSP...1C9A   ok
  create account and destination       GDME...7Q2K  GDES...M4RX                             ok
  trustlines and dust                  USDT 0.0000012  ILLQ 0.5  DEMO 0.00001  SPON 0.03    ok
  sponsored trustline (SPON)           sponsored by GSPO...9KLA                              ok
  offers and data entry                2 offers, "wallet.note"                               ok
  market maker offer so USDT has a path                                                      ok
  drain spendable XLM to 0             balance 4.0000000 = minimum reserve                   ok
Fixture ready   GDME...7Q2K   spendable 0 XLM   4 trustlines   2 offers   1 data entry
Keys written to ./fixtures/messy.json (mode 600, testnet only)
Explorer        https://stellar.expert/explorer/testnet/account/GDMESSYQ4K7...7Q2K
```

```
$ dustin baseline unsponsored GDME...7Q2K
Baseline: what happens if the account has to pay for itself
  Account GDME...7Q2K holds 4.0000000 XLM and all of it is locked as reserve. Spendable: 0 XLM.
  The first transaction (cancel offer 4471) needs a 0.00001 XLM fee from the account.
  Predicted result: tx_insufficient_balance (the fee would take the account below its minimum reserve).
  Nothing can start without a sponsor. This is the gap the existing web tool stops at.
  Snapshot saved: baseline/GDME...7Q2K-before.json
Next: record the existing web tool's run against this account and store the recording beside the snapshot.
```

`dustin report --from <run-file> --format md` writes the Markdown that goes into the SOW evidence table, with the "Verify it yourself" block first.

## 3. SDK ergonomics as UX

The SDK is the integrator's interface, and its objects are what a wallet will eventually render. They are designed to be read by a product person, not just parsed by code: every step has `action` and `reason` strings in plain language, and every amount is a decimal string in XLM or asset units, never stroops.

> Names superseded (PRD decision D-2, 2026-09-28): the SDK kept the names it was built with, and PRD section 7 is the normative API; `docs/integration-notes.md` shows it in use. The sketches in sections 3.1 to 3.3 are the design draft of 2026-09-25 and differ from the code: `executeClose(plan, signers, options)` takes `{ account, feeSponsor }` signers and `confirm: true`; the events are `plan`, `drift`, `preflight`, `tx:building`, `tx:submitted`, `tx:confirmed`, `tx:failed`, `verified` and `done`; there is no resume option, because running a close again is the resume; the rung a disposal used is on its step outcome, with no separate fallback status; `verifyClosed(account, options)` returns `{ accountExists, horizonStatus, checkedAt, ledger, accountUrl }`; and the blocker and unclosable codes are those of PRD section 7. The design properties hold: typed objects, reasons in plain words, signing through callbacks, progress events, and a plan that is what runs.

### 3.1 Entry points

```ts
import { planClose, executeClose, keypairSigner } from "dustin";

const plan = await planClose({
  account: "G...",            // the account to close
  destination: "G...",        // optional for planning, required for execution
  sponsor: "G...",            // public key only; affects the fee estimate
  network: "testnet",         // the only value accepted in this release
  horizonUrl: "https://horizon-testnet.stellar.org", // optional
});
// planClose performs GET requests only. It has no code path that signs or submits.

const report = await executeClose({
  plan,                                        // exactly what the user approved
  signers: {
    account: keypairSigner(process.env.DUSTIN_ACCOUNT_SECRET),   // or (xdr) => Promise<signedXdr>
    sponsor: keypairSigner(process.env.DUSTIN_SPONSOR_SECRET),   // signs the fee-bump envelopes only
  },
  allowPartial: false,       // true: execute even if the merge cannot happen, then sweep spendable XLM
  maxFeeStroops: 1000,       // per operation, ceiling for surge-pricing retries
  maxWaitLedgers: 600,       // ceiling for the sequence-number wait before tx 3
  signal: abortController.signal,
  onEvent: (event) => render(event),
});
```

- Signing is a callback, so a wallet can sign with its own key store or a hardware device. The SDK never needs to see a secret; `keypairSigner` is a convenience for the CLI and tests.
- `executeClose` refuses a stale plan: it re-inspects the account and, if the ledger no longer matches `plan.fingerprint`, throws `PlanOutdatedError` carrying a fresh plan and a diff. The integrator shows the diff and asks again. What the user approved is what runs.
- Fee-bumping uses the SDK's documented builder, `TransactionBuilder.buildFeeBumpTransaction(feeSource, baseFee, innerTransaction, networkPassphrase)`: the account signs the inner transaction, the sponsor signs the outer envelope, and the fee account pays instead of the inner source while the sequence number still comes from the account being closed.

### 3.2 `ClosePlan`, `CloseStep`, `CloseReport`

```ts
interface ClosePlan {
  schemaVersion: 1;
  kind: "plan";
  network: "testnet";
  ledger: number;                    // ledger the inspection was taken at
  inspectedAt: string;               // ISO 8601
  fingerprint: string;               // hash of the account state the plan was derived from
  account: string;
  destination?: string;
  sponsor?: string;
  snapshot: AccountSnapshot;         // balances, offers, data, flags, thresholds, reserve arithmetic
  closable: boolean;                 // false when any blocker prevents the merge
  blockers: Blocker[];               // { code, message, remedy?, item? }
  warnings: Warning[];               // e.g. "clawback enabled on USDT: issuer could claw back before tx 2"
  items: CloseItem[];                // one per subentry or balance, in execution order
  steps: CloseStep[];                // one per operation, in execution order
  transactions: PlannedTransaction[];// grouping of steps; { index, label, stepIds, ops, feeEstimateStroops, feeSource: "sponsor" }
  recovery: {
    xlmToDestination: string;        // "4.0000000"
    xlmUnlockedForSponsor: string;   // "0.5000000"
    feesPaidByAccount: "0";          // always "0" when sponsored; the field exists so a wallet can display it
    feesEstimatedForSponsor: string; // "0.0001500"
    lockedIfPartial?: string;        // present when closable is false
  };
}

interface CloseStep {
  id: string;                        // "cancel_offer:4471"
  txIndex: number;                   // 1-based transaction it belongs to
  kind: "cancel_offer" | "delete_data" | "dispose_path_payment" | "dispose_return_to_issuer"
      | "dispose_send_to_destination" | "remove_trustline" | "wait_for_sequence" | "sweep_xlm" | "merge";
  item: ItemRef;                     // { type: "offer"|"data"|"balance"|"trustline"|"account", asset?, issuer?, offerId?, name?, sponsored?: boolean }
  action: string;                    // "cancel offer 4471"
  reason: string;                    // "open offers block the merge"
  irreversible: boolean;             // true only for merge
  ladderRung?: 1 | 2 | 3;            // for disposals: path payment, issuer, destination
  amount?: string;                   // asset units
  releasesReserveTo?: "account" | "sponsor";
  feeEstimateStroops: number;
}

interface CloseReport {
  schemaVersion: 1;
  kind: "report";
  status: "closed" | "partial" | "aborted" | "failed"; // plus "running" on copies saved while a run is in progress (2026-09-27)
  exitCode: 0 | 4 | 5;
  plan: ClosePlan;                   // the plan as executed (after any re-plans)
  replans: number;
  transactions: ExecutedTransaction[]; // { index, label, hash, ledger, explorerUrl, feePaidStroops, feeSource, attempts, stepIds, result: "confirmed"|"failed", resultCode? }
  items: ItemOutcome[];              // { item, outcome: "done"|"skipped"|"unclosable"|"failed"|"not_done", detail, reason?, remedy?, txIndex?, hash? }
  recovered: { xlmToDestination: string; xlmUnlockedForSponsor: string; feesPaidBySponsor: string; feesPaidByAccount: "0"; xlmStillLocked: string };
  verification: { accountExists: boolean; checkedAt: string; horizonStatus: number; accountUrl: string; destinationUrl: string };
  startedAt: string; finishedAt: string; durationMs: number;
}
```

Design notes for the integrator:

- `items` is the list a person reads; `steps` is the list a machine executes; `transactions` is how the two are grouped. A wallet renders `items`, shows progress by `transactions`, and never needs `steps`.
- Amounts are decimal strings to avoid floating-point surprises; stroop integers appear only in fee fields and are named `...Stroops`.
- `blockers[].code` values are stable identifiers, each with a human `message` and optional `remedy` so a wallet can localise. The implemented codes are the `BlockerCode` and `UnclosableCode` lists of PRD section 7 (PRD decision D-2), which replace this draft's `AUTH_IMMUTABLE`, `POOL_SHARES`, `THRESHOLD`, `TRUSTLINE_UNAUTHORIZED`, `DESTINATION_SAME` and `DESTINATION_FULL`. The draft's `ISSUER_GONE` does not exist: a payment to an issuer that was merged away still burns the balance (day-1 experiment 4; `docs/README.md` open question 3).

### 3.3 Events, progress and cancellation

```ts
type CloseEvent =
  | { type: "plan";          plan: ClosePlan }
  | { type: "replan";        reason: string; plan: ClosePlan }
  | { type: "tx:building";   tx: number; label: string; summary: string }
  | { type: "tx:signing";    tx: number; signer: "account" | "sponsor" }
  | { type: "tx:submitting"; tx: number; attempt: number; feeStroops: number }
  | { type: "tx:confirmed";  tx: number; hash: string; ledger: number; explorerUrl: string; elapsedMs: number }
  | { type: "tx:failed";     tx: number; hash?: string; resultCode: string; message: string; willRetry: boolean }
  | { type: "waiting";       tx: number; reason: "sequence_number" | "fee" | "network"; untilLedger?: number; etaSeconds?: number }
  | { type: "item";          item: ItemRef; outcome: ItemOutcome["outcome"]; detail: string }
  | { type: "verifying";     accountUrl: string }
  | { type: "done";          report: CloseReport };
```

- Events are emitted in order and each carries enough text to render a line without lookups. The CLI's progress block in section 2.5 is a direct rendering of this stream.
- Cancellation uses a standard `AbortSignal`. Abort is honoured between transactions only: a submitted transaction is never abandoned, because it cannot be un-submitted. On abort the promise resolves (it does not reject) with a report whose `status` is `"aborted"`, so the integrator always gets the hashes of what already happened.
- Re-running `executeClose` with a fresh plan after an abort or failure continues from the ledger state. There is no separate resume API because the plan is the resume.

### 3.4 What a wallet would render from the plan (guidance only)

The wallet UI is out of scope for this SOW; this is the recommended mapping so an integrator can start without re-deriving it.

| Screen | Source in the plan | What to show |
|---|---|---|
| Review | `recovery.xlmToDestination`, `destination`, `sponsor`, `closable`, `blockers`, `items` | Headline "You will receive 4 XLM", destination with its last four characters emphasised, one row per item using `action` and `reason`, a note that fees are paid by the wallet's sponsor, blockers rendered as a red card with the `remedy`. The primary button "Close account" is disabled while `closable` is false, with "Recover what is possible" as a secondary action only if the wallet supports `allowPartial`. |
| Confirm | `steps.find(s => s.irreversible)` | A sheet that repeats the destination and says the merge cannot be undone; the wallet's own authentication (PIN, biometrics, hardware wallet) is the confirmation, playing the role of the CLI's typed tail. |
| Progress | `tx:*` events, `transactions[].label` | One row per transaction with its plain-language summary, a spinner while submitting, a checkmark and explorer link when confirmed, and the retry text from `tx:failed` when `willRetry` is true. |
| Done | `CloseReport.status`, `recovered`, `verification`, `items` | "Account closed" with the recovered amount, "View on explorer" for the destination, and an expandable per-item list. For `partial`, lead with what was recovered and what stays locked, then the remedy. |

## 4. Demo video storyboard (60 seconds)

Goal: a viewer with no Stellar knowledge sees the messy account, sees the plan, sees the sponsor paying, and sees the account disappear. Every caption is a full sentence in plain language; no caption contains a result code or the word XDR. The terminal is recorded at 1080p with an 18-point monospace font, a high-contrast light theme (better in compressed video than dark), `--unicode` on, and the browser at 125 percent zoom. Captions are burned in, top-centre, white on a dark band. No music is needed; if music is used it stays under the captions' reading pace.

| Time | Shot | On screen | Caption (burned in) | What the reviewer should notice |
|---|---|---|---|---|
| 0:00-0:05 | Title card | "Dustin" and the fixture address in full, plus "Stellar testnet" | "This Stellar account holds 4 XLM but cannot spend any of it, so it cannot even pay a fee to close itself." | The problem in one sentence. |
| 0:05-0:13 | Browser, explorer account page of the fixture (before) | Balances panel: 4 XLM, USDT, ILLQ, DEMO, SPON; offers tab showing 2; data tab showing 1 | "Before: 4 trustlines with balances, 2 open offers, 1 data entry. All 4 XLM are locked as reserve." | The checklist items from SOW Appendix B are visible on a public site. |
| 0:13-0:16 | Terminal | `dustin baseline unsponsored G...` output, ending on the "Nothing can start without a sponsor" line | "Without a sponsor, the first transaction fails: the account cannot pay 0.00001 XLM." | Why the existing approach stops here. |
| 0:16-0:26 | Terminal | `dustin plan G... --to G...` scrolls once, then holds on the item table; the `why` column is highlighted by a slow zoom | "The plan is read-only. Twelve steps, three transactions, every step with a reason. Nothing is signed yet." | Reason per step, fee estimate per transaction, "0 items unclosable". |
| 0:26-0:31 | Terminal | `dustin close G... --to G... --execute`, the confirmation block, the user types `M4RX` | "To run it, you type the last four characters of the destination. That proves you read it." | The destination and the sponsor are named before anything happens. |
| 0:31-0:44 | Terminal (cuts between confirmations, real timestamps kept on screen) | tx 1/3 confirmed, tx 2/3 confirmed, tx 3/3 confirmed, each with hash and explorer link | "Three transactions. Every fee is paid by the sponsor account. The closed account pays nothing." | "fee-bumped by sponsor" on every block; elapsed seconds show it is live. |
| 0:44-0:49 | Terminal | The report header: CLOSED, destination received 4.0000000 XLM, sponsor paid 0.00015 XLM in fees, account paid 0 | "Result: 4 XLM arrived at the destination. Fees paid by the account: zero." | The single number that matters. |
| 0:49-0:56 | Browser | Reload the fixture's explorer page: the merge is the last operation and the account is shown as merged/removed; then the Horizon URL for the account showing the 404 "Resource Missing" response | "After: the account no longer exists. Anyone can check this link." | The binary success metric, on a public site, with a second independent check. |
| 0:56-1:00 | End card | Repository URL, the three transaction hashes, "testnet only" | "Dustin. Read the plan, then close the account. Testnet only for now." | Where to find the evidence package. |

Production notes:

- Record the terminal with a fixed 120-column width so no line wraps; the plan table must be readable at 1080p without zooming, which is why the item table has short columns and the full addresses live in the header.
- Do not speed up the confirmation typing; do cut the ledger waits, but leave the elapsed-seconds values visible so the run is evidently real.
- Use the same fixture address in every shot and in the evidence package so the reviewer can match the video to the links.
- Keep the explorer's own wording in shot 8; if it labels the account "merged" or "deleted", the caption still says "no longer exists" and the Horizon 404 is the unambiguous proof.
- Export captions as a sidecar `.srt` too, so the video is accessible with the sound off and searchable.

## 5. Stretch (outside SOW): a one-page web demo

Not part of the 30-day scope; recorded only so the idea is not lost. A single static page with one input: paste a testnet G address and the page calls `planClose()` in the browser (Horizon GETs only) and renders `items` as a list with a headline recovered amount. A "Close on testnet" button appears only if the plan is closable; it asks for the account secret in a field that is never persisted, signs the inner transactions locally, and sends them to a tiny hosted signer that fee-bumps with a testnet sponsor key. Progress and the final report reuse the CLI's event stream and `CloseReport`. Testnet only, with the network name in the page title and a refusal for public-network addresses. No accounts, no analytics, no storage. This would demonstrate the SDK to non-CLI users in under a minute, but it would need key-handling and hosting decisions that the SOW explicitly leaves to integrators, so it stays a stretch idea.

## Assumptions

1. The SOW makes the CLI the interface for this scope and puts the wallet UI out of scope; this document therefore designs the CLI and the SDK objects, and gives wallet rendering only as guidance (section 3.4).
2. Command names, flags, exit codes, the typed-tail confirmation, environment variable names and the JSON schema are design decisions made here, not requirements from the SOW; the builder may rename them, but the properties (dry run by default, a flag plus a confirmation, secrets never on argv, one JSON document on stdout, status as words) should survive any renaming.
3. The fixture is modelled with four trustlines: three unsponsored lines with dust plus one sponsored line that also holds a balance. This satisfies the success metric's "at least 3 trustlines with non-zero balances" whether the SOW's "1 sponsored trustline" is read as one of the three or as an additional one. The builder confirms the final fixture shape.
4. SOW tension to resolve: the week-3 output says both that "the messy fixture is closed" and that "the deliberately illiquid asset exits through the unclosable path with a stated reason". An account cannot be merged while an unclosable balance remains, so both cannot be true of the same account in the same run. This design assumes the demo fixture closes fully (its illiquid asset exits via "return to issuer", rung 2 of the ladder) and that the unclosable path is demonstrated on a separate test-matrix account (for example, an issuer that revoked authorization), with its report shown in the test-results screenshot. The builder should confirm this reading with the Ambassador Chapter Lead.
5. Path-payment proceeds land in the account being closed and move to the destination with the merge, so the report shows one recovered number. Sending proceeds straight to the destination is equally valid; the builder decides, and the plan wording follows.
6. Transaction grouping (deterministic cleanup, market-dependent disposal, merge alone) is a UX choice that favours failure isolation and a visible "clean before merge" moment over the absolute minimum count; the SOW's "minimum number of transactions" is read as "no unnecessary transactions", and the grouping rule is printed with `--verbose` so a reviewer can see it.
7. The sequence-number guard is specified by its user-facing behaviour (detect before submitting, explain, show a wait estimate, cap the wait). The exact threshold has since been verified against stellar-core (see docs/research/raven-ground-truth.md, section 6): the merge is rejected while `accountSeq >= currentLedgerSeq << 32`, so the wait estimate is `ceil(accountSeq / 2^32) - currentLedgerSeq` ledgers (about 5 seconds each on testnet), and `BumpSequence` cannot shorten it.
8. `--partial` and its final "sweep spendable XLM to destination" step are a small addition beyond the SOW's disposal ladder. They exist because a partial teardown lowers the reserve and makes XLM spendable; without a sweep the user would gain nothing from a partial run. The builder can drop the sweep and keep only the reporting if time is short.
9. Accounts that themselves sponsor reserves for others (including claimable balances they created), liquidity pool shares and raised multisig thresholds are detected and reported with a remedy, not resolved, in line with the SOW's out-of-scope list.
10. Explorer link formats follow the testnet transaction links used in the Stellar docs (`stellar.expert/explorer/testnet/tx/<hash>`) and the explorer's account route; the exact wording the explorer shows for a merged account is the explorer's and was not verified here, which is why the Horizon 404 is the canonical proof in both the CLI and the video.
11. The existing web tool's baseline recording remains a manual screen recording as the SOW requires; `dustin baseline` only produces the before-snapshot and the unsponsored dry run that accompany it. The tool's exact URL was not verified in the sources consulted and is left to the evidence package.
12. Prior art surfaced while researching (Raven ecosystem directory, 2026-09-25): a repository describing itself as a "non-custodial tool to close any Stellar account and recover the XLM locked inside it" (github.com/LumenWipe/lumenwipe). It was not evaluated for this document; the builder should check it before the write-up repeats the SOW's claim that no callable alternative exists.
13. All hashes, ledger numbers, addresses and timings in the mockups are illustrative placeholders.
14. This document was produced in a single non-interactive pass of the create-ux-design workflow; the collaborative menus, colour-theme and design-direction HTML artefacts were skipped as not applicable to a CLI, and the file lives at `docs/ux-design.md` as requested rather than at the workflow's default name.

## Sources

Stellar developer documentation (consulted 2026-09-25 through the Raven MCP docs index and developers.stellar.org):

1. Fee-bump transactions guide (CAP-15; the fee account pays instead of the inner source while the sequence number still comes from the inner source; the fee must cover the inner operations plus one and be at least the inner fee; JavaScript example using `TransactionBuilder.buildFeeBumpTransaction`): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
2. Sponsored reserves guide (CAP-33; minimum balance `(2 + numSubEntries + numSponsoring - numSponsored) * baseReserve`; revoke sponsorship at the sponsor's discretion; claimable balances are sponsored by their creator): https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
3. AccountMerge result codes (`ACCOUNT_MERGE_HAS_SUB_ENTRIES`, `ACCOUNT_MERGE_SEQNUM_TOO_FAR` "source account sequence number is too high", `ACCOUNT_MERGE_IS_SPONSOR`, `ACCOUNT_MERGE_IMMUTABLE_SET`, `ACCOUNT_MERGE_DEST_FULL`, `ACCOUNT_MERGE_NO_ACCOUNT`, `ACCOUNT_MERGE_MALFORMED`; signers are removed automatically): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
4. List of operations (Account Merge is a high-threshold operation and requires no non-signer subentries; Change Trust with a non-zero balance fails with `CHANGE_TRUST_INVALID_LIMIT`; Manage Sell Offer deletes by offer id; Manage Data removes an entry when no value is set; Path Payment Strict Send; Payment and path payment "source account is not authorized"; Set Trustline Flags authorization states; Revoke Sponsorship; Liquidity Pool Withdraw): https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
5. Accounts data structure (one base reserve is 0.5 XLM; subentries include trustlines for assets and pool shares, offers, signers and data entries; at most 1,000 subentries): https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts
6. Lumens, minimum balance (two base reserves plus one per subentry): https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
7. Fees (network minimum inclusion fee of 100 stroops per operation): https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering#inclusion-fee and https://developers.stellar.org/docs/learn/glossary#base-fee
8. Path Payment Strict Send result codes (`PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS` when no path connects the assets): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/path-payment-strict-send
9. Change Trust result codes: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust
10. Manage Data and Manage Sell Offer result codes: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/manage-data and https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/manage-sell-offer
11. Transaction result codes (`tx_insufficient_fee`, `tx_bad_seq`, `tx_insufficient_balance`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions
12. Horizon error handling (404 Not Found for a missing resource, "source account not found"): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling
13. Clawbacks guide (`AUTH_CLAWBACK_ENABLED` and the trustline clawback flag): https://developers.stellar.org/docs/build/guides/transactions/clawbacks
14. Sequence numbers (must increase by one; one transaction per account per ledger): https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#sequence-number and https://developers.stellar.org/docs/learn/glossary#sequence-number
15. Signatures and multisig thresholds: https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig
16. Testnet explorer links used in the docs (`https://stellar.expert/explorer/testnet/tx/<hash>`; StellarExpert testnet base URL): https://developers.stellar.org/docs/build/guides/transactions/upload-wasm-bytecode#running-the-install-script and https://developers.stellar.org/docs/platforms/stellar-disbursement-platform/admin-guide/configuring-sdp
17. Friendbot and Stellar Lab account funding: https://developers.stellar.org/docs/build/guides/transactions/simulateTransaction-Deep-Dive#using-the-javascript-sdk and https://lab.stellar.org/account/fund

Other sources:

18. The accepted Statement of Work for this Instaward: `SUCCESSFUL_SOW.md` in this repository (scope, success metric, out-of-scope list, evidence requirements).
19. StellarExpert project entry (website https://stellar.expert/, GitHub organisation https://github.com/stellar-expert), from the Raven ecosystem directory, retrieved 2026-09-25.
20. Prior-art repository surfaced by the Raven ecosystem directory on 2026-09-25, not evaluated: https://github.com/LumenWipe/lumenwipe
21. The `NO_COLOR` convention for command-line tools: https://no-color.org/
