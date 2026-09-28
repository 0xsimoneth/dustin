---
title: "PRFAQ: Dustin"
status: "complete"
created: "2026-09-25"
updated: "2026-09-25"
stage: 5
mode: "headless"
inputs:
  - "SUCCESSFUL_SOW.md (accepted Stellar Instaward Statement of Work: 30 days, $5,000)"
  - "Stellar developer documentation, stellar-core source, CAP-0033, and public repositories listed under Sources"
---

> **About this document.** This is a Working Backwards PRFAQ for Dustin, produced non-interactively from the accepted Statement of Work. The press release is written as if published on the last day of the 30-day sprint. Everything after the press release is the honest part: the questions a skeptical customer and a skeptical stakeholder would ask, answered with what the protocol actually does. Numbers are cited to the sources at the end; where the SOW and the writer had to fill a gap, the gap is listed under Assumptions.

# Dustin closes Stellar accounts that cannot afford to close themselves

## An open-source SDK and CLI that plans, then executes, the full teardown of a messy Stellar testnet account, with every fee paid by a sponsor, so a wallet can offer "close account" even to a user whose account holds nothing spendable

**STELLAR TESTNET, September 8, 2026** — Today the builder published Dustin, a JavaScript/TypeScript SDK and command-line tool that closes Stellar classic (G) accounts, and used it to close the deliberately messy testnet account it was built against: zero spendable XLM, three trustlines still holding dust, one more trustline whose reserve was paid by someone else, two open offers and one data entry. The account no longer exists on the public testnet explorer, the chain of transactions that removed it is linked from the evidence package, and the account being closed paid none of the fees. Dustin is available on npm; its source, test matrix, fixture builder, and a recorded baseline run of the existing tool against the same account are public.

A Stellar account is cheap to open and surprisingly hard to leave. The account itself locks 1 XLM (two base reserves of 0.5 XLM each), and every trustline, open offer, additional signer and data entry locks another 0.5 XLM [S2]. Those reserves come back only when the account is merged away, and the network refuses to merge an account that still has any of those entries [S3]. A trustline cannot be removed while it holds even a dust balance [S3]. Closing an account is therefore an ordered teardown: cancel the offers, get rid of the leftover balances, remove the trustlines and data entries, then merge. Every step is a transaction, and every transaction needs a fee.

The accounts that most need closing are exactly the ones that cannot do any of this. Picture an account holding precisely its minimum: 1 XLM for the account, 0.5 XLM for each of six entries, 4 XLM locked and nothing spendable. Removing one trustline would free 0.5 XLM, but that removal is itself a transaction, and the network rejects it because the source account cannot pay the minimum fee [S17]. The user can see their 4 XLM on the explorer and cannot touch it. The one existing tool, StellarExpert's Account Demolisher, has been live since 2019 and handles the sequence well for accounts that can pay [S18, S19]. Its published client builds every transaction with the account being closed as the source and fee payer, has no dry run between pasting a secret key into the web form and the first irreversible submission, and is a page inside a block explorer rather than a library [S20]. The request for something a wallet could call was filed in August 2019. It is still open, with no comments, in a repository archived in February 2024 [S18].

Dustin turns closing into two calls. `planClose()` reads the account and returns an ordered plan: which offers to cancel, what will happen to each leftover balance and why, which trustlines and data entries will be removed, how much XLM will actually come back and to whom, and the final merge, grouped into the minimum number of transactions the dependencies allow, with a reason and a fee estimate on every step. It changes nothing on chain. It is the part a user reads before anything is signed, and the part an integrator reads first. `executeClose()` runs that plan on testnet with every transaction wrapped in a fee-bump signed by a sponsor account, so the account being closed never pays a fee and a zero-XLM account can close. Leftover balances go through a fixed ladder: sell for XLM through a path payment; if there is no path, return the asset to its issuer; if that fails, send it to the destination account if it can hold the asset; otherwise stop and state the reason. Trustlines whose reserve someone else sponsored are unwound with the plan saying plainly that the 0.5 XLM returns to that sponsor, not to the user. Accounts that the protocol will refuse to merge because their sequence number has been bumped too far ahead are caught in the plan instead of failing on chain.

> "Every wallet has a support ticket that reads 'I have 4 XLM in this account and I cannot move it.' The answer today is a link to a web form that asks for the secret key and cannot help the accounts that are actually stuck. We wanted the answer to be a function call whose output you can read before you sign, and whose fees come out of the wallet's pocket rather than the user's empty one."
> — the builder

### How It Works

From the integrator's side, a close is a plan you can read and an execution you can watch.

1. **Install and point at testnet.** `npm install dustin @stellar/stellar-sdk`, then configure a testnet Horizon URL. No hosted service, no API key: the SDK talks to Horizon and nothing else.

2. **Plan.** `planClose({ account, destination })` returns a plan object; the CLI (`dustin plan <G...>`) prints it as a table. For the fixture account the plan reads roughly like this (illustrative wording; the committed plan output in the repository is the reference):

   - cancel offer 1 and offer 2, because open offers hold liabilities that block trustline removal;
   - data entry `note`: delete, because a data entry blocks the merge and locks 0.5 XLM;
   - trustline A (dust balance): sell for XLM via path payment, because a trustline cannot be removed while it holds a balance;
   - trustline B (dust balance, no market): return to issuer, because no path to XLM exists;
   - trustline C (sponsored): remove, and note that its 0.5 XLM reserve returns to the sponsor account, not to this account;
   - remove trustlines A, B, C and D once their balances are zero;
   - merge to the destination the user picked;
   - totals: N transactions, fee estimate per transaction, XLM recovered by the user, XLM released to sponsors.

   Nothing is submitted. Running the plan twice gives the same answer.

3. **Confirm.** The wallet shows the plan to the user and asks for an explicit go-ahead. Dustin refuses to execute a plan it did not produce for this exact account state.

4. **Execute.** `executeClose({ plan, signInner, sponsor })` walks the plan transaction by transaction. Each inner transaction is built with the closing account as its source and signed by the user's key through the wallet's existing signer. It is then wrapped in a fee-bump envelope signed by the sponsor (`TransactionBuilder.buildFeeBumpTransaction` in the JavaScript SDK [S4]), submitted, and verified before the next one starts. The CLI prints one transaction hash per step.

5. **Handle what the ladder finds.** Balances that cannot be sold, returned, or forwarded are reported as unclosable with a reason code and a sentence a human can act on. Liquidity pool shares, claimable balances, and multisig thresholds above what a single key can meet are detected and reported, not acted on.

6. **Finish.** The final transaction is the merge. Afterwards the account lookup on Horizon returns not found, the destination holds the recovered XLM, and the hashes open on any public testnet explorer.

> "Our close-account flow was a help-center article that said 'use the explorer's tool'. Half the people who followed it came back because their account could not pay for the first transaction. With Dustin we render the plan, the user taps confirm, and our sponsor account pays the fees. We did not touch our signing code. We did have to write the screen that explains 'unclosable', and we were glad the SDK made us."
> — *Hypothetical* customer quote, written by the builder for this Working Backwards exercise as the reaction of a wallet integrator. No integrator has said this.

### Getting Started

- **Testnet only, no real value.** Create and fund a sponsor account with the testnet friendbot (10,000 test XLM per request [S16]) and export its secret as an environment variable. The account you close needs nothing.
- `npx dustin plan <G...>` prints the plan. `npx dustin close <G...> --to <G...>` executes it, prints one hash per transaction, and exits non-zero if anything was unclosable.
- Read the write-up in the repository for the ordering rules and the known limits, run the test matrix against the fixture builder, watch the 60-second demo, and open the evidence package for the fixture's transaction chain.
- The package name and CLI flags above are the sprint's working names; see Assumptions.

---

## External FAQ

### Q: This is irreversible. How do I know what it will do before it does it?

A: Because the plan is the product. `planClose()` is read-only and returns every step with a reason and a fee estimate before any signature exists; the CLI runs in dry-run mode unless you pass the execute command. The plan states which balances will be sold, which will be returned to the issuer, which will be sent to the destination, what is unclosable and why, how much XLM you get back, and how much goes to other people (sponsors). `executeClose()` only executes a plan that was produced for the account state it observed; if the account changed in between, it stops and asks you to re-plan. And because this scope is testnet only, nothing you close in this release is real value.

### Q: How is Dustin different from StellarExpert's Account Demolisher, LumenWipe, or the other Account Demolisher funded in SCF #44?

A: Honest answer: they do more surface area; Dustin does one narrower thing in a form a wallet can embed and a reviewer can verify.

- **StellarExpert's Account Demolisher** (live since 2019, client code MIT-licensed inside the explorer repository) drops data entries, cancels offers, sells assets, returns leftovers to issuers, removes trustlines, then merges into a StellarExpert mediator account and pays the destination from there [S19, S20]. Its client builds every transaction with your account as source and fee payer, does not use fee-bump transactions, and has no plan step: you paste your secret key into a web form [S20]. The final merge is co-signed by a StellarExpert server endpoint, so the tool cannot be forked and run standalone without replacing that service [S20].
- **LumenWipe** (Apache 2.0, SCF #44 Build award) is a hosted web app with a REST API and a thin SDK client; it covers DeFi position exits, claimable balances, signer normalisation, exchange-safe merges through a mediator, and, since a change merged on 2026-09-08, sponsored fees for reserve-locked accounts through a server-side sponsor key with an operation allow-list and rate limits [S21, S22]. Mainnet and testnet.
- **Account Demolisher (SCF #44, distinct project)** (Apache 2.0) is a web app with dry-run simulation, Soroban token and DeFi coverage, multisig coordination and exchange mediators; testnet is its default network [S23].

Dustin is a library, not a service. The planner and the executor run inside your process; the only network dependency is Horizon; the sponsor key is yours, not a third party's; and the whole thing is small enough to read in an afternoon. It ships with a fixture account that is deliberately hard to close, a test matrix for the cases that break naive implementations (illiquid balances, sponsored trustlines, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required and clawback-enabled trustlines, pool shares), and a recorded run of the existing tool against the same fixture. If you want DeFi exits, exchange mediators or mainnet, use the funded products. If you want a primitive you can call, audit and test, that is what this is.

### Q: My account has 0 XLM spendable. Nothing can submit a transaction from it. Can Dustin really close it?

A: Yes, and this is the case the sprint was built around. A Stellar fee-bump transaction wraps your signed transaction in an outer envelope whose fee is paid by a different account: "This account will incur the fee instead of the source account specified in the inner transaction" [S4]. Your account still signs and still authorises every operation; it just never pays. Dustin wraps every transaction of the close this way, so an account holding exactly its reserve minimum can cancel its offers, dispose of balances, remove its trustlines and merge. The success metric of the sprint is binary: a testnet account with zero spendable XLM, at least three non-zero trustlines, at least one open offer and at least one data entry is fully closed, with every transaction fee-bumped by the sponsor [S1].

### Q: What happens to tokens I cannot sell?

A: They go down a fixed ladder, and the plan tells you which rung applies before you sign. First, sell for XLM with a path payment (strict send: you specify how much of the asset to send [S3]). If no path exists, the asset is sent back to its issuer, which extinguishes it. If that is not possible, it is sent to your destination account, but only if the destination already holds a trustline for the asset with room for the amount. If none of those work, the item is reported as unclosable with the reason, for example: no path to XLM, issuer account no longer exists, trustline frozen by the issuer, or destination has no trustline. The trustline behind an unclosable balance cannot be removed, because the protocol refuses to lower a trustline's limit below its balance [S3], so the account cannot be merged until that reason is resolved.

### Q: What does "unclosable" mean, and what do I do then?

A: It means Dustin has proven, from the account's current state, that no rung of the ladder can legally succeed for that item, and it tells you why. It is a result, not a crash. Common remedies, which the plan spells out per item: the issuer re-authorises a frozen balance, or claws it back when the trustline is clawback-enabled (only a trustline created after its issuer enabled clawback can be clawed back); you add a trustline for the asset (code and issuer) on the destination account and re-plan; for a liquidity pool share you withdraw the pool position first; for an account whose sequence number was bumped too far, you wait until the ledger number the plan prints. By default `executeClose()` will not run a partial teardown when any item is unclosable, because a half-closed account is a surprise the user did not confirm; an integrator can opt in to partial execution, in which case the plan shows what would be recovered now and what stays locked.

### Q: Does this work on mainnet with my real account?

A: No. This release is testnet only, by design and by contract [S1]. Testnet XLM has no value, and the network is reset to genesis two to four times a year [S15], so nothing done there is permanent in the way a mainnet merge is. Mainnet needs three things this sprint deliberately did not fund: production handling of the sponsor key, fee estimation that survives surge pricing, and a decision about which assets are safe to sell automatically with real money on the line. The code paths are the same on both networks, which is why the write-up documents exactly what a mainnet release would have to add.

### Q: Do I have to give Dustin, or anyone, my secret key?

A: Dustin never sees a hosted service. As a library it accepts a signing callback, so a wallet keeps signing exactly the way it already does; the CLI demo, which is the interface for this scope, signs with a key you provide locally. The sponsor key signs only the outer fee-bump envelope and cannot authorise anything on your account. Nothing about your account or your transactions is sent anywhere except Horizon on the network you chose.

### Q: Who pays the fees, and how much are they?

A: The sponsor account pays all of them. The minimum fee on Stellar is 100 stroops per operation (0.00001 XLM) [S7], and a fee-bump must cover the inner transaction's operations plus one more for the wrapper, and be at least the inner transaction's own fee [S4]. For example, a close that needs ten operations in total costs the sponsor at least 1,100 stroops, or 0.00011 XLM, at the minimum rate. The plan prints the estimate per transaction; the executor caps what the sponsor is willing to pay per transaction. On testnet the sponsor is funded by friendbot [S16], so the cost is zero.

### Q: A trustline on my account was sponsored by a wallet. Do I get that reserve back?

A: No, and Dustin says so in the plan rather than letting you find out later. Under sponsored reserves, "any reserve requirements that would normally accumulate on B will instead accumulate on A", the sponsor; when the sponsored entry is removed the sponsor's count goes down and the reserve capacity returns to the sponsor [S5, S6]. You can still remove the trustline yourself, with your own signature, and you must in order to merge; the plan lists the released reserve under "returned to sponsors" instead of "recovered by you".

### Q: I have liquidity pool shares, claimable balances, or a multisig account. Does Dustin handle those?

A: It detects and reports them; it does not act on them in this release [S1]. A pool share trustline locks two base reserves and cannot be removed while it holds shares [S13], so the plan says "withdraw the pool position first" and marks the account unclosable until then. Claimable balances are outside this scope. Multisig accounts whose thresholds cannot be met by the single key you provide are reported with the thresholds and signer weights the plan found, so you know what signatures a close would need.

### Q: Testnet resets. Will the evidence disappear?

A: Testnet is reset to genesis two to four times a year; the next scheduled reset is December 16, 2026, and resets are announced at least two weeks ahead [S15]. A reset clears accounts, transactions and history from Horizon and the explorers. That is why the evidence package does not rely on links alone: it includes the transaction hashes, the signed transaction envelopes and results as captured, the Horizon responses before and after the close, and the 60-second video. Links work until the reset; the captured material works after it.

### Q: Who maintains this after the 30 days?

A: The repository, tests and fixture builder are public and self-contained; anyone can re-run the whole close against a fresh fixture in minutes. The SOW names the likely next steps after the Instaward: continue independently, apply for a follow-on Instaward, or apply to an SCF Build award [S1]. There is no hosted component to keep alive, which is deliberate: a library that works today keeps working as long as Horizon and the JavaScript SDK do.

---

## Internal FAQ

### Q: Why fee-bump, instead of just sending the account 1 XLM first and letting it pay its own way?

A: Three reasons, in order of weight.

1. **Accounting.** A top-up mixes the sponsor's money into the user's balance. At merge time the sponsor's leftover XLM is swept to the user's destination along with everything else, or the flow has to add a "send the change back" step that itself needs a fee. With a fee-bump the sponsor's exposure is exactly the fees it paid, nothing enters the user's account, and the plan's "XLM recovered" number is the user's money and only the user's money.
2. **The protocol was built for this.** Fee-bump transactions are a first-class envelope type whose documented use case is "you're building a service where you want to cover user fees" [S4]. The fee account pays instead of the inner source; the inner transaction is unchanged and keeps the user's signature [S4]. The JavaScript SDK builds them in one call [S4].
3. **It is the differentiator that can be checked.** The existing tool's published client sources and pays every transaction from the account being closed and does not use fee-bumps [S20]; the SOW's success metric requires that every transaction in the close be fee-bumped by the sponsor [S1]. A reviewer can open each hash on the explorer and see the fee account.

What fee-bump does not do: it does not change reserves. Sponsored reserves (CAP-0033) are a separate mechanism about who holds the 0.5 XLM per entry [S5, S6]; Dustin uses fee-bumps for fees and merely accounts for sponsored reserves it finds.

### Q: Why not fix the Demolisher instead of writing a new tool?

A: Because the thing wallets need is a library, and the Demolisher is a view inside a block explorer that depends on a server the maintainers run.

- The public code is a React view plus a transaction builder inside the explorer repository (MIT) [S20]. The builder's final merge goes into a StellarExpert mediator account and is posted to a `/merge` endpoint for the server's co-signature; if the server does not confirm, the client fails with "Failed to obtain merge transaction signature confirmation" [S20]. A fork without that service does not work, and the service is not in the repository.
- The changes Dustin needs are architectural, not patches: a plan phase that returns data before anything is signed; fee-bump wrapping with a sponsor supplied by the caller; sponsored-reserve accounting; a ladder that can end in "unclosable" instead of an exception; and a package boundary so that a wallet imports a function rather than embedding a page. That is a rewrite of the flow with a different shape, and it would land in a product the builder does not operate.
- Evidence. An Instaward is verified by an ambassador with minimal technical expertise in 30 days [S1]. A pull request to a hosted explorer cannot be verified that way; a public package, a fixture account and a video can.
- The SOW's reading of the Demolisher also reports a server-side rule that declines to co-sign a merge paying out less than 1 XLM [S1]. That rule is not visible in the open-source client (the client only computes the payout as the balance minus two base fees [S20]); it is what the recorded baseline run exists to show rather than assert.

The respectful version of "fix it" is what the sprint does: run the existing tool against the same fixture, record where it stops, and link the recording next to Dustin's run.

### Q: Why testnet only?

A: Because the operation is irreversible, the budget is $5,000 and the calendar is 30 days [S1].

- Testnet XLM has no value and the sponsor is funded by friendbot for free, so a bug during development costs nothing [S15, S16]; on mainnet the same bug sells a user's tokens at market.
- Mainnet needs work that is explicitly out of scope: production key management for the sponsor (this scope uses an environment variable), surge-pricing-aware fee estimation, and a policy for which assets may be sold automatically [S1, S7].
- The evidence is stronger on testnet, not weaker: anyone can create an equally messy account with the fixture builder and reproduce the close, which nobody would do with real money.
- The known cost: testnet resets two to four times a year, next on December 16, 2026 [S15], so the evidence package captures envelopes, results and Horizon responses rather than relying on explorer links.

### Q: What exactly happens with illiquid assets, and what does the fixture prove?

A: The ladder is fixed and each rung has a protocol reason for existing.

1. **Path payment to XLM** (strict send [S3]): works only if a path with enough liquidity exists on the testnet DEX. The fixture builder creates the counter-offers for the assets that are meant to be sellable, so this rung is exercised deterministically rather than depending on whatever testnet happens to contain.
2. **Return to issuer:** a payment of the asset to its issuer removes it from circulation; it needs the issuer account to exist and the trustline to be authorised to send.
3. **Send to destination:** only if the destination already holds a trustline for the asset with enough room under its limit; Dustin never creates trustlines on the destination.
4. **Unclosable with reason:** the plan records the rung that failed and why. The two reasons the test matrix is built around are a frozen trustline (an issuer with the revocable flag can reduce authorisation to "maintain liabilities", after which the account "can own offers but cannot do anything else with the asset" [S11]) and a deliberately illiquid asset whose issuer path is also blocked.

The trustline behind an unclosable balance cannot be removed, because `CHANGE_TRUST_INVALID_LIMIT` is returned when "the limit is not sufficient to hold the current balance of the trustline and still satisfy its buying liabilities" [S3]. That same rule is why offers are cancelled first: buying liabilities from open offers block trustline removal even at zero balance.

The fixture proves two different things, and the SOW keeps them separate [S1]: the messy fixture account is closed end to end (its illiquid asset has a reachable rung, return to issuer); and the test matrix proves the unclosable path with a stated reason on cases constructed for it, including a clawback-enabled trustline, where the report tells the user that the issuer can claw the balance back to zero [S12].

### Q: Why is there no smart contract?

A: Because a contract cannot do any of the work and would add a hop.

- Every operation in a close (cancel offer, path payment, change trust, manage data, account merge) is a classic operation on a G account's own entries, authorised by that account's signature [S3]. A Soroban contract cannot sign for a G account, and contract transactions "can only have one operation per transaction" [S14], so the multi-operation teardown would not fit in one anyway.
- Fee sponsorship is a transaction-envelope feature, not a contract feature [S4]. Sponsored reserves are a ledger-level relationship between two classic accounts [S5, S6].
- Contract (C) accounts are out of scope [S1]. Closing a contract account is a different problem with different primitives.
- The SOW's justification for a 30-day scope is exactly that this is classic Stellar work with the JavaScript SDK and no smart contracts [S1].

### Q: What does a wallet need in order to integrate?

A: Six things, none of which is new infrastructure.

1. `npm install dustin @stellar/stellar-sdk` and a Horizon endpoint for the network (testnet in this release).
2. A way to sign the inner transactions with the user's key: Dustin returns unsigned transaction envelopes per step and accepts a signing callback, so the wallet's existing signer (hardware, browser extension, in-app key) is used unchanged. Third-party wallet integration work is out of scope for the sprint, but this is the contract it is designed around [S1].
3. A sponsor: a keypair or a signing callback for the outer fee-bump envelope, plus a per-transaction fee cap. In this scope the CLI reads the sponsor secret from an environment variable [S1].
4. A destination account chosen by the user that already exists. Dustin merges directly to it; it does not run a mediator hop for exchange deposits.
5. A screen that renders the plan and collects an explicit confirmation, and a screen that explains an unclosable item and its remedy. The plan is plain JSON with reason codes precisely so that this is a rendering task.
6. Error handling for the executor's outcomes: completed, stopped at step N with the hash of the last successful transaction, unclosable items, or re-plan required because the account changed.

The integration notes in the repository show the sequence with the CLI as the reference implementation.

### Q: How is the sponsor key secured, and what is its blast radius?

A: Structurally bounded, and the sprint says so instead of promising more than an environment variable delivers.

- **What it can do:** sign outer fee-bump envelopes. It never signs an inner transaction, so it cannot move, sell or merge anything in the user's account; the fee-bump documentation is explicit that the fee account only pays the fee for the inner transaction that already carries its own signatures [S4].
- **What it can lose:** fees. The executor wraps only transactions it built itself for the account named in the plan, refuses inner transactions containing operations outside the close set (cancel offer, path payment, payment to issuer or destination, change trust to zero, manage data delete, account merge), and enforces a fee cap per transaction. The sponsor's balance is the hard ceiling; keep it small.
- **Where it lives:** in this scope, an environment variable on the machine running the CLI, on testnet, funded by friendbot [S1, S16]. Production key management (HSM, signing service, rotation, per-integrator budgets, abuse controls for a hosted sponsor) is explicitly out of scope and named as such in the write-up.
- **What it is not exposed to:** Dustin is a library, so there is no public endpoint anyone can hit to drain the sponsor. A wallet that later hosts a sponsor service inherits that problem, and LumenWipe's shipped design (operation allow-list, single source account, fee cap, rate limits [S21]) is a reasonable reference for it.

### Q: What does "unclosable" mean, precisely, and does `executeClose()` still run the rest?

A: Unclosable is a per-item plan result with a reason code, computed from ledger state, meaning no rung of the ladder can legally succeed for that item right now. Reason codes in the matrix: no path to XLM; issuer unreachable; trustline not authorised to transfer; destination lacks trustline or limit; pool share balance held; sequence number too far ahead (with the earliest ledger at which the merge becomes possible); thresholds not met by the provided key.

The sequence-number case deserves its own line because it is invisible until the merge fails. stellar-core refuses a merge when the account's sequence number is at or above the number a newly created account would receive in the current ledger, which is the ledger sequence shifted left by 32 bits; the source comment reads "don't allow the account to be merged if recreating it would cause it to jump backwards", and from protocol 19 a recorded maximum applied sequence number is checked the same way [S8, S9]. An account that used bump-sequence to a large value therefore cannot be merged until enough ledgers have passed. `planClose()` computes this up front and prints the ledger number after which the merge will be accepted, instead of tearing down trustlines and then failing at the last step.

Default behaviour when anything is unclosable: `executeClose()` does not run at all. The plan shows what a partial run would recover (offers cancelled, data entries removed, empty trustlines removed, all of which make reserves spendable again inside the account) and an integrator can opt in to partial execution explicitly. The account is never left merged-but-not-really; either the merge happens or the account remains a normal account with fewer entries.

### Q: What is the hardest technical problem?

A: Ordering under uncertainty, in the minimum number of transactions, without ever leaving the account in a state the user did not confirm.

Operations inside one Stellar transaction apply in order and the transaction is atomic, which is attractive: cancel offers, dispose, remove trustlines and merge could in principle be one transaction. But path payments can fail on liquidity at submission time, and one failed operation fails the whole transaction. So the planner groups deterministic operations together and isolates the rungs that can fail on market conditions, keeps the merge last and separate so that the sequence-number guard and the "account changed" check can run once more before the irreversible step, and estimates fees per group as operations plus one for the fee-bump wrapper [S4, S7]. The minimum balance itself moves during the close: every removed entry lowers the reserve by 0.5 XLM and open offers selling XLM add selling liabilities to the reserve [S2, S6], so "XLM recovered" has to be computed against the formula, not read off the balance. Getting this right is Deliverable 1's 60 hours [S1].

### Q: Two SCF #44 teams are funded, with far larger budgets, to build "account demolishers". Why does a 30-day, $5,000 library matter?

A: This is the question the builder would rather not be asked, so here is the answer without softening.

- **They validate the problem.** SCF issued an Account Demolisher request for proposals, and two teams were funded against it in round 44 [S22, S23]. Nobody has to argue any more that closing accounts is a real need.
- **They are products; Dustin is a primitive.** LumenWipe's execution logic runs behind its REST API and its SDK is described as a thin client for that API [S21]; the other project is a web application [S23]. A wallet that wants to own the flow, run it in its own process, use its own sponsor and audit the code it ships, has nothing to import from either. That is precisely the 2019 request in the archived wallets repository [S18].
- **Dustin's evidence is narrower and harder.** A public fixture that is deliberately hard to close, a test matrix for the edge cases, and a recorded baseline of the incumbent tool are things a reviewer can re-run. The success metric is binary and public [S1].
- **The risk is real and must be said:** LumenWipe merged hosted fee sponsorship for reserve-locked accounts on 2026-09-08 [S21]. Dustin's zero-XLM claim is therefore not unique in the ecosystem; it is unique as a library you can embed without a third-party service. If that distinction does not matter to integrators, Dustin's best outcome is to be absorbed as the planning-and-execution core of one of the funded products, and the code is licensed and structured so that this is possible.

### Q: What kills this?

A: In order of likelihood.

1. **The fixture closes but the write-up cannot make an ambassador see why it was hard.** Mitigation: the baseline recording of the existing tool against the same fixture, side by side with Dustin's run.
2. **Testnet liquidity.** Path payments need counter-offers; testnet has few. Mitigation: the fixture builder seeds its own market for the sellable assets and uses the issuer rung for the rest.
3. **A testnet reset between the close and the review** [S15]. Mitigation: captured envelopes, results and Horizon responses in the evidence package, plus the video.
4. **Scope creep toward DeFi, exchanges and mainnet** because the competitors have it. Mitigation: the out-of-scope list is in the SOW and repeated in this document; anything not on the deliverables list is a note in the write-up, not code.
5. **The zero-XLM account cannot even be built** as intended. A sponsored account can be created with a zero starting balance [S6], and an account holding exactly its reserve cannot pay a fee [S17]; the fixture builder constructs the state deliberately, so this is a test rather than a hope.

### Q: Is 200 hours realistic, and what gets cut first?

A: The SOW budgets 60 hours for the planner, 80 for the executor and ladder, 40 for the fixture, baseline and test matrix, and 20 for documentation, demo and evidence [S1]. The order of cuts if week three slips: the CLI table rendering is simplified before the plan JSON is; the partial-execution opt-in is documented rather than implemented; the multisig and pool-share reports become "detected, listed" rather than "detected, explained". The success metric (fixture closed, every transaction fee-bumped, account gone from the explorer, chain linked) is not negotiable [S1], and the ladder's unclosable rung is what makes the metric achievable on a hostile fixture, so it is not cut either.

### Q: What do we not know yet, and how will we find out?

- **Whether the whole fixture close fits in the number of transactions the plan claims.** Found out in week two, the first end-to-end close [S1].
- **How the ladder behaves against an issuer that has been merged away.** Constructed in the test matrix by closing a throwaway issuer first.
- **Whether integrators want a signing callback or signed-XDR-in/out.** Both are cheap; the integration notes ask for feedback and the CLI uses the callback.
- **Whether the package name is available on npm.** Checked before publishing in week four; see Assumptions.
- **Whether the existing tool still behaves as the SOW describes** (the under-1-XLM co-sign refusal and the account-pays-all-fees design). The public client confirms the second [S20]; the recorded baseline in week one settles both.

---

## What we are NOT announcing

Mirroring the SOW's out-of-scope list [S1]. None of the following is claimed, demonstrated or partially delivered by this release:

- **Mainnet.** Testnet only; no real value is touched.
- **Contract accounts (C addresses).** Classic G accounts only.
- **Liquidity pool share withdrawal.** Pool share trustlines are detected and reported, not withdrawn.
- **Multisig accounts with raised thresholds.** Detected and reported, not automated.
- **Claimable balance cleanup.**
- **Production key management.** The sponsor uses an environment-variable key for this scope.
- **Wallet UI.** The CLI demo is the interface; integration UI is left to the integrator.
- **Third-party wallet integration work.**

Beyond the SOW list, and stated here so that nobody infers them from the competitor comparison: Dustin does not exit Soroban or DeFi positions, and it does not run a mediator account for exchange deposit addresses; it merges to a destination account the user picks.

---

## The Verdict

**Forged in steel.** The customer problem is concrete and verifiable on chain: reserves locked by entries [S2], merge refused while entries exist [S3], and an account at its minimum unable to pay for the transaction that would free it [S17]. The fee-bump answer is the protocol's own documented mechanism for exactly this [S4]. The plan-before-sign design is the strongest sentence in the press release, and the binary success metric with a public fixture and a recorded baseline makes the sprint reviewable by someone who cannot read the code.

**Needs more heat.** The integration surface (callback shapes, plan schema, reason codes) is described here in prose and must be frozen early in week one so that the write-up and the CLI agree. The partial-execution policy is a design decision the SOW does not make; this document picks "refuse by default, opt in explicitly" and it should be confirmed with the first integrator conversation. The evidence package's independence from testnet resets is a process, not a feature, and needs a checklist in the repository.

**Cracks in the foundation.** Two funded teams are building broader products, and one of them shipped hosted fee sponsorship on the day this press release is dated [S21]. Dustin's defensible position is "embeddable primitive with a test matrix", not "only tool for zero-XLM accounts". Every public sentence should say the first and never the second. The second crack is the Demolisher characterisation: the client-side facts are verified [S20]; the server-side co-sign threshold was confirmed behaviourally on 2026-09-25 by a black-box probe of the testnet co-sign endpoint (payouts of 0.5 and 0.9999999 XLM were rejected with HTTP 400 "Transaction is invalid", payouts of 1 and 5 XLM were signed), see docs/analysis/competitive-landscape.md; the server code stays private, so the rule is inferred from behaviour, and it must still be shown in the baseline recording rather than asserted.

<!-- coaching-notes (consolidated, headless run 2026-09-25)
concept type: open-source developer library funded by a $5,000 Stellar Instaward; non-commercial framing used throughout (adoption path, maintenance burden, sustainability instead of unit economics).
rejected headline framings: "the only tool that closes zero-XLM accounts" (false since LumenWipe PR 216, merged 2026-09-08); "Account Demolisher, done right" (adversarial and unverifiable); "reclaim your locked lumens" (mainnet promise the scope cannot keep).
competitive intelligence: SCF #44 Account Demolisher RFP; LumenWipe (Apache 2.0, hosted API + thin SDK client, fee-bump endpoint with allow-list/rate limits, mainnet+testnet); second Account Demolisher project (Apache 2.0, web app, dry-run simulations, DeFi, multisig, testnet default). StellarExpert Demolisher: MIT client in explorer repo, source = closing account, fee = base fee, merge via StellarExpert mediator co-signed by /merge endpoint, secret key pasted in form, no fee-bump.
requirements signals: plan JSON with reason codes; signing callback; sponsor callback + fee cap; refuse-by-default on unclosable with explicit partial opt-in; re-plan on account change; evidence package must capture envelopes/results/Horizon snapshots (testnet reset 2026-12-16).
protocol facts verified: base reserve 0.5 XLM; min balance 2 base reserves; pool share trustline 2 base reserves; fee min 100 stroops/op; fee-bump min = (ops+1) x base and >= inner fee; merge refused if seqNum >= ledgerSeq<<32 (plus maxSeqNumToApply from protocol 19); ACCOUNT_MERGE_IS_SPONSOR when numSponsoring != 0; sponsored entry removal decrements numSponsoring/numSponsored; CHANGE_TRUST_INVALID_LIMIT blocks removal with balance or buying liabilities; contract txs are single-operation.
open questions: npm package name; transaction count for the fixture; behaviour against merged-away issuer; callback vs XDR interface preference.
-->

## Assumptions

1. **Press release date.** The SOW gives a suggested sprint start of 2026-08-09 and a 30-day scope; the press release is dated September 8, 2026 as the last day of that window. If the sprint started later, the date moves with it.
2. **Package name.** The npm package is referred to as `dustin`. Availability of that name on npm was not checked; the published name may differ.
3. **CLI surface and function signatures.** `dustin plan`, `dustin close --to`, the `DUSTIN_SPONSOR_SECRET` environment variable, and the parameter shapes `planClose({ account, destination })` and `executeClose({ plan, signInner, sponsor })` are illustrative working names derived from the SOW's function names; the repository is the reference.
4. **Fixture reserve arithmetic.** "4 XLM locked, 0 spendable" is an illustration computed from the documented reserves (1 XLM base plus 0.5 XLM for each of three trustlines, two offers and one data entry); the sponsored trustline's reserve sits on the sponsor. The real fixture's numbers are in the committed plan output. Selling liabilities from offers that sell XLM would raise the minimum further.
5. **Fee example.** "Ten operations, at least 1,100 stroops" is arithmetic from the documented minimum base fee and the fee-bump rule, not a measured cost of the fixture close.
6. **Transaction grouping and partial execution policy.** "Isolate market-dependent rungs, merge last and separate" and "refuse to execute when any item is unclosable unless the integrator opts in" are design decisions made in this document; the SOW requires minimum grouping and unclosable-with-reason reporting but does not specify either policy.
7. **Demolisher server behaviour.** The under-1-XLM co-sign refusal and "live since 2019" come from the SOW and from the 2019 issue that references the tool; the open-source client confirms account-as-fee-payer, no fee-bump, mediator merge and server co-signature, but the server code is not public. The baseline recording is the evidence for the server-side claims.
8. **Competitor scope.** Statements about LumenWipe and the second Account Demolisher project reflect their public README, pull request and SCF submission text as read on 2026-09-25; features may have changed since. Award amounts are deliberately omitted because public records disagree.
9. **Licence.** The SOW does not name a licence for Dustin; the document assumes a permissive open-source licence consistent with "public repository" and "reuse by another team".
10. **Destination semantics.** Dustin merges directly to a user-chosen existing account and does not implement a mediator hop for exchanges; the SOW says "merges to a destination the user picks" and does not mention mediators.
11. **Funding attribution.** The document names the program (Stellar Instawards, $5,000, 30 days) and refers to "the builder"; SOW contact details are intentionally not reproduced.

## Sources

Protocol facts were retrieved on 2026-09-25 through the Stellar developer documentation index (Raven MCP) and direct fetches of the pages and files below. Nothing in this document relies on an unverified number; where a claim rests on the SOW alone, it is marked as such above.

- [S1] Statement of Work: `SUCCESSFUL_SOW.md` at the repository root (accepted Stellar Instaward SOW for Dustin: problem statement, deliverables, budget, success metric, out-of-scope list, evidence plan).
- [S2] Lumens, base reserve and minimum balance: https://developers.stellar.org/docs/learn/fundamentals/lumens ("One base reserve is currently 0.5 XLM"; "minimum balance of two base reserves (currently 1 XLM)"; subentries are trustlines, offers, signers and data entries; sponsorship can cover an account's own reserves).
- [S3] List of operations (Account Merge preconditions and result codes, Change Trust and `CHANGE_TRUST_INVALID_LIMIT`, Manage Data deletion, offer deletion with amount 0, Path Payment Strict Send, sponsorship operations): https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- [S4] Fee-bump transactions guide (fee account pays instead of the inner source; minimum fee for inner operations plus one; use case "cover user fees"; `TransactionBuilder.buildFeeBumpTransaction`): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- [S5] Sponsored reserves guide (reserves accumulate on the sponsor; counters decrease when a sponsored entry is removed; revocation at the sponsor's discretion): https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- [S6] CAP-0033 Sponsored Reserves (minimum balance formula `(2 + numSubEntries + numSponsoring - numSponsored) * baseReserve + liabilities.selling`; `ACCOUNT_MERGE_IS_SPONSOR`; zero starting balance for sponsored accounts): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- [S7] Fees, resource limits and metering (inclusion fee = operations x effective base fee; effective base fee cannot be lower than 100 stroops per operation): https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
- [S8] stellar-core `MergeOpFrame.cpp` (`isSeqnumTooFar`: "don't allow the account to be merged if recreating it would cause it to jump backwards"; `ACCOUNT_MERGE_HAS_SUB_ENTRIES` when `numSubEntries != signers.size()`; protocol 19 `maxSeqNumToApply` check): https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp
- [S9] stellar-core `TransactionUtils.cpp` (`getStartingSequenceNumber` = ledger sequence shifted left by 32 bits): https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionUtils.cpp
- [S10] Horizon result codes for Account Merge (`ACCOUNT_MERGE_SEQNUM_TOO_FAR`: "Source account sequence number is too high"): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- [S11] Controlling access to an asset (authorization required, revocable, `AUTHORIZED_TO_MAINTAIN_LIABILITIES`: "can own offers but cannot do anything else with the asset"): https://developers.stellar.org/docs/tokens/control-asset-access
- [S12] Clawbacks guide (`AUTH_CLAWBACK_ENABLED` makes subsequent trustlines clawback-enabled): https://developers.stellar.org/docs/build/guides/transactions/clawbacks
- [S13] Liquidity pools (pool share trustlines require 2 base reserves; authorisation derived from the underlying asset trustlines): https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools
- [S14] Operations and transactions (smart contract transactions "can only have one operation per transaction"): https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions
- [S15] Networks (Testnet has no real value; resets 2 to 4 times per year at 17:00 UTC, announced at least two weeks ahead; scheduled reset December 16, 2026): https://developers.stellar.org/docs/networks
- [S16] Example application overview (Friendbot funds testnet accounts with 10,000 XLM): https://developers.stellar.org/docs/build/apps/example-application-tutorial/overview
- [S17] Horizon `transaction_failed` ("The source account for transaction cannot pay the minimum fee"): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/transaction-failed
- [S18] "Add helper that closes a user's account", stellar/js-stellar-wallets issue 98 (opened 2019-08-12, open, no comments; repository archived 2024-02-08; references the demolisher tool): https://github.com/stellar/js-stellar-wallets/issues/98
- [S19] StellarExpert Account Demolisher (hosted tool): https://stellar.expert/demolisher/public/
- [S20] StellarExpert explorer repository (MIT licence; files `business-logic/demolisher/demolisher-tx-builder.js` and `views/demolisher/account-demolisher-view.js`: closing account as source with `fee: baseFee`, steps drop data entries, drop offers, sell assets, return to issuers and drop trustlines, merge to mediator then pay destination; `/merge` endpoint co-signature; payout = balance minus two base fees; secret key pasted into the form; "Absolutely free, you pay only for transaction fees"): https://github.com/stellar-expert/stellar-expert-explorer
- [S21] LumenWipe repository (Apache 2.0; steps; `@lumenwipe/sdk` thin API client; dry-run plan) https://github.com/LumenWipe/lumenwipe and pull request 216 "sponsor the fee of a wind-down transaction for reserve-locked accounts" (CAP-15 fee-bump with a server-side sponsor key, operation allow-list, fee cap, rate limits; merged 2026-09-08): https://github.com/LumenWipe/lumenwipe/pull/216
- [S22] LumenWipe SCF #44 submission ("responds to the Account Demolisher RFP"; sponsored fees for reserve-locked accounts; REST API and TypeScript SDK; Apache 2.0): https://communityfund.stellar.org/submissions/recuKWaSdUL8Lkw9o
- [S23] Account Demolisher SCF #44 submission (Apache 2.0 web application; dry-run with simulations; Soroban and DeFi coverage; mediator merges; multisig coordination; testnet-first tranche plan): https://communityfund.stellar.org/submissions/recqvIs2iRu34ESGo
