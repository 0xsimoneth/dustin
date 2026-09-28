# Story 3.2: Ladder execution, issuer return, destination transfer and unclosable reporting

Status: review

## Story

As a user,
I want balances that cannot be sold returned to the issuer, or sent to my destination when it trusts the asset, and everything else reported with a clear reason,
so that nothing silently blocks my close.

Decision D-1 (2026-09-25, approved; canonical decision 8): `--prefer-destination` / `preferDestination: true` tries the destination transfer before the return to issuer and falls back to the burn; the default stays the SOW order.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 3.2). AC-2 and AC-3 are the texts reworded there on 2026-09-28. Day-1 experiment 4 showed that a payment to an issuer whose account was merged away succeeds and burns the balance, so an asset whose issuer is gone ("ILQ") never reaches rung 3 by default and is never unclosable. One AC is met as a documented deviation.

1. AC-E3-S2-1: Given RET, then payment to the issuer followed by changeTrust(0) succeeds in one transaction, and the receipt notes that the balance was burned.
   - **Met**, live and offline.
2. AC-E3-S2-2 (reworded 2026-09-28): Given a balance with no market whose asset the destination trusts, when the destination transfer is reached (with `--prefer-destination`, or because the return to issuer is ruled out, for example by a memo-required issuer without a memo), then payment to the destination followed by changeTrust(0) succeeds, and the destination's balance of that asset increases by the dust amount.
   - **Met**, live on both paths (`--prefer-destination`; a memo-required issuer) and offline, the CLI flag included.
3. AC-E3-S2-3 (reworded 2026-09-28): Given a balance no rung can dispose of (no market, the return to issuer ruled out, for example by a memo-required issuer without a memo, and a destination that does not trust the asset), when `dustin close --allow-partial` runs, then everything else is closed, the merge is not attempted, the exit code is 2, and the receipt lists the item as unclosable with the three failed routes and the remediation text.
   - **Met as a documented deviation.** The flag is `--partial` (canonical decision 4; SDK option `allowPartial`), and a partial close exits 4, not 2 (canonical decision 5: 2 is a usage or validation error, 4 is partial). The canonical decisions override every other document (`docs/README.md`). Everything else is met live: nothing is signed without `allowPartial`, and with it everything else runs, no merge is attempted and the account keeps exactly the two unclosable trustlines. The receipt lists each item with its code, the three rungs ruled out and the remedy.
4. AC-E3-S2-4: Given a destination payment fails with `op_line_full`, then the step is reported as unclosable with the remediation "raise the destination's trustline limit for <asset>".
   - **Met** (offline). In the SOW order, rung 3 is reached only when rung 2 is ruled out. After `op_line_full` the re-plan therefore finds no rung left, and the balance becomes `NO_DISPOSAL_ROUTE` with a remedy that contains "raise the destination's trustline limit for DUSTC". With `--prefer-destination` the burn is still possible, so the balance falls back to it, as decision D-1 prescribes. Both outcomes are tested.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | Rung 2 is `payment(asset, full balance, to the issuer)`, which burns the balance (https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets). It runs in the cleanup transaction next to the `changeTrust(asset, "0")` that removes the emptied trustline. The step's action reads "return ... to issuer ... (burn)". The receipt's new Disposals section says "burned: returned to its issuer ... in tx 1". | Live: `test/testnet/ladder.test.ts` "S-01, AC-E3-S2-1: the illiquid DUSTB is burned: a payment to its issuer, then its trustline is removed". Horizon's effects of the cleanup transaction show `account_debited` of 0.0000003 DUSTB from the closed account and `trustline_removed` for DUSTB, and no DUSTB credited to anyone but the issuer. The receipt line is asserted too. Offline: `test/unit/render/report-ladder.test.ts` "AC-E3-S2-1: says that each balance returned to its issuer was burned, and what was sold"; `test/unit/cli/close-ladder.test.ts` "AC-E3-S2-2: keeps the SOW order without the flag: the same dust is burned (exit 0)"; `test/unit/execute/ladder-execution.test.ts` "S-01 (offline): the illiquid DUSTB (no market, live issuer) is burned and its trustline removed". |
| 2 | Rung 3 is `payment(asset, full balance, to the destination)`. It is viable only when the destination holds an authorized trustline for the asset with room for the amount and its buying liabilities (`limit - balance - buying_liabilities`). The ladder order is `plan.ladderOrder` (`"sow"` or `"prefer-destination"`). The rung each disposal applied with is on its step outcome (`rung`). | Live: `test/testnet/ladder.test.ts` "AC-E3-S2-2: plans DUSTC to the destination and DUSTB and SPTA to the burn, in the prefer-destination order" and "AC-E3-S2-2, X-06 (authorized destination trustline with room): the destination's DUSTC balance rises by exactly the dust" (+0.0000005 DUSTC; each step outcome's `rung`). Also "AC-E3-S2-3: DUSTC goes to the destination (rung 3); ..." for the memo path. Offline: `test/unit/execute/ladder-execution.test.ts` "AC-E3-S2-2 (offline): with preferDestination DUSTC goes to the destination, DUSTB and SPTA still burn"; `test/unit/cli/close-ladder.test.ts`: "AC-E3-S2-2: sends the dust to a destination that trusts it, instead of burning it (exit 0)", "AC-E3-S2-2: keeps the SOW order without the flag: the same dust is burned (exit 0)", "AC-E3-S2-2: dustin plan --prefer-destination shows the order and the transfer (exit 0)"; `test/unit/plan/ladder-unclosable.test.ts` "AC-E3-S2-3: a memo-required issuer without a memo leaves DUSTB and SPTA with no route; DUSTC goes to the destination". |
| 3 | A balance with every rung ruled out is `NO_DISPOSAL_ROUTE`. Its `reason` lists every rung and why it is ruled out; `rungsRuledOut` has one entry per rung; the `remedy` names a fix per rung. Without `allowPartial` the executor aborts before signing (`PLAN_NOT_CLOSABLE`). With it, everything else runs and the plan has no merge. The CLI exits 3 without `--partial` and 4 with it. The plan, the CLI's refusal and the receipt show each item with its subject, one line per rung ruled out, and the remedy. | Live: `test/testnet/ladder.test.ts`: "AC-E3-S2-3: DUSTC goes to the destination (rung 3); DUSTB and SPTA have no route, with all three rungs ruled out and a remedy"; "AC-E3-S2-3: without allowPartial nothing is signed (aborted, PLAN_NOT_CLOSABLE)"; "AC-E3-S2-3: with allowPartial everything else runs, no merge is attempted, and the account keeps exactly the two trustlines"; "AC-E3-S2-3: the receipt lists each unclosable item with its code, the rungs ruled out and the remedy". Offline: `test/unit/cli/close-ladder.test.ts`: "AC-E3-S2-3: refuses without --partial (exit 3), naming the item, its three rungs and the remedy"; "AC-E3-S2-3: with --partial runs everything else, attempts no merge and exits 4, not 2 (canonical decision 5)"; "AC-E3-S2-3: with the memo the issuer asks for, the dust is returned and the account closes (exit 0)". Also `test/unit/execute/ladder-execution.test.ts` "AC-E3-S2-3 (offline): a memo-required issuer without a memo: ..."; `test/unit/render/report-ladder.test.ts` "AC-E3-S2-3: lists each unclosable item with its code, the rungs ruled out and the remedy"; `test/unit/plan/ladder-unclosable.test.ts` "AC-E3-S2-3: a memo reopens the return to the issuer". |
| 4 | `op_line_full` re-plans (`src/execute/classify.ts`). The fresh plan rules rung 3 out ("the destination's DUSTC trustline has no room for 0.0000005"). The ladder's remedy for that rung is "raise the destination's trustline limit for DUSTC (it has room for X of the Y to send)". The fake ledger answers `op_line_full` like stellar-core, which this story added. | `test/unit/plan/ladder-unclosable.test.ts`: "AC-E3-S2-4: falls back to the burn when the destination rung has no room"; "AC-E3-S2-4: with no rung left, the remedy says: raise the destination's trustline limit for DUSTC". `test/unit/execute/ladder-execution.test.ts`: "AC-E3-S2-4 (offline): a destination payment that fails with op_line_full falls back to the burn"; "AC-E3-S2-4 (offline): after op_line_full with no rung left, DUSTC is unclosable and the remedy names the limit to raise". `test/unit/render/report-ladder.test.ts` "AC-E3-S2-4: names the limit to raise when a destination payment failed with op_line_full and no rung is left". |

Matrix rows of `docs/edge-cases-and-test-matrix.md` section 4 covered here, besides the ACs:

- **S-01, illiquid leftover balance (live and offline)**: see AC-1.
- **X-06, destination trustline states.**
  - Live for the authorized trustline with room: the `--prefer-destination` case.
  - Offline for all three states (authorized with room; limit equal to its balance; not authorized): `test/unit/plan/ladder-unclosable.test.ts` "X-06: a destination DUSTC trustline ... gives ..." and `test/unit/execute/ladder-execution.test.ts` "X-06: a destination DUSTC trustline ...: DUSTC is disposed of by ...".
  - The two states without a route fall to the burn with the stated reason.
- **X-11, the account's own offers are the only liquidity (offline)**: `test/unit/plan/ladder-unclosable.test.ts` "X-11: a quote that only the account's own offer can fill is not trusted, so DUSTA is burned", and `test/unit/execute/ladder-execution.test.ts` "X-11 (offline): the account's own offers are the only liquidity: DUSTA is burned, never sold".
  - The matrix row says the fixture "sells DUSTA". An own offer selling DUSTA sits on the other side of the book and is no liquidity for a DUSTA to XLM sale. The liquidity such a sale would consume is an own offer that sells XLM for DUSTA. A zero-spendable account cannot hold that offer, since selling XLM needs available XLM for the liabilities. This is why the row was not built live.
- **X-10**: in the Story 3.1 record.

## Live runs (2026-09-28, testnet)

Command and runs as in `docs/stories/3-1-ladder-path-payment.md`:

- Run 1 (09:53 to 09:59 UTC) ran each case alone.
- Run 2 (10:03 to 10:07 UTC) ran the whole file: 14 of 14 passed.

Every account is a throwaway made by `buildMessyFixture()` and funded from Friendbot. The builder's baseline fixture was not touched. The burn of AC-1 and S-01 is in the Story 3.1 record: close tx 1 of the vanishing-market case, `57e107317c5f578a8e7ec95ceb77120e29e46d5e3c45551d2ee2fbd149c87f98` (run 2, ledger 4913252) and `b6e5b797248460eea11f26920eb71cf56d1ccba3faf88e77f221bac7ad51bc24` (run 1, ledger 4913139).

### `--prefer-destination` (AC-E3-S2-2, X-06; also AC-E3-S1-1's sale)

In both runs:

- The plan's `ladderOrder` was `prefer-destination`.
- DUSTA was sold by path payment, DUSTC was sent to the destination, and DUSTB and SPTA were burned.
- The destination's DUSTC balance rose by exactly 0.0000005.
- 4.0000007 XLM were merged (the 4.0000000 balance plus the sale's 0.0000007), and the destination was credited exactly that.
- The account answered 404 afterwards.

Run 2, fixture `messy-20260928T100424Z-f77a40`:

| Role | Public key |
|---|---|
| Closed account | `GD4UP4D3NHREOYFA7HA7PXTMBTAK5PGKTKDZMXG45HZ3P2UFK7THVRRX` |
| Destination | `GBWIOZAU7WKLRQSZB424PKICU33IC2ZUE2FNSFIWGNCSRP7HA3H64EZL` |
| Fee sponsor | `GCO3OZFFMWMSB4UG475HVO4QMMR4G2IX5IX2EGMLNNOSNO7WLTUGLY6I` |
| Reserve sponsor | `GBPWDY7DAAHXRMZHBWUMPQUXFS4FH7PVAY5K4ZRCT2EHA7T4DZFAGYTZ` |
| Issuer | `GCOIXYR6COZDVZDAY3KBA2LA3SPEAKIX6OLPRRHUHAE2NFK5N2M5R4GB` |
| Market maker | `GCCTHU7S66K5JXMDJWGUBVTWBVLBB7QEXC3IZESW775MQCZHRXSFEOQF` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913257 | `cbaabc73c679160453e85d02987079674108211d228a3799dfb9a002ce6967d9` | fixture: create accounts |
| 4913258 | `5303dee6dd999572636991bf115202157d391dbf6ee5e8cb3f50b98b809b4b54` | fixture: trustlines |
| 4913259 | `75c26ad58e658a039cf0fc086e542893a217479e17a2d8122a9a20bb06897093` | fixture: sponsored trustline |
| 4913260 | `96b755fcddc47ebefb92d15253bac13dd4c49d84f7dd9a75f670568c3f494bce` | fixture: dust payments |
| 4913261 | `c8f34d80579a1f2099e432742a45ac58679ac37529dd2cb4dd0baccd9b745af5` | fixture: market maker's DUSTA bid |
| 4913262 | `8ffdff10a3faab4ecb91dbc08e3eefc672c6e11f1f75cf84f91b9ee808567c83` | fixture: offers and data entry |
| 4913263 | `acedfeeac6514f66bce6f9a393794009f9d46841270252a859ea757d24ad49bf` | fixture: drain to the minimum balance |
| 4913265 | `561a7207ceeb555af8f1b10fe0f5797fbe65a6badcfea2efa2fa68b3e0ff1c33` | close tx 1 (cleanup), applied: offers cancelled, DUSTC sent to the destination, DUSTB and SPTA burned, their trustlines removed, data entry deleted |
| 4913266 | `a31434f4cefca7573adce89a8f7405c639e1e3044c2432dfec8531500f0938e6` | close tx 2 (convert), applied: DUSTA sold to the account itself, trustline removed |
| 4913267 | `c9a80952a83c8368cd70cbb33e383cde52041f4aa46230944baf9895fdac2405` | close tx 3 (merge), applied: 4.0000007 XLM merged; account 404 |

Run 1, fixture `messy-20260928T095543Z-d88e61`:

| Role | Public key |
|---|---|
| Closed account | `GABJPNZN5MSXTF5UUMYSD2DO4DK3BSMXJMXWZOZGMAZVWUVUBPJGP7JT` |
| Destination | `GBBRMB2RFN3FENZ6Y4KOJKZICX5HDVOG7KBW543X2MIS7SBHXIZDVAMF` |
| Fee sponsor | `GBF7DBDY3G6NN27DBTHWTHXFQ5TY3FUYFGW727FGXK3ESGF3DKJ6I3Z5` |
| Reserve sponsor | `GAX7PSJ4D6PMNVZ6MQBPK4ZEAWQDQL4HDBMS7CJICTKX6LI7REKPFOR4` |
| Issuer | `GCJ6QVQMURFOKL4EBW7MWVIXWJHYKRAL5CFYMNXFVEGOI74ENBOPX5YI` |
| Market maker | `GDK56CBQBNMFUJHQSKNCUXRF2CF6TN2EQBCJ2G23SHN2GX2N7DBH5MZZ` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913153 | `e507aaa02785c5c5a193e13e4a0f91f98945faff3def49ef91c7b708da288f01` | fixture: create accounts |
| 4913154 | `0057696c8322a89dea5cd5bab2c11c38fbfdb706dbfcd54672bd704fa63515a4` | fixture: trustlines |
| 4913155 | `890983cd59b6b1a2b81e3f67f09a7c49fa9a57dba125611f1d3ee4b4890c6f4b` | fixture: sponsored trustline |
| 4913156 | `c8af0256e2f7247ce4dc1ba6378b32720b5d858201b76fcb47af0acea3b62c29` | fixture: dust payments |
| 4913157 | `670a20382a52ad2ba16964a5dc9a2cede4277cabb9e5caa61530976fac6cfbd6` | fixture: market maker's DUSTA bid |
| 4913158 | `9c4d6b0931ab3784fc7246f923afdbc1160ee1df9d43a497b50356a0d5884254` | fixture: offers and data entry |
| 4913159 | `7f89dd97282018e89166826039ea8ed3570ec0113717722e49537f95ebe62164` | fixture: drain to the minimum balance |
| 4913161 | `f79ad87388c892ce1efcede9497713f8d4826839b4daea6d234428536cd7c7c0` | close tx 1 (cleanup), applied: DUSTC sent to the destination, DUSTB and SPTA burned |
| 4913162 | `bbc35d855d364bd6a85859def57310ea4d32cbd22f8b6ff5513ccf619ea2be30` | close tx 2 (convert), applied: DUSTA sold to the account itself (Horizon: `path_payment_strict_send` from and to the account, 0.0000007 sent and received), trustline removed |
| 4913163 | `8b61b4bcb44f0a1c8a4ff56008e8bdf2b9e76dc5c871548f2585a125d1500018` | close tx 3 (merge), applied: 4.0000007 XLM merged; account 404 |

### An issuer that requires a memo, and no memo (AC-E3-S2-3, AC-E3-S2-2)

Before planning, the issuer set the SEP-29 data entry `config.memo_required` to "1" with its own throwaway key and paid its own fee. In both runs:

- The plan was `partial`, with no merge:
  - DUSTA was sold (rung 1).
  - DUSTC went to the destination (rung 3), because rung 2 was ruled out: "issuer ... requires a memo (SEP-29) and none was given".
  - DUSTB and SPTA were `NO_DISPOSAL_ROUTE`, with all three rungs ruled out and a remedy.
- Without `allowPartial` the run aborted with `PLAN_NOT_CLOSABLE`. Nothing was submitted, and the account's sequence number was unchanged.
- With `allowPartial` the cleanup and the sale applied and no merge was attempted. The account kept exactly two trustlines, DUSTB 0.0000003 and SPTA 0.0000001, with no offer and no data entry (subentry count 2). The destination's DUSTC rose by 0.0000005.

Run 2, fixture `messy-20260928T100523Z-e37701`:

| Role | Public key |
|---|---|
| Account (left open with 2 trustlines) | `GDDMAVQEWKYD5L7S6DR3VEB4QMKSE5BN77NRXJKTGEPW5X5Q6ZVENAQG` |
| Destination | `GAAXIRSZAJRHRZJK3MYDGZZR74V5NFTNIERXX6UIAFU7CMNFQ4R4KMS2` |
| Fee sponsor | `GDOND4FGALJKN7PX4YZKWPRSGXH4PQGIFLZUIA5KCMUFOPAP2UNUZR2S` |
| Reserve sponsor | `GBICMPULE5Y7JU4S3D35MUTH7O7MU4RRQZCVFJOLJE2OO6ZUGGJD347G` |
| Issuer (memo-required) | `GBUDRS6C753DV7XLW6R3YV5AKDDTUZHDF5PM3444MSJLFXADXU6VUY3D` |
| Market maker | `GAOQGIVFQ3BXE73TZOLGP6KLBEZCFUIKIZA2LKJ4Y43F7KKX4UPYLI5A` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913269 | `ed65850003e6116e5a4dd5a0db5c2d8e86d13297a277c68ee68adccf3e57f7a0` | fixture: create accounts |
| 4913270 | `b2f269a98a4aa93f20b74ab1f32e33cd9c248d35bfcd3b427d096a4422a62c20` | fixture: trustlines |
| 4913271 | `5864c8b62e3e7dd8f8a9a55ea3b3696d6f288c1a334fcf18e5615081fc00da7e` | fixture: sponsored trustline |
| 4913272 | `e60f68358b20e08ed1e66757589437244335a4f6dbf393e217c50554eb68e7aa` | fixture: dust payments |
| 4913273 | `26b1b31eed0d9b423e7f73da6fe4eb13b8425a469469407b11d495a84172ba3f` | fixture: market maker's DUSTA bid |
| 4913274 | `c6979d2b212eb65a7959c03f554ccb37e38cd2f27bf6b2059de4d93bb96f73d3` | fixture: offers and data entry |
| 4913275 | `7abcce322aa7a132ce093bbc050665b124e849f0e1e235e168579f70465fa42d` | fixture: drain to the minimum balance |
| 4913277 | `0fcd2483532c1615628c451544a65548c370e3f8e61d044a4dee23f1d3c23f5a` | issuer sets `config.memo_required` = "1" (SEP-29) |
| - | none | close without `allowPartial`: aborted, `PLAN_NOT_CLOSABLE`, nothing signed |
| 4913279 | `24c764a3e1963a05bdf2c37f0a5e475ebe26f6fedbb1c851db43157b325fb03a` | close with `allowPartial`, tx 1 (cleanup), applied: offers cancelled, DUSTC sent to the destination, DUSTC trustline removed, data entry deleted |
| 4913280 | `b38b2f51b7514b9d76fcc1bb3cace33a2ffec7ce76ed5da14f879833c614abbf` | close with `allowPartial`, tx 2 (convert), applied: DUSTA sold, trustline removed; status `partial` |

Run 1, fixture `messy-20260928T095652Z-fe5ae5`:

| Role | Public key |
|---|---|
| Account (left open with 2 trustlines) | `GBZFLQX73S24QNPIGJA5CDD7BPDTDKZCP6IBLGTTVGQJZIQWBUALKBHL` |
| Destination | `GCMPCNDF4HCQ47JXGP2EBNEK7NMQ4XU7TM6IFPMTJR2T5OWJ7624MO3Y` |
| Fee sponsor | `GCPTACRWEFV2U4C7SGWUOBJDANHCRX5NXRDLXD2YINSTIHADA44VNMC7` |
| Reserve sponsor | `GBRJDT33TJKU5SZOXJYJE35TESG2RVSNPZUNTI5K2ZADH3ZFMBI4NQ3D` |
| Issuer (memo-required) | `GBETHFOWPY3GS5IVBI56LMP3ITI5TJ2QHMKHHZGMIZIRWOXSF4OYESHU` |
| Market maker | `GCVQCJHUL76UDIMSSRN5UGRFEDK56JJORTTFOLG5ZFTMR3UFUF223CLT` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913167 | `6a7e3e73e7e5ecf78f0df9a19b09b439b9407d2387495fcc81187423a7022fdf` | fixture: create accounts |
| 4913168 | `b2578ee92a490fecb5ad488405582e5830e1eceb74f5ffd56bf92ee626641061` | fixture: trustlines |
| 4913169 | `2b7aae33b9b9c290bd6bfd96acab3cdbe0da93cb32192841541eccff16ecf817` | fixture: sponsored trustline |
| 4913170 | `f78208ea5b34e8eb2eace62633f906b4aa6482dd07d03ea6eb57439ce7bc220f` | fixture: dust payments |
| 4913171 | `3e5c80dc8fbc325f315246bbd892dac9e2df96c704d500194a1ab224a208046b` | fixture: market maker's DUSTA bid |
| 4913172 | `5e3b681670eb03b4a1b1eabb0c368b2d7de4758a93bc231f7b027c2b2e040900` | fixture: offers and data entry |
| 4913173 | `69ee13851ec2bf4d50c2436cd7e4462b6ed828decfb4cae23f5900fb5b0c5c6a` | fixture: drain to the minimum balance |
| 4913175 | `d913bbf7474c9b5f6ac6268cb5b3374b8d2d64971e35ae95d56a4868a4cae6f6` | issuer sets `config.memo_required` = "1" (SEP-29) |
| - | none | close without `allowPartial`: aborted, `PLAN_NOT_CLOSABLE`, nothing signed |
| 4913176 | `042d03e4def27a7a2d5a76049f3288cbf0bf8eb7cfbe392566f4477a8e217e71` | close with `allowPartial`, tx 1 (cleanup), applied |
| 4913177 | `14f4baf185f55385e2e08943f24dceb14705ad6c298305947f54c62d714c2a12` | close with `allowPartial`, tx 2 (convert), applied; status `partial` |

## Tasks / Subtasks

- [x] Task 1: AC-4: a remedy per ruled-out rung, naming the limit to raise when the destination trustline has no room (`src/plan/ladder.ts`); the fake ledger answers `op_line_full` (AC: 3, 4)
- [x] Task 2: the plan, the CLI refusal and the receipt show each unclosable item with its subject, the rungs ruled out and the remedy (`unclosableLines()`, `src/render/plan-text.ts`) (AC: 3)
- [x] Task 3: the receipt's Disposals section says a returned balance was burned and names a transfer to the destination (AC: 1, 2)
- [x] Task 4: offline tests for every rung, the `--prefer-destination` flag, the partial exit code and matrix rows S-01, X-06, X-11 (AC: 1-4)
- [x] Task 5: live tests: `--prefer-destination`, a memo-required issuer, and the burn (AC: 1-3)
- [x] Task 6: Story 3.2 in the epics: AC-2 and AC-3 reworded for day-1 experiment 4, the `op_no_destination` mapping corrected, the superseded flag and exit code noted (AC: 2, 3)

## Dev Notes

- Policy: canonical decisions 4 (`--partial`), 5 (exit codes), 8 (the ladder and D-1), architecture section 4.4, PRD FR-03, FR-08 and FR-12, day-1 experiments 4 (merged issuer burns), 10 (SEP-29) and 13 (an unauthorized trustline cannot send).
- Protocol facts checked for this story (Raven MCP, developers.stellar.org, 2026-09-28):
  - `PAYMENT_LINE_FULL`: "The destination account (receiver) does not have sufficient limits to receive amount and still satisfy its buying liabilities." Source: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/payment and https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#payment. The ladder's room check and the fake ledger's `op_line_full` both follow it: `limit - balance - buying_liabilities` must hold the amount.
  - Burning: sending an asset to its issuer takes it out of circulation (https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets).
  - SEP-29: a data entry `config.memo_required` with the value "1" asks senders of payments and merges for a memo (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md). The protocol does not enforce it. Dustin's submitter posts raw envelopes, so the SDK's own check does not run on them. The planner rules the issuer rung out by the SEP, and the merge preflight checks the destination (review R10).
- Why AC-3's live case is a memo-required issuer. With an authorized trustline the burn always works, even to a merged-away issuer (day-1 experiment 4), so the only reachable way to rule rung 2 out is SEP-29. A deauthorized trustline (matrix S-02, `TRUSTLINE_NOT_AUTHORIZED`) belongs to the `edge` fixture and was not built here.
- What the planner reports. The planner reports `NO_DISPOSAL_ROUTE` with the `reason` unchanged in form: it still lists every rung, for JSON readers and for the E2-S5 route tests. The renderers show the rungs one per line instead of that sentence. The remedy keeps its first words, "Make one route possible, then run the plan again:", and then names the fixes, in ladder order:
  - a market that buys the asset;
  - the memo the issuer requires;
  - a destination trustline to open or have authorized;
  - the limit to raise.
- `op_no_destination` cannot come from a return to an issuer that is gone (day-1 experiment 4). On a transfer it means the destination account is gone, which the merge preflight and the next plan's `DESTINATION_MISSING` blocker also catch. The technical note in the epics said otherwise and was corrected.
- Not changed: the order of `LADDER_ORDERS`, the executor's re-plan and drift rules, and `src/execute/classify.ts`. Every failure mapping this story needs already re-plans.

### References

- docs/epics-and-stories.md, Story 3.2 (reworded 2026-09-28); docs/README.md canonical decisions 4, 5, 8; docs/prd.md "Decisions after review" D-1
- docs/progress-log.md, day-1 experiments 4, 10, 13; docs/edge-cases-and-test-matrix.md B-11, B-12, B-13, B-24 and matrix rows S-01, S-02, X-06, X-11

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- Remedies come from the ladder. Each rung that is not viable carries a `fix`, and `NO_DISPOSAL_ROUTE` joins the fixes in ladder order.
- One helper renders an unclosable item for the plan, the CLI refusal and the receipt, so the three read the same.
- The fake ledger gained `op_line_full`, so the executor's fall from rung 3 can be tested end to end offline.

### Debug Log References

- Red before green:
  - 2 planner tests failed on the remedy.
  - 5 receipt tests failed before the Disposals section and the new unclosable lines existed.
  - The CLI tests of the existing flags (`--prefer-destination`, `--partial`) passed at once: those behaviours predate this story, and the tests add the missing coverage.
- A lint rule (`no-unsafe-assignment`) refuses asymmetric matchers inside object literals in these tests. The assertions were restructured.

### Completion Notes List

- Offline: see the Story 3.1 record (58 files and 514 tests before, 65 files and 559 tests after, both stories together).
- Live: 3 of the 4 cases in `test/testnet/ladder.test.ts` serve this story (7 of its 14 tests). Two runs passed on 2026-09-28.
- Two throwaway accounts stay open on testnet with DUSTB and SPTA dust, one per run of the memo-required case, as the AC intends. They go at the next testnet reset.

### File List

- As in the Story 3.1 record: both stories were built together on one branch.

## Change Log

- 2026-09-28: named remedies (AC-4), unclosable items with their rungs in the plan, the refusal and the receipt, the Disposals section, offline and live tests, the epics' Story 3.2 corrected. Status: review.
