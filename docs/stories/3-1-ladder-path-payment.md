# Story 3.1: Ladder execution, path-payment sale

Status: done

## Story

As a user,
I want leftover balances that have a market sold for XLM in the same transaction that removes their trustline,
so that my dust becomes XLM that reaches my destination.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 3.1). AC-1 is the text corrected there on 2026-09-28 for review finding AA-14. One AC is met as a documented deviation.

1. AC-E3-S1-1 (corrected 2026-09-28): Given LIQ in the fixture with a live bid, when executed, then one transaction contains pathPaymentStrictSend(LIQ to XLM, to the closing account itself) followed by changeTrust(LIQ, 0) and succeeds, the proceeds reach the closing account, and the merge then moves its whole balance, proceeds included, to the destination, whose XLM increases by the merged amount that the receipt records as `recovery.mergedXlm`.
   - **Met**, live and offline. The epics said the sale pays the destination directly. The code, architecture section 4.4 and both E2-S6 evidence runs send the proceeds to the closing account. The code was kept and the AC corrected (review finding AA-14): one delivery to the destination, one SEP-29 memo consideration, one recovered amount.
2. AC-E3-S1-2: Given the market disappears between planning and execution (the market maker cancels its bid in the test), then the transaction fails with `op_too_few_offers`, the executor re-plans and the asset takes the issuer-return route on the next attempt, and the receipt shows both attempts.
   - **Met**, live (twice) and offline.
3. AC-E3-S1-3: Given a balance too small to buy 1 stroop of XLM, then the planner already routes it to issuer return (unit test).
   - **Met**, by unit tests, and live as matrix row X-10.
4. AC-E3-S1-4: Then `destMin` is never below 1 stroop and slippage is configurable (`maxSlippageBps`, default 500).
   - **Met as a documented deviation.** `destMin` is never below 1 stroop, and the slippage is configurable. The option is `slippageBps` with a default of 100 (1%), not `maxSlippageBps` with 500. Reasons:
     - PRD decision D-2 (2026-09-28) keeps the SDK's names as built.
     - Architecture section 4.4 sets the 1% default.
     - The quote comes from the fresh plan made right before signing, so the bound only has to absorb the market's move between that quote and the sale.
     - A sale that falls short costs one fee and falls down the ladder (AC-2).

     A caller who wants 5% passes `slippageBps: 500`. The bound is recorded in `plan.options.slippageBps` and forwarded to every re-plan (review finding R12). A bound changed after planning changes the plan hash, so it is drift.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | Rung 1 is `pathPaymentStrictSend(full balance, destination = the closing account, destAsset XLM, destMin)`. It runs in its own `convert` transaction together with the `changeTrust(asset, "0")` that removes the emptied trustline (canonical decision 6). The merge runs alone after a fresh preflight and moves the whole balance, proceeds included. The receipt reads the merged amount from the merge result (`recovery.mergedXlm`). The Disposals section says "sold for XLM by path payment to the account itself in tx 2; the XLM left with the merge". | Live: `test/testnet/ladder.test.ts` "AC-E3-S1-1: one transaction sells DUSTA to the closing account itself and removes the trustline; the merge carries the proceeds to the destination". This test reads Horizon's operation records of the sale: `path_payment_strict_send` from and to the closing account, 0.0000007 sent and received, then `change_trust` DUSTA with limit 0. The merged amount is 4.0000007, and the destination was credited exactly that. Offline: `test/unit/plan/plan.test.ts` "groups into cleanup, the isolated DUSTA sale and the merge"; `test/unit/plan/ladder.test.ts` "sells DUSTA by path payment to the account itself with destMin below the quote"; `test/unit/execute/executor.test.ts` "closes the messy fixture in the planned fee-bumped transactions and verifies it is gone" (destination +4.0000007); `test/unit/render/report-ladder.test.ts` "AC-E3-S2-1: says that each balance returned to its issuer was burned, and what was sold". |
| 2 | The sale is included and fails, spending its sequence number and the sponsor's fee. `op_too_few_offers` (and `op_under_dest_min`, `op_cross_self`) drops rung 1 for that asset. The re-plan reads through `withPathsOnlyFor()`, so the asset falls to the return to its issuer. That is allowed mid-run drift (a move down the ladder), and the close completes. The report keeps both envelopes, the step outcome records `rung: "return_to_issuer"`, `round: 1` and `failures: 1`, and `replans[0]` holds the trigger with its codes and the demoted asset. The receipt shows the failed transaction with its codes and meaning, the re-plan with its trigger codes, and the Disposals line "burned: returned to its issuer ... in tx 1 of round 1, after the sale by path payment failed with op_too_few_offers". Since the closing review (CC-8, `5044ab5`) the Disposals line reads each failure from the envelopes that failed on the disposal's operation, with the rung from the plan of that envelope's round and the operation's own code: a balance that failed twice reads "the sale by path payment failed with op_too_few_offers, then the return to its issuer failed with op_src_not_authorized", and the note of an applied disposal names only rungs that failed, never a sale that a re-plan dropped without a failure of it. | Live: `test/testnet/ladder.test.ts`: "AC-E3-S1-2: the fresh plan sold DUSTA by path payment, and the bid was cancelled before the sale"; "AC-E3-S1-2: the sale is included and fails with op_too_few_offers, spending its sequence number and fee"; "AC-E3-S1-2: the re-plan moves DUSTA to return_to_issuer and the close completes"; "AC-E3-S1-2: the report and the receipt show both attempts and the re-plan with its trigger codes". Offline: `test/unit/execute/ladder-execution.test.ts` "AC-E3-S1-2 (offline): the market vanishes between the fresh plan and the sale: op_too_few_offers, a re-plan to the burn, and the close completes"; `test/unit/render/report-ladder.test.ts` "AC-E3-S1-2: shows the sale that failed, the re-plan with its codes, and the burn that followed"; `test/unit/cli/close-ladder.test.ts` "AC-E3-S1-2: after the market vanished, shows the failed sale, the re-plan and the burn (exit 0)". |
| 3 | A quote below 1 stroop of XLM is no path. At first the filter that dropped a `destination_amount` below 1 stroop was in `src/inspect/inspect.ts` (`bestQuote`), not in `src/reader/ledger-reader.ts` (which returns Horizon's records as they are) nor, until this story, in `src/plan/ladder.ts`, and the ladder refused such a quote too, so a snapshot handed to the public `planFromSnapshot()` cannot plan a sale that must fail. Since the closing review (CP-5, `cfe327e`) the inspector keeps the best answer even below 1 stroop (a quote of at least 1 stroop still wins), and the ladder alone rules the sale out, with the reason "the best strict-send quote pays less than 1 stroop of XLM for the full balance" and the fix "wait for a market that pays at least 1 stroop of XLM for <balance> <code>". A plan made from Horizon therefore says why, where it said that Horizon found no path. Either way the balance is planned as a return to its issuer, in the one cleanup transaction. | `test/unit/plan/ladder-dust.test.ts` "AC-E3-S1-3, X-10 (planner): a strict-send answer of 0.0000000 XLM plans the burn, not a sale" and "AC-E3-S1-3: the ladder itself refuses a quote below 1 stroop (a snapshot built elsewhere)". Live: `test/testnet/ladder.test.ts` "AC-E3-S1-3, X-10: the planner routes DUSTA to its issuer instead, and the account closes". |
| 4 | `destMin = max(1 stroop, quote - ceil(quote x slippageBps / 10000))`. For dust the slippage is rounded up to a whole stroop, so `destMin` stays below the quote. `slippageBps` is a whole number from 0 to 10000, validated before planning. | `test/unit/plan/ladder-dust.test.ts`: "AC-E3-S1-4: floors destMin at 1 stroop for a 1-stroop quote, for any slippage"; "AC-E3-S1-4: applies the slippage bound in basis points, rounded against the seller"; "AC-E3-S1-4: records the bound in the plan and puts it on the operation"; "AC-E3-S1-4: refuses a slippage outside 0 to 10000 basis points before planning". Also `test/unit/plan/ladder.test.ts` "never lets destMin fall below one stroop"; `test/unit/execute/executor.test.ts` "treats a slippage bound changed after planning as drift". |

### Review finding BH-7 (deferred from the E2 integration review to this story)

`planHash` leaves out quotes and `destMin`. A worse quote while the confirmation waited therefore lowered the merged amount without a drift. Builder decision, now implemented in `executeClose()` (`CloseRun.start()`, `src/execute/executor.ts`). Before anything is signed, what the approved plan recovers is compared with what the fresh plan recovers, in BigInt stroops: the account's native balance plus the quoted proceeds of its sales (`recovery.nativeBalance` plus `recovery.quotedProceedsXlm`). That is `recovery.xlmToDestination` when a plan merges and what the account keeps when it does not. The first version compared `recovery.xlmToDestination`, which is 0 in a plan without a merge and so hid a worse quote from an `allowPartial` run (closing review CX-2, `6271b37`); the stop code and the `xlmToDestination` field kept their names.

- **A lower fresh value is drift** and follows `onDrift` exactly like a changed plan hash:
  - `"abort"` (the default) ends with status `aborted`, nothing signed and the new stop code `XLM_TO_DESTINATION_FELL` (verdict `replan`). Both amounts are in the stop's detail and in `stop.xlmToDestination`. When the plan hash changed too, the stop stays `PLAN_CHANGED` and names both amounts.
  - `"replan"` goes on with the fresh plan and adds a warning with both amounts.
  - The `drift` event carries `xlmToDestination: { approved, fresh }`.
  - The stop, the warning and the CLI's progress line word the amounts by whether the plans merge: the XLM the destination would receive, the XLM the account would keep, or the XLM the close would recover (`recoveredXlmWords()`, CX-2).
  - A fresh plan that lost the approved plan's merge is named for what it is, "the fresh plan no longer merges", in a `PLAN_CHANGED` stop and in the warning, instead of being called a worse quote. The warning that the run went on is added only once every refusal before signing has passed, so a run that then stops with `PLAN_NOT_CLOSABLE` does not say it went on, and one that goes on without the merge (with `allowPartial`) says it went on as a partial close (closing review CX-3, `35e6952`).
- **A higher value is not drift.**
- **Mid-run re-plans keep today's rule**: a sale that fails and moves down the ladder lowers the proceeds by design (`replanDrift()` is unchanged).
- **Through the CLI**: the CLI shows the fresh plan and asks, and the executor plans again after the answer. A fall in that window ends with exit code 3 (canonical decision 5, nothing executed). The progress line says the amount fell, instead of claiming a changed plan hash.

| Behaviour | Tests |
|---|---|
| Abort by default, nothing signed | `test/unit/execute/confirmed-amounts.test.ts` "aborts with nothing signed when a quote falls between planning and execution" |
| `onDrift: "replan"` goes on with a warning | same file, "goes on with the fresh plan and a warning under onDrift replan" |
| A rise goes on silently | same file, "goes on silently when the quote rises" |
| Both amounts in a `PLAN_CHANGED` stop | same file, "names both amounts in the PLAN_CHANGED stop when the plan hash changed as well" |
| Mid-run re-plans unchanged | same file, "keeps the rule for mid-run re-plans: a failed sale that moves down the ladder is not drift" |
| CLI: exit 3, nothing signed | `test/unit/cli/close-confirmed-amount.test.ts` "exits 3 with nothing signed when a quote falls after the confirmation", "puts the stop code and both amounts in the --json report (exit 3)", "closes as before when the quote rises after the confirmation (exit 0)" |

## Live runs (2026-09-28, testnet)

Command: `DUSTIN_TESTNET=1 npx vitest run --project testnet test/testnet/ladder.test.ts`. With `DUSTIN_LADDER_RECORD=<file>` every hash is written with its purpose.

- Run 1 (09:53 to 09:59 UTC) ran each case alone: 5 + 2 + 4 + 2 tests, all passed.
- Run 2 (10:03 to 10:07 UTC) ran the whole file: 14 of 14 passed in 252 s, with the test that reads the sale's operations for AC-1 added.

Every account is a throwaway created by `buildMessyFixture()` and funded from Friendbot. The builder's baseline fixture `messy-20260926T035942Z` was not touched. The cases of Story 3.2 (the `--prefer-destination` close, with AC-1's sale, and the memo-required issuer) are in `docs/stories/3-2-ladder-issuer-destination-unclosable.md`.

### The market vanishes between the fresh plan and the sale (AC-E3-S1-2, S-01)

A submitter wrapper (`beforeFirstSale()`, `test/unit/execute/submit-hooks.ts`) holds back the first envelope that carries a strict-send sale. While it is held, the market maker cancels its DUSTA bid with `manageBuyOffer` (buyAmount "0", the bid's offer id; the market maker pays its own fee), and the wrapper waits until that has applied. In both runs the cancellation applied in ledger N and the sale failed in ledger N+1.

Run 2, fixture `messy-20260928T100316Z-82274c`:

| Role | Public key |
|---|---|
| Closed account | `GAQNZZ6JL6XSOSPDALR5563PQVONR3ZMQ7DQWIUWGDEZGOFZXGFGGOUB` |
| Destination | `GDF2UTQMWTT3T4DK3VHNYLOYBZFK534EYUYVYM7AKYBV4UZCQVKPEA3Z` |
| Fee sponsor | `GAJPBMUB7VISW6BVYD2RVNDJEDARP6PQ32QRMO3CGJGDUSRTBW4F46CT` |
| Reserve sponsor | `GATZJPVLFSQVEQ33RZBTDO67Q77AFRCCAKJFEUSAVXULSSSAACUEYWGJ` |
| Issuer | `GBFUPXKGJ22XSKBKFEVPKEI3J4RSBS3RU6Z4IPZIFC32JZMYTJFENVZ7` |
| Market maker | `GDNQVYELNXNCATCPPVVBCDMT6U4QG3F3H5AAOWQB3GN4ZXURKLYQKXQF` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913244 | `88885e9cb6e0ef07f3b84e1d99e429a6851ffc48f7005d94a59eb2a55eeaef3a` | fixture: create accounts |
| 4913245 | `8fcb74717acf9081422d6fe35819fe1329d87516b22e9fa63c43206e49dffe23` | fixture: trustlines |
| 4913246 | `efbcbafe5513dea7cc0e7c4d677dd5fd12638cd80b8d6facf4bb9f9328dc5ec3` | fixture: sponsored trustline |
| 4913247 | `474765c5e4add69d6a03152fae56fa319b4a7f866d5ff4b5181911c8433a93d9` | fixture: dust payments |
| 4913248 | `0a567337bd44a9b80d33e5780819ff712914aee88dd2c479a52a95ee283b1584` | fixture: market maker's DUSTA bid |
| 4913249 | `a1b5aaaf80380843e0e15a69cda80aacfecf1cb08928f591d3262a49fc3aed99` | fixture: offers and data entry |
| 4913250 | `d548b938e281892da87d526d69796fee692a8089def3c01e1b721807a0ae0497` | fixture: drain to the minimum balance |
| 4913252 | `57e107317c5f578a8e7ec95ceb77120e29e46d5e3c45551d2ee2fbd149c87f98` | close tx 1 (cleanup), applied: 2 offers cancelled, DUSTB, DUSTC and SPTA burned and their trustlines removed, data entry deleted |
| 4913253 | `efc17551ba6b3fdccdfd4b1349721bc25744f011c8ffc0d32c69af68a0baa118` | market maker cancels its DUSTA bid, right before the sale is posted |
| 4913254 | `b25443f46870ed80f4ef9580c4fa7e7470f937bf798cc1fdd215f6f8da17dab4` | close tx 2 (convert), included and failed: `tx_fee_bump_inner_failed`, `tx_failed`, `op_too_few_offers`, `op_invalid_limit`; sequence number and fee (300 stroops) spent |
| 4913255 | `7ed21d568c40b7e2107926ddb88f719fbce61d38ad684245a02477fa5b2d47b4` | close tx 1 of round 1, applied: DUSTA returned to its issuer (burned), trustline removed, merge; 4.0000000 XLM merged; account 404 |

Run 1, fixture `messy-20260928T095350Z-d7bf11`:

| Role | Public key |
|---|---|
| Closed account | `GDRJF6VWC4BUPTJSQLBNWKH734A4TX4DYJW3RQNFRKQY2V5PLBANDKA3` |
| Destination | `GA6KCE5LI2AEDTQTIJVK3XCDY4ULZ7ZD3PS7IW2KBMSRSQQMAJCXFIW4` |
| Fee sponsor | `GCRKUP5KNZGFNQD53I3PQLO25ZSOEIJYUVOJIRDRRNZKWRKCIIXKHGMK` |
| Reserve sponsor | `GCBIJPOYQY5HD54W2YO55LABWLWLX4TZIARDRNYTZ65DIQF7RZ77MR7X` |
| Issuer | `GAOMMAJJ5ZZE3LFUS5B3LCKPOW4FPM2QRCEIFURHWY3NIQDLGBT7SEOO` |
| Market maker | `GB6IYCXM23QT53LB5JAUVC7CTV6AXLIWZ6UK45Y7X62VTITGHEL7RNTQ` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913131 | `ad212831b3fd7fea8c1d4f9fef793bb39fb5cfa777d2d4818192dfc32bd5c8cc` | fixture: create accounts |
| 4913132 | `7cfa1aae7972654fa1fc594c19546c8c7a246cd95a6c44c0afe499e5627a086d` | fixture: trustlines |
| 4913133 | `612cc5bec068b4398b738f5e886c0121c50b2d42df65c8dd90ef7fe3aa384ea3` | fixture: sponsored trustline |
| 4913134 | `ca6c42be1fd1dedb1692a54e8641c3a95cd9fc3d556ded8d1e557b24cb6980cf` | fixture: dust payments |
| 4913135 | `de28e0bddeaf5e3b0dfb95615350d482962eaafaa34a57155b3c3628696f4126` | fixture: market maker's DUSTA bid |
| 4913136 | `5385d68da25e74997ab108d256c7a1dc0af4d91402ce52666972ab3bb33bb7d4` | fixture: offers and data entry |
| 4913137 | `1e3a0392215ded5ab5ca555602270328f34e1c371981e2101cd53e59c3b0cce3` | fixture: drain to the minimum balance |
| 4913139 | `b6e5b797248460eea11f26920eb71cf56d1ccba3faf88e77f221bac7ad51bc24` | close tx 1 (cleanup), applied |
| 4913140 | `4a927758a21184e53aa221109085b491d676c6676f101cebfcd2ae611ec8c3fb` | market maker cancels its DUSTA bid, right before the sale is posted |
| 4913141 | `bb2f96c521bd8d8b899a6c3687b71689f718599b307054bc5ae89c078b1a9dbb` | close tx 2 (convert), included and failed: `op_too_few_offers`, `op_invalid_limit` |
| 4913142 | `0d23ca8c346b370495fcf944b654222dfb941c7ae746d9c0bfdc76a4f4b73783` | close tx 1 of round 1, applied: DUSTA burned, trustline removed, merge; 4.0000000 XLM merged; account 404 |

### Dust below the resolution of the book (X-10, AC-E3-S1-3)

The market maker re-prices its DUSTA bid to 0.1 XLM per DUSTA (`manageBuyOffer` with the bid's id; it pays its own fee). 0.0000007 DUSTA then buys 0.7 stroop of XLM. A probe asks the ledger what it answers for the sale itself (edge case U4): the closed account sends 0.0000005 DUSTA, the part free of its own offer's liabilities, by strict send to itself with `destMin` 1 stroop, fee-bumped by the sponsor. Then the account is planned and closed.

- Horizon's strict-send path finder answered no record at all, not a record of 0.0000000.
- The probe was included and failed with `op_under_dest_min` in both runs, not `op_too_few_offers`.
- The planner returned DUSTA to its issuer, and the account closed in one fee-bumped transaction.

Run 2, fixture `messy-20260928T100628Z-0c27f3`: closed account `GBYJQM4E2KHN4GSZHHD7LMWLOQF3YA4UQ6FQ5VPY4C6AG7BSR337SLBD`, destination `GB24YMYGXV2MSK337NN2WEVBIRIC2NYDE6PZFO757MXBE5N23PYC4F3E`, fee sponsor `GCXXD3YX6SCIXP6MM5GCNQBAI37WGGJEBQGIJHQ3OJBDX7I4TYCOF2T5`, reserve sponsor `GDL6SRQ3YG3KERXHWKIZHIY6FQEJRBBI3Z2VSG5HWLPVY2MW46T72RFN`, issuer `GDMOS2QFBMCH7EUJSTXODZ3R23K6MZKKEU46LIMGFW5MQB6KNFEFYBXW`, market maker `GBXFJTTRFKCXVOSSJGSUNDH5XRNNR2BIA5IF5GZ7ZLX6ASYEJD57GEST`.

| Ledger | Hash | Purpose |
|---|---|---|
| 4913282 | `8dec22927f10943710c361a8a25fa90fedf2802fcc30603bc7d2297d56beb945` | fixture: create accounts |
| 4913283 | `978286f8a3032430ef4cd74908cae42f9122e3de70e9a6a8131f81cff9598f74` | fixture: trustlines |
| 4913284 | `7ce0e1b78726e3ff321ba0c6d2189314fce5f04b54fb5851519669e7a3b92785` | fixture: sponsored trustline |
| 4913285 | `cd5c336a2063097b6059ec1c60b12a0b95a49de9e03b75501dca01f84664ac22` | fixture: dust payments |
| 4913286 | `2fb7a283bfd1cfea8129bc5ee35a408a27a89da6593d1b22887098ba2b501115` | fixture: market maker's DUSTA bid |
| 4913287 | `e81668544d54ed5ee50c4ab8a785c5db494bee8ae7857d28baa4a3e4f20cb7fd` | fixture: offers and data entry |
| 4913288 | `450a12b70049b48b14bd80f609644f157f786f8784879e5ab9604e99f0d207a5` | fixture: drain to the minimum balance |
| 4913290 | `f8010ac918dd65fa066fc71a44fdcad3fba5276af34d13b8aae359a1809489bb` | market maker re-prices its DUSTA bid to 0.1 XLM per DUSTA |
| 4913291 | `ba42dc7ceb2803e969f614ab3e3df8fa17a54bd922e4d87ecf2d52ed734cd791` | probe: strict send of 0.0000005 DUSTA to XLM, `destMin` 0.0000001, included and failed with `op_under_dest_min` |
| 4913292 | `043dad53778a47a344fe69c9771bfb25241ac30f0716510f2699c904612d67e8` | close tx 1 (cleanup with the merge), applied: DUSTA burned with the rest; 4.0000000 XLM merged; account 404 |

Run 1, fixture `messy-20260928T095803Z-12653f`: closed account `GAZX4XSIGLAYYHQFFHTYAW5EUHCXG5BCSIZ5IYI5HKYQSG7IM3XVKKOS`, destination `GAJU4XDEB5YPV2IOUI5DIIUAPD6FSTSZ4ETGCATSPY3QORZZWNTKIF2Y`, fee sponsor `GCM3IEKWA2AZEM7F6V3MFVAY2SVTNSKROIUSGTGZDUO7I2EST3AIGFVD`, reserve sponsor `GCN7XXI5DYSXQ6XQJXD7XAJPWVVQMM6V4IFICILY5NEP2G7L5C6BG5IY`, issuer `GDTH3QJZIW2LAPDRV4MF2NX4X2A5AOZHCW2T32WASN77IPQENFDGY6MX`, market maker `GDXODBOY7UIFPN2YI77I3ZDSV3WEZGX3HYVSYWT7N4QY26JSXXFRRKNY`.

| Ledger | Hash | Purpose |
|---|---|---|
| 4913181 | `07571fa22584bd65d47c7d83390ef6e7181756ca379fabc0452840207bb14635` | fixture: create accounts |
| 4913182 | `393f55a6569d0b81687a980d2ab1b56a98c6745edbb01aee886527e6c302f9b2` | fixture: trustlines |
| 4913183 | `508ee1565268348be8d9dfc65355cac98abdfdf349981779ba2ce7a5c594abaa` | fixture: sponsored trustline |
| 4913184 | `08d812e8f00df300837778d3e47b2a53ace378163e6d5813496c185c867b5650` | fixture: dust payments |
| 4913185 | `8e11c3971405cc900a4699e320551273fa8c5ccd5e6536af3a3d72b8b3f76025` | fixture: market maker's DUSTA bid |
| 4913186 | `d6ee4c48f9530309968aecc5609646f302a32382583e8e4808e430868af39660` | fixture: offers and data entry |
| 4913187 | `bf21b16829a14b2191d6b8d65ffdff4836bbefd88c4cb3277a6f912d1d4273f7` | fixture: drain to the minimum balance |
| 4913189 | `d01cbd1242b3247bf798f7163d1e9132f46d264cfaedb170bb62668a9b4e909d` | market maker re-prices its DUSTA bid to 0.1 XLM per DUSTA |
| 4913190 | `8be9003d080d66be7b3d418704b2a4842a435fbbf7604c3f9cbd3c04b4e9f51b` | probe, included and failed with `op_under_dest_min` |
| 4913191 | `795c7ed7a92beb3224c8bc7e9d0635f1db4dee12d211a489d911fffd8b23dc5f` | close tx 1 (cleanup with the merge), applied; 4.0000000 XLM merged; account 404 |

## Tasks / Subtasks

- [x] Task 1: BH-7: compare `recovery.xlmToDestination` before signing, with a stop code, the amounts on the stop and the drift event, and the CLI's progress line (AC: 1, 2)
- [x] Task 2: AA-14: correct AC-E3-S1-1 and the technical note in the epics, with a dated note (AC: 1)
- [x] Task 3: the ladder refuses a quote below 1 stroop; unit tests through the inspector and through `planFromSnapshot()` (AC: 3)
- [x] Task 4: destMin floor and configurable slippage tests; deviation recorded (AC: 4)
- [x] Task 5: the receipt's Disposals section: sold, burned or sent, the transaction and round, and the rung that failed first (AC: 1, 2)
- [x] Task 6: offline executor test of the market vanishing between the fresh plan and the sale, through a submitter hook (AC: 2)
- [x] Task 7: live tests, one fresh fixture per case; two runs recorded above (AC: 1, 2, 3)

### Closing review (2026-09-28)

The closing review of Epic 3, fixed by agents F1 (merged in `d0d711c`) and F2 (merged in `c53d437`). Each fix has a test that failed before it, under the finding's id in `test/unit/execute/closing-review.test.ts`, `test/unit/cli/closing-review-cli.test.ts`, `test/unit/render/closing-review-render.test.ts` or `test/unit/plan/closing-review.test.ts`. The findings that concern this story:

- [x] [Review][Patch] CX-2 The BH-7 check compares what each plan recovers, the native balance plus the quoted proceeds, so it sees a worse quote in a plan without a merge; the texts word the amounts by whether the plans merge [src/execute/executor.ts, src/cli/commands/close.ts] (`6271b37`)
- [x] [Review][Patch] CX-3 A fresh plan that lost its merge is named for what it is, and a warning that the run went on is added only once it did [src/execute/executor.ts] (`35e6952`)
- [x] [Review][Patch] CC-8 Disposals names each rung that failed with its own code, from the failed envelopes and the plans of their rounds [src/render/report-text.ts] (`5044ab5`)
- [x] [Review][Patch] CP-5 The inspector keeps a quote below 1 stroop, so the ladder's own reason and fix reach a plan made from Horizon [src/inspect/inspect.ts, src/plan/ladder.ts] (`cfe327e`)
- [x] [Review][Patch] CP-6 A sale ruled out by the account's own offer names the offer, and its fix is to cancel it with a `--partial` run (if no other market buys the asset for XLM once it is gone, wait for one) [src/plan/ladder.ts] (`872839f`)

## Dev Notes

- Policy: canonical decisions 6 (a market-dependent sale isolated with its trustline removal; the merge alone after a fresh preflight) and 8 (the ladder), architecture sections 4.4, 4.7 and 7.2, PRD FR-03, FR-06 and FR-12, PRD decision D-2.
- Protocol facts checked for this story (Raven MCP, developers.stellar.org, 2026-09-28):
  - `PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS`: "There is no path of offers connecting the send asset and destination asset. Stellar only considers paths of length 5 or shorter." `PATH_PAYMENT_STRICT_SEND_UNDER_DESTMIN`: "The paths that could send destination amount of destination asset would fall short of destination min." Source: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/path-payment-strict-send
  - Manage Buy Offer: "Amount of buying being bought. Set to 0 if you want to delete an existing offer." Source: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#manage-buy-offer. The market maker's cancellations above applied that way.
  - A strict-send path payment to the sending account itself is valid, and the proceeds land in the account (day-1 experiment 14, `docs/progress-log.md`).
- Observed live (2026-09-28, both runs):
  - Horizon's `result_codes.operations` for the failed sale lists a code for each operation of the transaction: `op_too_few_offers` for the sale and `op_invalid_limit` for the `changeTrust` after it, whose balance was still there. The fake ledger stops at the first failing operation. `operationFailure()` (`src/execute/classify.ts`) classifies the first code that is not `op_success`, so both behave the same.
  - Edge case U4, answered: for a sale whose output rounds below 1 stroop, the ledger answers `op_under_dest_min`, and Horizon's path finder returns no record.
  - The path finder was polled before planning (`waitForPath()`, day-1 experiment 6). The re-plan after a failed sale asks Horizon no path for the demoted asset (`withPathsOnlyFor()`), so it never depends on the path finder's lag.
- An injected submitter skips the executor's own testnet check of the submit endpoint (review R6). The live test therefore calls `verifyHorizonIsTestnet()` itself before closing with the wrapped submitter. The mainnet refusal layers are unchanged.
- The Disposals section needs the plans (the CLI always passes them). Without them the report's step outcomes carry no subject, and the section is left out.
- Out of scope, kept as found: `op_too_few_offers` and the other codes that drop rung 1 are unchanged (`src/execute/classify.ts`). The mid-run drift rule (`replanDrift()`) is unchanged.

### References

- docs/epics-and-stories.md, Story 3.1 (corrected 2026-09-28)
- docs/reviews/2026-09-27-e2-integration-review.md, "Deferred" (BH-7, AA-14) and "Builder decisions of 2026-09-28"
- docs/architecture.md sections 4.4, 4.7, 5, 7; docs/prd.md FR-03, FR-06, FR-12, section 7, "Decisions after review"
- docs/edge-cases-and-test-matrix.md: B-01, B-24, C-05 and matrix rows X-10, X-11

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- BH-7 lives in `CloseRun.start()` next to the plan-hash check. The two drift causes share one `drift` event and one `onDrift` decision, and `xlmFell()` compares the amounts in BigInt stroops.
- The ladder change is local to `evaluatePathPayment()`. The quote guard adds a reason and a remedy fix. Existing reason texts, and so the plan snapshots and the committed fixture plan, are unchanged.
- The receipt reads the rung each disposal applied with from its step outcome, and the step's subject from the plan of the round that added the step.
- Live: a submitter hook runs the market maker's cancellation between the executor's fresh plan and the sale, the moment the story describes.

### Debug Log References

- Red before green:
  - BH-7: 3 of 5 executor tests failed before the fix. The other two are regression guards for the unchanged rules (a rise, a mid-run fall).
  - Dust guard: 1 planner test failed.
  - Receipt: 5 render tests failed.
  - Two of my own planner assertions were wrong about the model: `ruledOut` lists every rung that is not viable, later ones included. They were corrected.
- The CLI's first BH-7 test assumed a 4 XLM world; the CLI's zero-spendable world holds 2.5 XLM. The expected amounts were corrected.

### Completion Notes List

- Offline tier: 58 files and 514 tests before this work; 65 files and 560 tests after (the numbers include Story 3.2's tests). Lint, format, typecheck and build pass.
- Live tier: `test/testnet/ladder.test.ts`, 14 tests, passed in two runs on 2026-09-28 (hashes above and in the Story 3.2 record).
- New in the public surface: stop code `XLM_TO_DESTINATION_FELL`; `StopReason.xlmToDestination`; the `drift` event's `xlmToDestination`. PRD section 7 does not list them yet.

### File List

- `src/execute/executor.ts` (`start()`, `xlmFell()`, `onDrift` docs), `src/execute/report.ts`, `src/execute/events.ts`, `src/plan/ladder.ts`, `src/render/plan-text.ts`, `src/render/report-text.ts`, `src/cli/commands/close.ts` (drift progress line, refusal text) (modified)
- `test/helpers/fake-ledger.ts` (modified: `op_line_full`)
- `test/unit/execute/confirmed-amounts.test.ts`, `test/unit/execute/ladder-execution.test.ts`, `test/unit/execute/submit-hooks.ts`, `test/unit/cli/close-confirmed-amount.test.ts`, `test/unit/cli/close-ladder.test.ts`, `test/unit/plan/ladder-dust.test.ts`, `test/unit/plan/ladder-unclosable.test.ts`, `test/unit/render/report-ladder.test.ts`, `test/testnet/ladder.test.ts` (new)
- `docs/epics-and-stories.md` (Stories 3.1 and 3.2 only), `docs/stories/3-1-ladder-path-payment.md`, `docs/stories/3-2-ladder-issuer-destination-unclosable.md` (new)

## Change Log

- 2026-09-28: BH-7 closed; AA-14 settled in the epics; dust guard; receipt Disposals section; offline and live tests; two live runs. Status: review.
- 2026-09-28: closing review of Epic 3 (record updated by the documentation pass): CX-2 and CX-3 in the BH-7 section, CC-8 in the receipt's Disposals line, CP-5 in AC-3 and CP-6, with their commits in the section "Closing review (2026-09-28)".
- 2026-09-28: Status: done (`docs/reviews/2026-09-28-e3-review.md`, verdicts). The 1% default of `slippageBps` (AC-4) is listed there for the builder to confirm; it does not hold the story.
