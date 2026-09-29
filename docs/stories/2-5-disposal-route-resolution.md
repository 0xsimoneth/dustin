# Story 2.5: Live disposal-route resolution in the planner

Status: done

## Story

As an integrator,
I want the plan to say, for every leftover balance, which ladder route will be used and why,
so that the user can read what happens to their dust before they sign anything.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 2.5):

1. AC-E2-S5-1: Given LIQ with a market, then the dispose step has `route: "path-payment"`, the quoted destination amount, the path assets and the reason text.
2. AC-E2-S5-2: Given RET (no path, issuer exists, trustline authorized), then `route: "issuer-return"` with the reason "no DEX path found; returning the balance to the issuer burns it".
3. AC-E2-S5-3: Given ILQ (no path, issuer does not exist) and a destination that trusts ILQ, then `route: "destination-transfer"`; given a destination that does not trust ILQ, then `route: "unclosable"`, `plan.closable` is false, and the reason lists all three failed routes with the remediation "the issuer no longer exists, so no new trustline for ILQ can be created; choose a destination that already trusts ILQ".
4. AC-E2-S5-4: Given a non-zero trustline with `is_authorized` false or authorized-to-maintain-liabilities only, then `route: "unclosable"` with the reason "trustline is not authorized to send, not even to the issuer; only the issuer can re-authorize it or claw the balance back".
5. AC-E2-S5-5: Then route resolution issues only GET requests (the E1-S6 dry-run test still passes), and the fixture plan snapshot is updated with resolved routes.

This record was written after the fact. Route resolution was built before this story, in two earlier stories whose records say so:

- E1-S3 put the quotes and the facts about issuers and the destination into the snapshot.
- E1-S4 added the step that picks a rung for each balance.

No code was written for E2-S5. Each AC is checked below against the code, the tests and the committed evidence at commit 9d1b422.

The ACs name the assets of the epics' fixture recipe (LIQ, RET, ILQ). The messy fixture follows the recipe in `docs/edge-cases-and-test-matrix.md` section 5.2 instead:

- DUSTA has a market maker's bid, so it plays LIQ.
- DUSTB and SPTA have no market and a live issuer, so they play RET.
- DUSTC has no market, and the destination holds an authorized DUSTC trustline.

No fixture asset has a merged issuer, as ILQ does: canonical decision 3 keeps every `messy` balance disposable.

Deviations that apply to every AC:

- **Names.** The step carries its rung in `disposal.rung`, as `path_payment`, `return_to_issuer` or `send_to_destination` (`DisposalRung` in `src/plan/model.ts`). There is no `route` field and no `path-payment`, `issuer-return` or `destination-transfer` value.
  - The rung names are those of PRD section 7 and the PRD glossary.
  - Some field names differ from PRD section 7; the SDK keeps them, by the builder's decision on review item AA-11. `quotedXlm` stands for `estimatedXlmOut`, and the path is in `operation.path`, not `disposal.path`.
- **Unclosable balances are items, not steps.** A balance that cannot be disposed of goes into `plan.unclosable[]`, with an `UnclosableCode`, a `reason`, a `remedy` and `blocksMerge: true`. It gets no dispose step, its trustline is kept, and the plan has no merge step.
- **`plan.closable` is `plan.status`.** The status is `"closable"`, `"partial"` or `"blocked"` (`PlanStatus`, as in PRD section 7). "`closable` is false" reads as any status other than `"closable"`; a plan with an unclosable item and no blocker is `"partial"`.
- **Reason strings.** A dispose step's `reason` first gives why each rung tried before the chosen one was ruled out, then says what the step does. An unclosable item splits the AC's single reason into `reason` and `remedy`. The wording differs from the ACs, but the facts each AC asks for are there, as shown below.

How each AC is met, and the tests that prove it. The tests run offline, on the Horizon JSON recorded from fixture `messy-20260926T035942Z` (`test/fixtures/horizon/messy/`), unless a test says otherwise.

- **AC-1: met, as a documented deviation (names and field locations).**
  - Code:
    - `inspectAccount()` (`src/inspect/inspect.ts`) calls `GET /paths/strict-send` for every trustline that has a balance and is authorized. The query sells the full balance (`source_amount`) for `destination_assets=native`; `strictSendToNativePath()` in `src/reader/ledger-reader.ts` builds it.
    - `bestQuote()` keeps the answer that yields the most XLM (`destination_amount`), provided it is at least 1 stroop.
    - `evaluatePathPayment()` (`src/plan/ladder.ts`) rejects the quote if one of the account's own offers could fill a step of the path (edge case B-24). Otherwise it sets `destMinXlm` to the quote minus the slippage: 100 bps by default, rounded up, never below 1 stroop.
    - `disposal()` (`src/plan/order.ts`) writes the step:
      - `disposal.rung: "path_payment"`;
      - `disposal.quotedXlm` (the quoted destination amount) and `disposal.destMinXlm`;
      - `operation.path` (the path assets of the quote);
      - the reason "Sell the full <amount> <code> for about <quote> XLM (at least <minimum>) with a strict-send path payment to this account; ...".
  - Tests:
    - `test/unit/plan/ladder.test.ts`: "sells DUSTA by path payment to the account itself with destMin below the quote", "never lets destMin fall below one stroop" and "does not trust a quote that may run through the account's own offer".
    - `test/unit/plan/review-e1.test.ts`: "rounds the slippage up so destMin sits below a dust quote".
    - `test/unit/plan/dry-run.test.ts`: "produces the committed plan for the recorded fixture at a fixed 100-stroop base fee". Its snapshot holds step S10 with the rung, `quotedXlm` 0.0000007, `destMinXlm` 0.0000006, `operation.path` `[]` and the reason.
    - `test/unit/plan/plan.test.ts`: "keeps the fixture's reasons stable".
    - `test/unit/inspect/inspect.test.ts`: "collects the facts the ladder and the merge checks need", which checks the DUSTA quote and that DUSTB and SPTA have none.
    - `test/unit/cli/plan-command.test.ts`: "prints the fixture plan and exits 0".
    - `test/unit/plan/properties.test.ts`: "hold for 600 seeded accounts, including partial and blocked ones". Some generated quotes pass through one intermediate asset. For every planned sale, `destMin` lies between 1 stroop and the quote, and no step of the path could use one of the account's own offers.
  - Evidence:
    - `evidence/plan/fixture-plan.txt` line 44: `S10  tx 2  sell 0.0000007 DUSTA for XLM: path payment, quote 0.0000007, at least 0.0000006`
    - `evidence/plan/fixture-plan.json` lines 391, 394, 395 and 421: `"rung": "path_payment"`, `"quotedXlm": "0.0000007"`, `"destMinXlm": "0.0000006"`, `"path": []`
  - Deviations:
    - The text plan prints the quote and the minimum, but not the intermediate assets; only the JSON has them.
    - The technical note asks for the XLM to go to the destination account. The code sends it to the closing account itself, and it then leaves with the merge (architecture section 4.4, day-1 experiment 14). Review finding AA-14 leaves this open for E3-S1.
  - Not covered by a test. The fixture's direct bid meets the AC's given, so these cases lie outside it:
    - A quote through intermediate assets that ends up in `operation.path`. `review-e1.test.ts` "keeps market data out of the plan hash, including the quoted path" sets such a path, but checks only the hash.
    - `bestQuote()` choosing among several answers, or skipping one below 1 stroop.

- **AC-2: met, as a documented deviation (name and wording).**
  - Code:
    - `evaluateIssuer()` (`src/plan/ladder.ts`) makes rung 2 possible for any authorized trustline. The one exception is an issuer that requires a memo (SEP-29) when no memo was given.
    - `disposal()` writes `disposal.rung: "return_to_issuer"`, with `disposal.to` set to the issuer.
    - It also writes a payment of the whole balance to the issuer.
    - The reason starts with the reason rung 1 was ruled out: "Horizon found no strict-send path to XLM for the full balance. Pay the <amount> <code> back to its issuer <G...>, which burns it."
  - Tests:
    - `ladder.test.ts`: "returns DUSTB and SPTA to the issuer because no path exists" (rung, target, rung 1 ruled out).
    - `test/unit/plan/order.test.ts`: "orders offers, cleanup pairs, data, the path payment pair, then the merge".
    - `plan.test.ts`: "keeps the fixture's reasons stable" (steps S03, S05 and S07 word for word).
    - The `dry-run.test.ts` snapshot, with each rung's `ruledOut` reasons.
    - `plan-command.test.ts`: "prints the fixture plan and exits 0" (`return 0.0000003 DUSTB to issuer`).
  - Evidence: `evidence/plan/fixture-plan.txt` lines 22 to 24:

    ```
    S03  tx 1  return 0.0000003 DUSTB to issuer GDC7...LQEB (burn)
               why: Horizon found no strict-send path to XLM for the full balance. Pay the 0.0000003 DUSTB back to its
               issuer GDC7DOSJT6AIQ74S3T4XQ3YKGDSTNOEXUDJPC36ZMYFBYXD2CG5YLQEB, which burns it.
    ```

    and `evidence/plan/fixture-plan.json` line 129: `"rung": "return_to_issuer"`.
  - Deviations:
    - The rung is called `return_to_issuer`, not "issuer-return".
    - The reason states both of the AC's facts in other words: there is no path to XLM, and paying the issuer burns the balance.
    - The code does not check that the issuer exists (see AC-3). RET's issuer exists, so the result is the same.

- **AC-3: met as a documented deviation for the choice of route.**
  - Why it deviates. The AC assumes that a payment to an issuer whose account was merged away fails; the technical spike expected `op_no_destination`. Day-1 experiment 4 disproved this on testnet on 2026-09-26:
    - The payment succeeded and burned the balance (burn `cbb400ba4d715ac58447e74b3be10ef4d8ca58ce2f477d60d5bda38f05a3f0c9`).
    - The emptied trustline was then deleted.
    - Only creating a new trustline to the merged issuer fails, with `op_no_issuer` (`571db84a8c10b79628224c72999f56f730593e85c6f39e095da33a3e41ee0f91`).
  - Two decisions in `docs/README.md` override the AC's premise:
    - Open question 3 records the experiment's result.
    - Canonical decision 8 sets the order. The destination transfer comes before the burn only with `--prefer-destination` (SDK `preferDestination: true`, approved 2026-09-25). Otherwise it is used only when the burn is impossible.
  - So, in each case:
    - **ILQ, destination trusts it, default order.** The balance is burned (`return_to_issuer`). `send_to_destination` stays in `disposal.fallbackRungs`, and the reason adds "The issuer account no longer exists; a payment to it still burns the balance (verified on testnet, 2026-09-26)."
    - **The same, with `--prefer-destination`.** The balance goes to the destination (`send_to_destination`), with `return_to_issuer` as the fallback.
    - **ILQ, destination does not trust it.** The balance is burned (`return_to_issuer`) and the plan stays `closable`. The AC's remediation text never appears, because nothing needs a remedy.
    - **When the ladder leaves a balance unclosable.** Only when all three rungs fail:
      - Horizon finds no path worth at least 1 stroop;
      - the return to the issuer is refused, in practice because the issuer requires a memo and no `--memo` was given;
      - the destination is missing, is the account itself, requires a memo that was not given, or has no authorized trustline for the asset with room for the balance.
    - The unclosable item then has:
      - code `NO_DISPOSAL_ROUTE`;
      - `rungsRuledOut` with all three rungs and why each failed;
      - the reason "No route disposes of <amount> <code>: path payment: ...; return to issuer: ...; send to destination: ...";
      - a remedy that names the three ways to open a route.
    - The plan is then `partial`, with no merge.
  - Code:
    - `src/plan/ladder.ts`: `chooseRung()`, `LADDER_ORDERS`, `evaluateIssuer()` and `evaluateDestination()`. `evaluateIssuer()` reads whether the issuer requires a memo, never whether it exists.
    - `src/plan/order.ts`: the sentence about a merged issuer in `disposal()`, and the `NO_DISPOSAL_ROUTE` item in `orderClose()`.
  - Tests:
    - `ladder.test.ts` "still burns when the issuer account was merged away (day-1 experiment 4)". This is the AC's second case: DUSTB has no path, its issuer is gone, and the destination has no DUSTB trustline. The rung is `return_to_issuer`.
    - `ladder.test.ts` "keeps the SOW order for DUSTC but sends it to the destination with prefer-destination". The destination trusts the asset. By default the rung is `return_to_issuer`, with fallback `send_to_destination`. With `prefer-destination` it is `send_to_destination`, with fallback `return_to_issuer`.
    - `ladder.test.ts` "rules out a memo-required issuer without a memo and falls to the destination or unclosable". DUSTC falls to `send_to_destination`, DUSTB becomes `NO_DISPOSAL_ROUTE`, and giving a memo brings the burn back.
    - `ladder.test.ts` "checks the destination trustline's authorization and room".
    - `review-e1.test.ts` "never picks the account itself as a destination for a balance".
    - `properties.test.ts`, as above:
      - whenever there is an unclosable item and no blocker, the status is `partial` and there is no merge;
      - every unclosable item has a reason and a remedy;
      - the generated accounts reach `NO_DISPOSAL_ROUTE`.
  - Evidence:
    - None for ILQ, because the messy fixture has no merged issuer.
    - DUSTC, whose issuer exists, shows what the default order does when the destination trusts the asset. See `evidence/plan/fixture-plan.json`, line 211 (`"rung": "return_to_issuer"`) and lines 214 to 215 (`"fallbackRungs": [ "send_to_destination" ]`).
    - The ILQ plans, with a destination that trusts it and one that does not, are E3-S7's evidence (AC-E3-S7-1).
  - The two parts that had no direct test are now covered by `test/unit/plan/route-resolution.test.ts` (2026-09-28), through the whole planner (`planFromSnapshot`):
    - "burns by default, keeps the destination as the fallback and says the issuer is gone" and "sends the balance to the destination with prefer-destination, the burn as the fallback": the AC's first case, a merged issuer with a destination that trusts the asset, including the reason's sentence about the merged issuer.
    - "lists every rung and why it failed, in the reason and in rungsRuledOut": a `NO_DISPOSAL_ROUTE` item names all three rungs in order, each with its reason, and the plan is `partial` with no merge.
    - A mutation check showed they fail when the merged-issuer sentence or the 1-stroop filter is removed.

- **AC-4: met, as a documented deviation (unclosable item instead of a route, and wording).**
  - Code: `chooseRung()` handles a trustline whose `authorized` is false before it tries any rung:
    - The code is `MAINTAIN_LIABILITIES_ONLY` when `authorizedToMaintainLiabilities` is true, and `TRUSTLINE_NOT_AUTHORIZED` otherwise.
    - The reason is "Issuer <G...> has not authorized the <code> trustline (or revoked it), so the balance of <amount> <code> cannot be sent anywhere, not even back to the issuer." For the maintain-liabilities case it says instead that the issuer "has limited the <code> trustline to maintaining liabilities".
    - The remedy is "Ask the issuer <G...> to authorize the trustline again (SetTrustLineFlags) or to claw the balance back, then run the plan again."
  - `orderClose()` then records an unclosable item:
    - no dispose step and no removal of that trustline;
    - no merge, and the status is `partial`;
    - offers on that asset are still cancelled.
  - Related behaviour:
    - The inspector asks Horizon for no path for such a trustline.
    - An unauthorized trustline with a zero balance is removed as usual, which fits the AC's word "non-zero".
    - Horizon shows both flags true on an authorized line (see the recorded fixture) and both false on a frozen one (day-1 experiment 13). So `is_authorized` being false is what decides.
  - Tests:
    - `ladder.test.ts` "reports a deauthorized trustline as unclosable, naming the issuer" (the code, the issuer in the reason, a remedy about authorizing or clawing back).
    - `ladder.test.ts` "distinguishes authorized-to-maintain-liabilities".
    - `order.test.ts` "reports a frozen balance, keeps the rest of the cleanup and drops the merge" (status `partial`, no merge, the DUSTB trustline kept, the offer buying DUSTB still cancelled).
    - `order.test.ts` "removes a zero-balance trustline even when it is not authorized".
    - `inspect.test.ts` "detects pool shares, sponsoring with claimable balances, SEP-29 and a frozen trustline" (no path request for the frozen line).
    - `plan-command.test.ts` "exits 0 for a partial plan too, and shows the unclosable item" (`PARTIAL`, `TRUSTLINE_NOT_AUTHORIZED`, `remedy:`).
    - `properties.test.ts` reaches both codes.
  - Evidence: none in `evidence/plan/`. Every `messy` balance is authorized; the frozen trustline belongs to the `edge` fixture (E3-S6). Day-1 experiment 13 observed the behaviour on testnet:
    - A payment to the issuer fails with `op_src_not_authorized`, both from a deauthorized line (`a50947b27138d1cc9f0885b5ce5699d75c58f05386b30206c600b0099d26c6da`) and from a line authorized only to maintain liabilities.
    - `changeTrust "0"` fails with `op_invalid_limit` while a balance remains.
    - After the issuer clawed the balance back, the empty line was deleted (`d324ca3f66dab12e14de56e2b69a9964a35452b6bd7ca0893f73a76081876edf`).
  - Deviations:
    - The result is an unclosable item with a code, not `route: "unclosable"`.
    - The AC's single reason is split in two. `reason` says the balance cannot be sent anywhere, not even back to the issuer. `remedy` says the issuer can re-authorize the trustline or claw the balance back.
    - The tests check only that the reason names the issuer and that the remedy matches a pattern; they do not pin the full text.

- **AC-5: met.**
  - Why only GET requests are possible:
    - Route resolution reads Horizon through `LedgerReader` (`src/reader/ledger-reader.ts`), which has no method that signs or submits.
    - `LedgerReader` runs on `horizonJson()` (`src/reader/horizon-json.ts`), whose only method is `get`.
    - Choosing the rungs and ordering the steps uses only the snapshot, with no network access (`planFromSnapshot()`, `src/plan/plan.ts`).
    - The ESLint rule from E1-S6 forbids `src/plan`, `src/inspect` and `src/reader` to import any code that signs, builds or submits transactions.
  - Tests:
    - `dry-run.test.ts` "planClose makes GET requests only and never touches a submission endpoint". This is the E1-S6 test, and it passes at 9d1b422. Every request `planClose()` makes on the recorded fixture is a GET, including the four strict-send path requests, and none goes to `/transactions`.
    - `inspect.test.ts` "makes GET requests only, and exactly these" checks the exact list of requests, which includes four `/paths/strict-send`.
    - `plan-command.test.ts` "never reads a secret from the environment and only sends GET requests".
    - Testnet tier: `test/testnet/plan-readonly.test.ts` "plans a closable close and leaves the account untouched" checks that the sequence number and the subentry count do not change. It last ran live for E1-S6.
  - Snapshot and evidence:
    - The committed snapshot (`test/unit/plan/__snapshots__/dry-run.test.ts.snap`) and the committed plan (`evidence/plan/fixture-plan.json` and `.txt`) show resolved routes for all four balances: DUSTA `path_payment` with its quote, and DUSTB, DUSTC and SPTA `return_to_issuer`.
    - Nothing needed updating. Route resolution moved into E1-S3 and E1-S4, so no plan ever showed `route: "pending-resolution"`; AC-E1-S4-7 was superseded the same way. The first committed plan (b8fbb19) already had the routes.
    - The committed plan's hash covers every rung and its target: `plan hash 25be835c88e84af36e96e17fa00fcbf465f6f39a7c6075deab940106eff38c85` (`fixture-plan.txt` line 73). The snapshot has the same hash, and the planner at 9d1b422 produces it again from the recorded fixture.
  - Evidence lines in `fixture-plan.txt`:
    - line 4: `Dustin plan  (dry run: nothing is signed, nothing is submitted)`
    - lines 22, 28, 34 and 44: the four routes.
  - Note: the evidence was captured on 2026-09-26 at commit 47218a6. Two things were added to the output later, and neither changes a route:
    - the `options` block in the plan JSON (E2-S3);
    - the `Budget` line in the text plan (review finding R2).

    `npm run evidence:plan` regenerates both files in the current format; it needs network access.

The two AC-3 tests (Tasks 5 and 6) were added on 2026-09-28 in `test/unit/plan/route-resolution.test.ts`, together with two of the optional task 7 cases, so every AC is met or met as a documented deviation with a test.

## Tasks / Subtasks

- [x] Task 1: map every AC to the code that implements it; the code was written in E1-S3 and E1-S4 (AC: 1-5)
- [x] Task 2: find the tests that prove each AC, and run the offline tests at commit 9d1b422 (AC: 1-5)
- [x] Task 3: check the committed plan evidence for resolved routes (AC: 5)
- [x] Task 4: evaluate the deviations: the names, the reason wording, `plan.closable`, and AC-3's assumption about a merged issuer (AC: 1-4)
- [x] Task 5: test that a `NO_DISPOSAL_ROUTE` item names all three failed rungs, in `reason` and in `rungsRuledOut` (AC: 3)
- [x] Task 6: test a merged issuer with a destination that trusts the asset (AC: 3). By default the balance is burned, with `send_to_destination` as the fallback and the sentence about the merged issuer in the reason; with `preferDestination` it goes to the destination.
- [ ] Task 7 (optional, not required by an AC):
  - [x] test a quote through intermediate assets that ends up in `operation.path` ("keeps the answer that pays the most XLM, skips one below a stroop, and plans its path");
  - [x] test that `bestQuote()` picks the answer with the most XLM and skips one below 1 stroop (same test, and "treats answers that all round to zero as no path, so the balance goes to its issuer", which is also AC-E3-S1-3's planner side);
  - [ ] pin AC-4's unclosable reason texts in a snapshot.

## Dev Notes

- **Where the work was done:**
  - E1-S3 made the snapshot carry what the ladder needs:
    - one strict-send quote for each trustline that has a balance and is authorized;
    - for each issuer of a balance, whether it exists and whether it requires a memo;
    - for the destination, whether it exists, whether it requires a memo, and its trustlines.
  - In E1-S4, `chooseRung()` picks the rung. The plan records:
    - the order used (`plan.ladderOrder`);
    - the chosen rung;
    - the other rungs that would also work (`fallbackRungs`);
    - why each remaining rung was ruled out (`ruledOut`).
  - E1-S5 gives each path payment, with its trustline removal, a transaction of its own.
  - E2-S3: when a sale fails on the market, the executor's new plan moves that balance down the ladder (`withPathsOnlyFor()`).
  - E3-S1 and E3-S2 carry out the ladder on testnet.
- **Ladder order.** Canonical decision 8 follows the SOW (Deliverable 2): "sell via path payment first, send back to the issuer if there is no path, send to the destination account if it holds the trustline, and report the item as unclosable with a stated reason if none of those work". `--prefer-destination` swaps the last two rungs.
- **The story's technical notes, compared with the code:**
  - Route 1, the path payment:
    - It uses `GET /paths/strict-send` (https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths) with `destination_assets=native`, and ignores any answer below 1 stroop.
    - The sale pays the closing account itself. stellar-core has no rule against `destination == source` (https://github.com/stellar/stellar-core/blob/master/src/transactions/PathPaymentOpFrameBase.cpp), and day-1 experiment 14 did it on testnet (`45bcddf5b0492f2e4f6e99b71bf89ac5bfffdddcccfe251cdd8b4e3c49f25aaa`).
    - A quote asked for in the same ledger that created the bid can come back empty (day-1 experiment 6). The plan therefore records the ledger its quotes were read at (`observed.ledger`).
  - Route 2, the return to the issuer:
    - The note says the issuer account must exist. Day-1 experiment 4 and open question 3 replace this: an authorized trustline held by the account is enough.
    - Paying an asset back to its issuer burns it (https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets).
    - An issuer that requires a memo (SEP-29, https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md) rules route 2 out when `--memo` is not given. The SDK's `submitTransaction` checks the destination of every payment, path payment and merge, and throws `AccountRequiresMemoError` (https://github.com/stellar/js-stellar-sdk/blob/main/src/horizon/server.ts). Day-1 experiment 10 saw this for a merge.
    - A 404 during that check is skipped, so a merged issuer does not trip it.
    - Deleting a trustline does not need the issuer to exist; creating one does (https://github.com/stellar/stellar-core/blob/master/src/transactions/ChangeTrustOpFrame.cpp).
  - Route 3, the transfer to the destination. The destination must:
    - exist;
    - be neither the account nor the issuer;
    - not require a memo that was not given;
    - hold an authorized trustline for the asset with room (`limit - balance - buying liabilities`) for the whole balance.

    These checks prevent the payment errors `NO_TRUST`, `NOT_AUTHORIZED` and `LINE_FULL` (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations).
  - Route 4, unclosable. The reason lists why every rung failed. The remedy is one fixed sentence naming the three ways to open a route; it is not tailored to the particular failures.
  - Source authorization. The protocol checks the sender's trustline whatever the destination. A balance whose trustline is unauthorized, or authorized only to maintain liabilities, therefore cannot be burned by its holder. Sources:
    - https://github.com/stellar/stellar-core/blob/master/src/transactions/PathPaymentOpFrameBase.cpp
    - CAP-0018: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0018.md
    - https://developers.stellar.org/docs/tokens/control-asset-access
    - day-1 experiment 13
- **The account's own offers (edge case B-24).** Converting asset X into asset Y uses up offers that sell Y for X. If one of the account's own offers could fill a step of the path, the quote may count on liquidity that the plan cancels first. Rung 1 is therefore ruled out. A path that would cross the sender's own offer fails with `OFFER_CROSS_SELF` (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/path-payment-strict-send).
- **`ISSUER_ACCOUNT_MISSING` is not used.** PRD section 7 lists it, but the code's `UnclosableCode` does not have it: a merged issuer is information only (progress log, "Consequences for the ladder").
- **Out-of-date documents.** These were not changed here, since this record is the only file written. They still assume that a merged issuer makes the burn fail, and open question 3 overrides them:
  - architecture section 4.4, rung 2 row: "issuer account exists" and `PAYMENT_NO_DESTINATION`;
  - PRD FR-03, variant ISS;
  - the E3-S2 technical note: "`op_no_destination` falls to route 3 or 4".

### References

- docs/epics-and-stories.md, Story 2.5 (also Stories 1.3, 1.4, 3.1, 3.2 and 3.7)
- docs/README.md, canonical decisions 3 and 8, and open question 3
- docs/progress-log.md, day-1 experiments 4, 6, 10, 13 and 14, and "Consequences for the ladder"; raw results in docs/research/day1-experiments-2026-09-26.json
- docs/prd.md, FR-03 and section 7; docs/architecture.md, section 4.4
- docs/stories/1-3-account-inspector.md, 1-4-plan-model-ordering-engine.md, 1-6-dry-run-guarantee-tests.md and 1-7-cli-plan-command.md
- docs/reviews/2026-09-27-e2-integration-review.md: "Deferred" (row E2-S5), AA-11 and AA-14

## Dev Agent Record

### Agent Model Used

Verification by an AI developer agent; no code was written.

### Completion Notes List

- Verdicts:
  - AC-1: met, as a documented deviation (names, field locations).
  - AC-2: met, as a documented deviation (name, wording).
  - AC-3: the choice of route is met as a documented deviation, based on day-1 experiment 4 and canonical decision 8. Two parts have no direct test (Tasks 5 and 6).
  - AC-4: met, as a documented deviation (unclosable item instead of a route, wording).
  - AC-5: met.
- Tasks 5 and 6 were added on 2026-09-28 (`test/unit/plan/route-resolution.test.ts`, 5 tests); no code changed. Status: done.
- Offline tests at commit 9d1b422: 58 files and 508 tests pass (`npm test`). The planner, inspector and reader tests alone: 16 files, 102 tests.
- Not run: the testnet tests (this check used no network).

### File List

- docs/stories/2-5-disposal-route-resolution.md (new)
- test/unit/plan/route-resolution.test.ts (new: tasks 5, 6 and two cases of task 7)

## Change Log

- 2026-09-28: Story record written after the fact. The ACs were checked against the route resolution built in E1-S3 and E1-S4, its tests and the committed plan evidence. Status: review, because two parts of AC-3 have no test.
- 2026-09-28: the two AC-3 tests and two optional task 7 cases added (`test/unit/plan/route-resolution.test.ts`). Status: done.
