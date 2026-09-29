# Story 3.4: `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard

Status: done

## Story

As a user whose account once had its sequence number bumped,
I want Dustin to tell me when the merge cannot happen yet and how long to wait,
so that the close does not end in a confusing failure.

Review finding R8 (`docs/reviews/2026-09-27-e2-integration-review.md`): the plan said "the executor waits before submitting the merge", and the executor did not wait. It does now.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 3.4). Three are met in another form than their wording; each is marked as a documented deviation, with the reason.

1. AC-E3-S4-1: Given an account where `sequence + 1 >= latestLedger << 32`, when planned, then the merge step is `blocked` with code `SEQNUM_TOO_FAR`, `readyAtLedger` and an ETA in minutes, and the executor submits no merge.
   - **Met as a documented deviation.**
     - The planner blocks the merge only when the wait is longer than the plan's bound, `maxWaitLedgers` (default 120 ledgers, about 10 minutes). A guard within the bound keeps the plan `closable`, runs the merge alone after the cleanup and waits for it (AC-2). This is PRD FR-14 and the planner as built since E1-S5; the AC's condition alone would block every bumped account.
     - The ledger is `unblocksAtLedger` (canonical decision 10; PRD decision D-2 keeps the SDK's names), in `plan.sequenceGuard` and in the blocker's reason, which also gives the ETA in minutes.
     - Beyond the bound the plan is `blocked`, the merge step is left out, `executeClose()` refuses without `allowPartial` with nothing signed, and with it never submits a merge.
2. AC-E3-S4-2: Given `waitForSequence.maxMinutes` at or above the ETA, then the executor polls ledgers and submits the merge once the guard passes; the live test uses a bumped variant account and completes within a few minutes.
   - **Met as a documented deviation** of the option only. The bound is the plan option `maxWaitLedgers`, counted in ledgers, recorded in `plan.options` and applied by every re-plan (review finding R12). There is no `waitForSequence.maxMinutes` and no new execute option: the planner already decides, with the same rule, whether a plan waits or blocks, and one number keeps the plan and the executor in step.
   - Live: a fresh messy fixture bumped 16 ledgers ahead; the cleanup ran, the executor waited 60 s and the merge applied in the unblocking ledger itself.
   - Live through the CLI, with its transcript (`evidence/runs/20260928T125223Z-e3s4-wait/`, written by `node scripts/evidence-cli.mjs seq-wait`): a fresh messy fixture bumped to (4915280 + 12) << 32; `dustin close --execute --yes --report` applied the cleanup and the sale in ledgers 4915284 and 4915285, printed the wait ("tx 3/3  waiting for the sequence guard: the merge can land from ledger 4,915,293"), and the merge applied in ledger 4915293, the unblocking ledger itself; exit 0, then Horizon 404 (section "The wait through the CLI" below).
3. AC-E3-S4-3: Given the ETA exceeds `maxMinutes`, then execution stops before the merge with `status: "partial"` and the receipt says when to rerun.
   - **Met** for an ETA beyond the bound when planned, with `allowPartial` (`--partial`): the cleanup runs, no merge is submitted, the status is `partial` (CLI exit 4), and the receipt's blocker and its "Next" line say when to run again. Without `allowPartial` nothing is signed (canonical decision 4; CLI exit 3).
   - **Documented deviation** for a run the guard stops part-way: the wait ran out, another client bumped the sequence number beyond the bound during the run, the merge failed twice with `op_seq_num_too_far` (failures with other codes do not count, closing review CX-4), or no re-plan or budget was left after such a failure (CX-5). Such a run ends `failed` with the stop `SEQNUM_TOO_FAR`, `verdict: "replan"` and `unblocksAtLedger`, and the CLI exits 5; if nothing was submitted it ends `aborted` (exit 3). The stop's detail and the receipt's "Next" line name the ledger. The reasons are under "Status of a run the guard stops" below.
4. AC-E3-S4-4: Then unit tests cover the boundary: `sequence = (L << 32) - 2` passes, `sequence = (L << 32) - 1` is blocked.
   - **Met**, offline and live. With L the ledger the merge applies in, a sequence at merge (the merge transaction's own sequence number, one above the account's) of `(L << 32) - 1` passes and `L << 32` is blocked. The account sequence numbers the AC names are the same boundary, one lower. Live, a merge that landed in ledger L - 1 failed with `op_seq_num_too_far`, and the executor's merge in L applied.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | `planFromSnapshot()` computes the guard for the merge's transaction (sequence at merge = sequence + index + 1, earliest ledger = observed + 1). When `unblocksAtLedger - observed` is above `maxWaitLedgers`, it adds the blocker `SEQNUM_TOO_FAR` ("... refused (ACCOUNT_MERGE_SEQNUM_TOO_FAR) until ledger N, about M minutes from now"), drops the merge and marks the plan `blocked`. The executor refuses a plan that cannot merge unless `allowPartial` (`PLAN_NOT_CLOSABLE`). | `test/unit/execute/sequence-guard.test.ts` "S-04, AC-E3-S4-1: a far bump makes the plan blocked with SEQNUM_TOO_FAR, the ledger and the ETA, and no merge", "AC-E3-S4-1, AC-E3-S4-3: executeClose refuses without allowPartial, nothing signed"; `test/unit/plan/guard-plan.test.ts` "waits up to the bound and blocks one ledger beyond it"; `test/unit/cli/close-sequence-guard.test.ts` "refuses a guard beyond the bound without --partial, naming the ledger (exit 3)". Live: `test/testnet/sequence-guard.test.ts` "S-04, AC-E3-S4-1: the plan is blocked with SEQNUM_TOO_FAR, the ledger and the ETA, and has no merge", "S-04, AC-E3-S4-1: executeClose refuses without allowPartial and signs nothing" |
| 2 | Before a merge whose plan carries a failing guard, the executor runs the merge preflight, also when the merge is the plan's first and only transaction (the known gap: such a merge was submitted at once and failed on the ledger). When the guard is all that holds the merge back, it emits `{ type: "wait", reason: "sequence", state: "start", index, untilLedger, currentLedger }`, polls `GET /ledgers?order=desc&limit=1` every `pollIntervalMs` with the injected pause until the ledger before `untilLedger` has closed, emits the `end` event, runs the preflight again and submits the merge. The same wait runs before every rebuild of a merge envelope (edge case E2). After `op_seq_num_too_far` on the ledger, the account is read again and the guard recomputed; within the bound the rest is re-planned from the ledger and the new merge waits in its preflight. The CLI prints both events. | `test/unit/execute/sequence-guard.test.ts` "waits before the first submission of a merge that is the plan's only transaction (the known gap)" (it failed before the fix with the merge refused on the ledger), "S-04, AC-E3-S4-2 (offline): runs the cleanup, waits for the unblocking ledger, then merges", "merges without waiting when the ledger has passed the guard by the time the merge is due", "waits again before rebuilding a merge envelope (edge case E2)", "re-reads the account, recomputes the guard, waits within the bound and rebuilds the merge", "re-plans and closes when the guard already holds again (the ledger moved on)"; `test/unit/execute/preflight-wait.test.ts` (the wait: polls with the injected pause, returns at once when the ledger is there, gives up at the local-clock limit, refuses a pause below 200 ms; the preflight names the ledger it read); `test/unit/cli/close-sequence-guard.test.ts` "prints the wait for the sequence guard, then merges (exit 0)". Live: `test/testnet/sequence-guard.test.ts` "S-04, AC-E3-S4-2: the plan is closable and says the merge waits, with the unblocking ledger", "S-04, AC-E3-S4-2: the cleanup runs, then the executor waits for the ledger before the unblocking one", "S-04, AC-E3-S4-2: the merge applies in or after the unblocking ledger, and the account is gone", "S-04: every transaction is a fee bump paid by the sponsor, sourced by the closed account" |
| 3 | With `allowPartial` a blocked plan runs its cleanup and completes `partial`; the report keeps the `SEQNUM_TOO_FAR` blocker. A wait beyond the bound, or one whose local-clock limit runs out, stops before the merge with `SEQNUM_TOO_FAR` and `unblocksAtLedger`; the detail ends "Run the close again at or after ledger N". The receipt's "Next" line names the ledger for such a stop, and for a partial run held back only by the guard says to run again once that ledger has closed. | `test/unit/execute/sequence-guard.test.ts` "S-04, AC-E3-S4-3: with allowPartial it runs the cleanup, never submits a merge and ends partial", "uses the plan's bound: a wait longer than maxWaitLedgers stops before the merge with SEQNUM_TOO_FAR", "respects a smaller bound recorded in the plan (maxWaitLedgers)", "stops with SEQNUM_TOO_FAR when the bound runs out: ledgers close slower than the wait allows", "aborts with nothing submitted when the only transaction is a merge whose wait runs out", "stops with SEQNUM_TOO_FAR and the ledger when the recomputed wait is beyond the bound", "stops when the merge fails with op_seq_num_too_far a second time"; `test/unit/render/report-sequence-guard.test.ts` (four tests of the "Next" line); `test/unit/cli/close-sequence-guard.test.ts` "runs the cleanup with --partial, submits no merge and says when to run again (exit 4)", "stops before the merge when the wait runs out, and the receipt names the ledger (exit 5)". Live: `test/testnet/sequence-guard.test.ts` "S-04, AC-E3-S4-3: with allowPartial the cleanup runs, no merge is submitted, the receipt names the ledger", "S-04 negative probe: a merge submitted anyway fails with op_seq_num_too_far and consumes its sequence number" |
| 4 | `sequenceGuard()`: `ok = sequenceAtMerge < earliestLedger << 32`, `unblocksAtLedger = (sequenceAtMerge >> 32) + 1`. The fake ledger applies the same rule to merges (`test/helpers/fake-ledger.ts`), so the offline executor tests land the merge in the first valid ledger. | `test/unit/plan/guard-boundary.test.ts`: "S-04, AC-E3-S4-4: with L the ledger the merge applies in, a sequence at merge of (L << 32) - 1 passes and L << 32 is blocked", "AC-E3-S4-4 as the story writes it: account sequence (L << 32) - 2 passes, (L << 32) - 1 is blocked", "AC-E3-S4-4, the planner's form: earliestLedger = observed + 1, sequence at merge = sequence + index + 1", "names as unblocksAtLedger the first ledger in which the merge passes, for any sequence at merge", "stays ok once the ledger has passed, since ledgers only grow and the sequence at merge is fixed"; `test/unit/plan/guard.test.ts` "is exact at the boundary". Live: `test/testnet/sequence-guard.test.ts` "S-04, AC-E3-S4-4 live: a merge applies only from the ledger (s >> 32) + 1, where s is its sequence number" |

Two earlier tests described the old behaviour. They keep their names, which `docs/test-matrix.md` cites, and move their bump beyond the bound, where a stop is still right:

- `test/unit/execute/recovery.test.ts` "keeps op_seq_num_too_far a stop that names the ledger the merge can land in": the scripted `op_seq_num_too_far` became a real one, a bump of 500 ledgers after the merge's preflight.
- `test/unit/execute/review-fixes.test.ts` "stops at the sequence guard instead of rebuilding the merge after tx_bad_seq": the bump is 500 ledgers instead of 50, and the stop is `SEQNUM_TOO_FAR` instead of `MERGE_PREFLIGHT_FAILED`. A bump within the bound is now waited for; `test/unit/execute/sequence-guard.test.ts` "waits again before rebuilding a merge envelope (edge case E2)" covers it.

## Live runs (2026-09-28, testnet)

Command: `DUSTIN_TESTNET=1 npx vitest run --project testnet --reporter=verbose test/testnet/sequence-guard.test.ts`. With `DUSTIN_GUARD_RECORD=<file>` every hash is also written with its purpose (public data only).

- Run 1 (11:00 to 11:05 UTC), at commit 22f9340, before `main` was merged: 9 of 9 passed. Its hashes are below.
- Run 2 (11:10 to 11:15 UTC), at commit 022eb66, after `main` (Agent E's review fixes) was merged: 9 of 9 passed. Its hashes follow run 1's, under "Run 2".

Every account is a throwaway created by `buildMessyFixture()` and funded from Friendbot. Each fixture transaction after `create-accounts` and every close transaction is a fee bump paid by the fixture's fee sponsor. The builder's baseline fixture `messy-20260926T035942Z` was not touched. Explorer links, until the testnet reset of 2026-12-16: `https://stellar.expert/explorer/testnet/tx/<hash>`.

### Near bump: the executor waits and merges (AC-E3-S4-2)

Fixture `messy-20260928T110047Z-868bcf`:

| Role | Public key |
|---|---|
| Closed account | `GDNRFMH3Z5B6RNXTCLV6LNHDGVNYIQTROXBHHKHIAMJRFZLAV6BASU3L` |
| Destination | `GCZIHHDTQCE7U3MYJQIMMS5TGIJQISJNLXE65DRMU77UGPCU362LMPYR` |
| Fee sponsor | `GCE6HOOH6KR3NYMN2RGMSKKMBFK5UUWXHMQKDCG4LZ4VY3C47XWRX3JI` |
| Reserve sponsor | `GB6W45MUQ52CMWFKSXANVCCTG2BXFPGJ37HJUBYXTQFCKNTNAJSHY7OY` |
| Issuer | `GCYOCJIMW7JHBMWQJWHDR5ISUMPJMXTRDKJZGNGJEO3ELT6OEAQAPHXI` |
| Market maker | `GASTFFYR5GV47XJGFE5MUHM7NK6WLWIOFIPP3FNIGUUGFPPL3JMBHHFY` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913934 | `9b5a415a84d809d51eadccbab0fdc83acf4c8b670bc128de29a1b9f4c9ddb49e` | fixture: create accounts |
| 4913935 | `9ed93fc4173da9c2ee5ac4cc4581334fcca8158f59a7d64691d950431ba04b88` | fixture: trustlines |
| 4913936 | `0eeb5ff61f74a7081f2f0e75c29a51726cf7eaa133e4e1f957bca296f237d989` | fixture: sponsored trustline |
| 4913937 | `f27b3da1d24030f80e9c0ad3edbeac7675d3f30966d189f3ef6aac410990ee0c` | fixture: dust payments |
| 4913938 | `21cfff5367aa8772b67857eb72f0de1c2a7fe0e6ca41746e964a5461b4668e08` | fixture: market maker's DUSTA bid |
| 4913939 | `f648ecb214428ac52c7b3f5a693f6f1691b4e999a69aee7be598944443c823da` | fixture: offers and data entry |
| 4913940 | `48e38fdc167ff66878b5836c0502d042c4f8c7fae1d2f5cfe038e0cc623eeff3` | fixture: drain to the minimum balance |
| 4913942 | `9d96f8678c7f4fd081e3ca97bcc33ffa3ca70d8c63adc40df9e14b8d45826189` | BumpSequence to (4913940 + 16) << 32 = 21105280313982976 |
| - | none | plan: `closable`, cleanup, sale, merge; guard: sequence at merge 21105280313982979, `unblocksAtLedger` 4913957, ETA 75 s |
| 4913943 | `f89edb205bd03895b9f68d148dff4220f6f082bfcb8ff39a339d3818eb3a06a4` | close tx 1 (cleanup), applied |
| 4913944 | `f4333a14c4da9788c6a5ae6dadb3aacfece6deaafa2bebf1ff454e38a681994b` | close tx 2 (the DUSTA sale), applied |
| - | none | wait start (11:01:48.3 UTC): latest ledger 4913944, until 4913957 |
| - | none | wait end (11:02:48.6 UTC): ledger 4913956 has closed; 12 ledgers in 60.2 s; preflight ok |
| 4913957 | `61e29b285fb3ef9e8a13d2162b395981e225126563462558633e2c3567ee8e48` | close tx 3 (merge), applied in the unblocking ledger itself; account 404 |

The merge's sequence number 21105280313982979 shifted right by 32 bits is 4913956, so the first ledger it could land in was 4913957, and it did.

### Far bump: refused, partial, and a merge forced by hand (AC-E3-S4-1, AC-E3-S4-3, matrix S-04 negative probe)

Fixture `messy-20260928T110253Z-b27bab`. The account stays open: its merge is refused until ledger 4914686, about an hour after the run. It goes at the next testnet reset.

| Role | Public key |
|---|---|
| Account (left open, no subentry) | `GALVZROR2TAQ3RITUC2NABVT2C7TF4MEVLLD5YTVFLTZBF6TPQFUVJBR` |
| Destination | `GAPCLNFGIMBQT6JFAB6YYZYKRPAU3MRSLVPDKYUZ6MDR344N2NOCA3FH` |
| Fee sponsor | `GCA6WOJVIAHTBSKJLFFAWRX3K6IZDBMITONKZI7X5QLLXNRPNRHIF6PC` |
| Reserve sponsor | `GCSNNYCT6HTKHQHCY237FNS77PYBWUJVWNZH3OJDTIDR3HD76BMZUAPY` |
| Issuer | `GDQ4EED32VMWF3Z7445D66R532QWNEZQND4DQWBWWLQKNH336XI52QUY` |
| Market maker | `GCG4F5GDPKRAJRV4SO6FS6JJ3KV3N2IPXDVQF2BF745WVIBHRUJBBCJZ` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913959 | `75a9e9b36407e5ebb287de24fe8ef37599f63d8b9fb19a17941fce3d6d341baf` | fixture: create accounts |
| 4913960 | `cc8c83930cbb416896f519c117455a9b93cdfddf3dac13efda9ea6744cabca25` | fixture: trustlines |
| 4913961 | `6ab4ea8974eb15838cbe033c483760ee24aa0fcc16cfb234abfe2f50eb8389f2` | fixture: sponsored trustline |
| 4913962 | `728d6ac683a29ab9e102ecbfc1ae159f8c44424e43faa9f0c1a134ab63a135d2` | fixture: dust payments |
| 4913963 | `4cdbe9263705e6fc43253558012043eb181915be72cf63d7df07b8eaa24d99f5` | fixture: market maker's DUSTA bid |
| 4913964 | `89939bcbcc3170b8c69e54308b12e4caabf87aed6a310f712cc13398ada259a4` | fixture: offers and data entry |
| 4913965 | `fc7c8bf9480bd4c76b8328aa4529d5e84b4c0ca68087919a9b40bb86d95f35f1` | fixture: drain to the minimum balance |
| 4913967 | `8996b2534e3054cc963d58629bc112ce0e661da7ad40417b57259dcea99bb3d2` | BumpSequence to (4913965 + 720) << 32 |
| - | none | plan: `blocked`, `SEQNUM_TOO_FAR` "until ledger 4914686, about 60 minutes from now", no merge step |
| - | none | close without `allowPartial`: `aborted`, `PLAN_NOT_CLOSABLE`, no signature asked |
| 4913968 | `9917b17ddfbf53d11dfccd8660161fa49e4b214103b9e7f04cf2b8cb9024085c` | close with `allowPartial`, tx 1 (cleanup), applied |
| 4913969 | `6108aea901d37356394bbc26fbf6495f575b2aacf49aa455adb3ea1279baf8c1` | close with `allowPartial`, tx 2 (the sale), applied; status `partial`, no merge submitted |
| 4913970 | `7964d11d73cceb709eaffb5984a25c327c93e4cb2040c0bd1c91176f9e0e04b8` | probe: a merge submitted anyway, included and failed: `tx_fee_bump_inner_failed`, `tx_failed`, `op_seq_num_too_far`; its sequence number was consumed |

### The boundary on the ledger (AC-E3-S4-4)

Fixture `messy-20260928T110358Z-345b2b`. The cleanup ran first through a plan with `maxWaitLedgers: 0` and `allowPartial`, so that only the guard could refuse a merge. Then a merge was built by hand and posted as soon as ledger 4913987 had closed, aimed at ledger 4913988, one before the first valid one. Right after it failed, the executor planned the close again and merged.

| Role | Public key |
|---|---|
| Closed account | `GCQ3M6ERVLFGXECYJFLS7APHRBHIBTFB576MFVQI36I2FPA6ZNVXBN3Q` |
| Destination | `GAAEHWKUVBJHA3NFWRV753WIIY7GYYTRIU5P5ZTWU7NT46OBY5NBPRU4` |
| Fee sponsor | `GBAYDS4STJLBUXYEOVNKSLWGJP3UEIASTT5UWQNYHY6SEYAOTU47B537` |
| Reserve sponsor | `GDOK3KWS6WXWMBDS2BMKV6JTGLATCYDUJCKNHWO4V6L3CZEPYLFPSBVR` |
| Issuer | `GD5VYBLLG754X7DI2KBDGDDAXGUFIH3JAH4WTZ7Q36ELXSON47Z4SRWF` |
| Market maker | `GA5CSVCOBYYEIECI2ENOWPENGJO3OOWFP2NB34BDELGSFMKZOFXYQEMP` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4913972 | `f594099ff9aa3ebca1d2400b9e26547d0fa78723a1bea6a1d064911ef790e917` | fixture: create accounts |
| 4913973 | `07e8db28918762a389c8b7f72e47c83be78d02cd5de2fb204d53d4788b372b5b` | fixture: trustlines |
| 4913974 | `9c9543b503e93f42a84b8eb8b1328ca5106b0b8b45f0cbf2e01862b36ef0ef96` | fixture: sponsored trustline |
| 4913975 | `838b8e896668460c00697e1d790bfaf4060b84ee42169bba8f0877009fba7ee7` | fixture: dust payments |
| 4913976 | `f74dc6dc96b01a285188fee85f42e3569013b80fef0b021e9ba6eb526ba92267` | fixture: market maker's DUSTA bid |
| 4913977 | `f4d14e83471ce90a5ec96cd70aef4fc0841ca652a201e286fbd0f927ce50d19a` | fixture: offers and data entry |
| 4913978 | `f5508813d74c9c7d7729b1fd3bb4725043dff428749abd1d61ef8c1d21e6a8b9` | fixture: drain to the minimum balance |
| 4913980 | `52100dc417a3538372a5cc1b8781beef40fe76c8d162d4a8fd400de474bbab9a` | BumpSequence to (4913978 + 10) << 32 |
| 4913981 | `3b2dfc9aebf61536ff2a04aa4e109c820041ad95aad330375a2348067b7266e2` | cleanup tx 1, applied |
| 4913982 | `cdee588be9fa0fdea687b25fb6ff665de3b29d8ef67a145a7505ff728ce8380c` | cleanup tx 2 (the sale), applied; status `partial`; next sequence number 21105417752936451, so the first valid ledger is 4913989 |
| 4913988 | `9fd107b2edf0b0cdced1704652a95387782a44fcc4bb9b689b2f425e2214a102` | probe: merge with sequence number 21105417752936451 in ledger 4913988, included and failed with `op_seq_num_too_far` |
| 4913989 | `560e951c84250a5365b8f8e296f9db04f37e586f3c8ce1e0553a3ca0cc052c1e` | the executor's merge, sequence number 21105417752936452, applied in ledger 4913989; account 404 |

Both merges have 4913988 as their sequence number shifted right by 32 bits. The one in ledger 4913988 failed; the one in 4913989 applied. This isolates the first valid ledger, which day-1 experiment 5 did not.

### Run 2, after merging `main`

The same three cases on fresh fixtures, with the same outcome: the near case merged in the unblocking ledger itself, and the boundary case failed a merge in the ledger before it and applied the next one in it.

| Case | Fixture | Account | Destination | Fee sponsor | Reserve sponsor | Issuer | Market maker |
|---|---|---|---|---|---|---|---|
| near | `messy-20260928T111041Z-eb20a1` | `GBD52CEYDFALTIC5VVWROZMJC6APAF4HIESKW6ZAISYSRBVYYMMIIS4X` | `GCXEBKL2FQG4UMWTA4VRSGJCDGQDPLCVH675OPLAMGK25PWUOE3LMZYA` | `GCGSXWSX24256HERN7PP64XQGG3LHZDDA5UN3JTGQ3M2PDZMC5JYO7OB` | `GCAOFCJ63DX6ETUUHZEI2GV4NURBJP2JGQPXVEOX7MXM2YUBDLZXWLYX` | `GB4GHE2IUWBB2TH3XK3CVPACLQ77LR5RCWURRY5RCSKXNYGCEBCJRSYP` | `GCQMWIKDAU5K453MU37EZ4V2NJQRLX62LWSZHRGVTTKGYQ36MN7HIVG3` |
| far (left open) | `messy-20260928T111248Z-6e5e4d` | `GCF655OMYRMAZV7QK6RGK54HGXN5WSQ7BYZURVPMV4JE2RBXKRIYIZ4A` | `GARBD426VPDSTVMOUWW7RCNM747HDFC2YNXR5V32GZFR76SHZETEHKM7` | `GDWMXGPDL3HGQS3B4JQLB7XJH3OU54EVY2MTZWKNCFUSAR6YW2RALEJB` | `GBKATT3DW7RINAHHOFPWU3AN4X75EGG2ZADSQSSCLNYS7WE7RLCKQNG2` | `GBWRWEHCMUKFU6OUQYVBZFZ67PR2QERMVTJNOFF4D3WX4ENCVH4WBHIO` | `GDPZEI6REFWVRCZVUBWMMUV7RPUGKC7ITFTCR5KNNKAOG7RXUTT2IFY4` |
| boundary | `messy-20260928T111353Z-81e748` | `GD7VYAEIP3MYWWOH4YXDOVSTGYMXPCBS6ANN4KF4IK7P6F4PQAEUKDDT` | `GCLALE7UY5AHM6DOE4CPG2F543KPAJZROKW3ZXJXAVVK7UK7BLI67VT3` | `GBH6P7K3TJEZ5JUPRGAUKO4PCBLZFM7WW3ABPLXAL5ZWWXKV5GJ3732S` | `GCK2JDSSLUMX7347X65EATELHIRC2UIP3IY747UF2YOWOYMICKHZ2PM6` | `GCA6ATD5M2WS5JKVGJMWZXJBPAE2EDZDMEF7UKCRCGSSXDQORWZIPCF5` | `GCGG36BFXYQIY2XBCAX7AUYKNNYY5XEQZZJQP7TGZNOFQ4QJADMNH4UY` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4914053 | `f2f26e17dfe5b9fddd209ea13800f9d20e0aedd02116775c51dc0ffe6453c9f3` | near: fixture: create accounts |
| 4914054 | `f75d5c76cb3f88a78bf8dca065a555faf85292a35be27dd092c1751fcf18c613` | near: fixture: trustlines |
| 4914055 | `fe955d86276182d9409841fee6018ef3bd847f8fc9a91cb8b04027c5d70c0026` | near: fixture: sponsored trustline |
| 4914056 | `f7a855794f4475c301684fa7bff65d6b1416b5631f6df18989463c5adff087cb` | near: fixture: dust payments |
| 4914057 | `88da1ba62b7a25df6c0cd1acbf6da73028eb88535cfb04d7fc4fe922ea1b2811` | near: fixture: market maker's DUSTA bid |
| 4914058 | `11a830fff3f6b0037f712e82ada9daf02c9f67dc136e6db198228a283bf865f9` | near: fixture: offers and data entry |
| 4914059 | `2fa004329cb06ffad1c1880e9a19728128a6669864edb2d9cddca8139bf9f498` | near: fixture: drain to the minimum balance |
| 4914061 | `3d35d1ae4e524507abf0345a4b7b312740e198e50df5f64b61ce8593a3afc4bd` | near: BumpSequence to (4914059 + 16) << 32; the plan's guard: sequence at merge 21105791415091203, `unblocksAtLedger` 4914076 |
| 4914062 | `b8a6d82d0f20801b63df4c6b0a6791cc552a4ad6a18c2b38e3a2f0e43a7c85cd` | near: close tx 1 (cleanup), applied |
| 4914063 | `f2051a21552170d2f920402d8037fadbf5e7799112f2d79aa01718389cd3ec33` | near: close tx 2 (the sale), applied; wait from ledger 4914063 (11:11:43.4 UTC) to ledger 4914075 (11:12:44.0 UTC) |
| 4914076 | `83192228110b65fd029c52e7a29cc25f3f09fcfc8b272519f311e304ec92e30c` | near: close tx 3 (merge), applied in the unblocking ledger; account 404 |
| 4914078 | `14b270aeceafaad1f734bc468fb68d69b6da71aa097b4b3d92ff61f8024f5b50` | far: fixture: create accounts |
| 4914079 | `2b0cc7426fa4847db9f3d806f25ff84c37cd0a7a54450c31b6a6746b8a76ab5e` | far: fixture: trustlines |
| 4914080 | `183c239bec4516f3f20fa3b2a3423e11f7a1c65f5c2189eb59ebabc3187baf7c` | far: fixture: sponsored trustline |
| 4914081 | `f0432b4922b8561ba07fa669990710b4c0fc82ff9058ba3d706f225133f8631e` | far: fixture: dust payments |
| 4914082 | `867bb427ed325eccf73817f4aff3a354f0a0204ed07742e974d09dc0e128ccf8` | far: fixture: market maker's DUSTA bid |
| 4914083 | `a840ba6dcb4e69fcd59776f3f90d67a3404aa2e6f0747024c91c28d7d08ee57b` | far: fixture: offers and data entry |
| 4914084 | `8efff12c3fbc7e1e96bf629ba5c59f0f1a76e12ebbd12ab2fe82b079f773e414` | far: fixture: drain to the minimum balance |
| 4914086 | `fa965d6c9b374264bce5fc93e9f5be74ffaf42f923db4631e333fcb53e8f0f06` | far: BumpSequence to (4914084 + 720) << 32; the plan: `blocked`, "until ledger 4914805, about 60 minutes from now"; without `allowPartial`: `aborted`, nothing signed |
| 4914087 | `fe86508536ef50593520027d8dbde9b90ad0d8e784280ae4a51803a9cbfdad24` | far: close with `allowPartial`, tx 1 (cleanup), applied |
| 4914088 | `3da68d6ae9fed834b135da3b31abf1732886c4c15b02a267f7e42b8ab06885c3` | far: close with `allowPartial`, tx 2 (the sale), applied; `partial`, no merge |
| 4914089 | `f879cdf6095f3a3ba645e3c51c00d460e2881fb81e2db7eca761708d5f642102` | far: probe, a merge submitted anyway: failed with `op_seq_num_too_far`, sequence number consumed |
| 4914091 | `3a2cae9e6b697b0ac188e57df2831910ba5885f1a7792a9ce7cdd816c2643c8c` | boundary: fixture: create accounts |
| 4914092 | `f98121f994b84ecf07fb38c524ca191a170550bf3b10f821c3b622b024689848` | boundary: fixture: trustlines |
| 4914093 | `31ea91506fdb9a277b165b343b010bd0e148a82fa9b477f12b9b76247daeb30c` | boundary: fixture: sponsored trustline |
| 4914094 | `22e134a7249bcd689c8b705aa20610a5b67ba825ae9f2d8a5612e380fdf76fee` | boundary: fixture: dust payments |
| 4914095 | `3f68a749e20cc5ee5781cd14c2308cb139c736a9ac49dcd06bd238754f3cffd0` | boundary: fixture: market maker's DUSTA bid |
| 4914096 | `4beaff8e5073262ad94b49450ca6b2fbc884bbfbe47f5dfc879e3d2fa471bfb9` | boundary: fixture: offers and data entry |
| 4914097 | `8c7558f92d4ee821f13e9431d187cfc6388f1ea5f8f55ffd6c3bd93d30d1cf55` | boundary: fixture: drain to the minimum balance |
| 4914099 | `d2a073aec8e3a1cc0cb2ad62c08be2e127e9f34176dd60b66304be78ff67cc7e` | boundary: BumpSequence to (4914097 + 10) << 32 |
| 4914100 | `59d69f838632bd2cd1df68e613dabbc73452a1ba88b09fc72bcae80f1fec1adb` | boundary: cleanup tx 1, applied |
| 4914101 | `262ae14ddb376a120a21f94b8d266b925ebded7ccd7b57473bda14f5440364ca` | boundary: cleanup tx 2 (the sale), applied; next sequence number 21105928854044675, first valid ledger 4914108 |
| 4914107 | `ca26868fb79cfe7b4b9ed1b75ecdefa20280270538b052c562aefc1adca2fe8c` | boundary: probe merge in ledger 4914107, failed with `op_seq_num_too_far` |
| 4914108 | `5c7c80f8e6e84d557f3a027bb3f799d3d009d3f3b4969fc912a18256fa2a689b` | boundary: the executor's merge, applied in ledger 4914108; account 404 |

### The wait through the CLI (AC-E3-S4-2, recorded evidence)

`evidence/runs/20260928T125223Z-e3s4-wait/` (commit `bcc9310`), written by `node scripts/evidence-cli.mjs seq-wait` on 2026-09-28 from 12:52 UTC. Fixture `messy-20260928T125224Z-4d622f`, account `GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S`. The run's `summary.md` lists every hash with its explorer and Horizon links, and `transcript.txt` holds the command's output with its receipt.

| Ledger | Hash | Purpose |
|---|---|---|
| 4915281 | `cb474fdf5f1b37d015e7c4007c34b83ef58ad5ca3e35a331bca3be516ecd2964` | BumpSequence to (4915280 + 12) << 32 = 21111018390290432, fee-bumped by the sponsor |
| - | none | `dustin plan` (exit 0): closable; cleanup (9 ops), convert (2 ops), then the merge alone; the merge waits until ledger 4915293 (sequence number at the merge 21111018390290435) |
| 4915284 | `61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153` | `dustin close --execute --yes --report`: tx 1 (cleanup), applied |
| 4915285 | `998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311` | tx 2 (the sale), applied; then "tx 3/3  waiting for the sequence guard: the merge can land from ledger 4,915,293", "the latest ledger is 4,915,285, about 40 s to go", "waited     ledger 4,915,292 has closed; the merge can land from ledger 4,915,293" |
| 4915293 | `f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9` | tx 3 (merge), applied in the unblocking ledger itself; no merge refused with `op_seq_num_too_far`; exit 0; Horizon 404; the destination +4.0000007 XLM |

## Tasks / Subtasks

- [x] Task 1: AC-4 boundary tests of the guard and of the planner's form (`test/unit/plan/guard-boundary.test.ts`, `test/unit/plan/guard-plan.test.ts`) (AC: 4)
- [x] Task 2: the known gap first: a merge-only plan with a failing guard, submitted without a preflight; the test failed before the fix (AC: 2)
- [x] Task 3: the wait (`src/execute/executor.ts` `runPlans`, `mergePreflightStop`, `waitForSequence`, `sequenceStop`; `src/execute/preflight.ts` `waitForLedger`, `ledgerWaitLimitMs`, `knownLedger`, `currentLedger`) and the `wait` event (`src/execute/events.ts`) (AC: 2, 3)
- [x] Task 4: `op_seq_num_too_far` on the ledger: re-read, recompute, re-plan within the bound, stop beyond it or on a second failure (`afterFailure`) (AC: 2, 3)
- [x] Task 5: the CLI's progress lines and the receipt's "Next" line (`src/cli/commands/close.ts`, `src/render/report-text.ts`) (AC: 3)
- [x] Task 6: the planner's wording for a merge-only plan (`src/plan/plan.ts`, guard wiring only)
- [x] Task 7: live tests, one fresh fixture per case (`test/testnet/sequence-guard.test.ts`) (AC: 1-4)

### Closing review (2026-09-28)

The closing review of Epic 3, fixed by agents F1 (merged in `60af60d`) and F2 (merged in `32a7f84`). Each fix has a test that failed before it, under the finding's id in `test/unit/execute/closing-review.test.ts` or `test/unit/plan/closing-review.test.ts`. The findings that concern this story:

- [x] [Review][Patch] CX-4 The run records the code of each failure of a step; the `op_seq_num_too_far` branch stops with "failed this way twice" only after two failures with that code, so a merge that failed once with a re-plan code (`op_has_sub_entries`) and once with `op_seq_num_too_far` within the bound is re-planned and waited for [src/execute/executor.ts] (`2fd3735`)
- [x] [Review][Patch] CX-5 After `op_seq_num_too_far` within the bound, a run with no re-plan left (`maxReplans`) or whose re-plan does not fit the rest of the budget stops with `SEQNUM_TOO_FAR`, `verdict: "replan"` and `unblocksAtLedger`, not with `REPLAN_LIMIT` or `OVER_BUDGET` and no ledger [src/execute/executor.ts] (`e3dd0e3`)
- [x] [Review][Patch] CX-7 = CB-2 A read of the latest ledger that fails during the wait (after the read client's own retries) counts as a poll that did not reach the ledger, and the wait goes on until its local-clock limit; a wait that gives up after a failed last read says why (`readError`) and stops with `SEQNUM_TOO_FAR` and the ledger, instead of throwing `HORIZON_UNAVAILABLE` [src/execute/preflight.ts, src/execute/executor.ts] (`8ea4ce3`)
- [x] [Review][Patch] CX-8 Each pause of the wait is `pollIntervalMs` clipped to the time left before `ledgerWaitLimitMs`, never below 200 ms [src/config/pauses.ts, src/execute/preflight.ts] (`9a239b8`, `c2ddd37`)
- [x] [Review][Patch] CP-17 The planner's guard wording names what runs before the merge from the plan's phases (the cleanup, the sale or sales, or both), where a plan whose only earlier transaction was a sale said "The cleanup runs first"; the messy fixture's guarded plan says the cleanup and the sale run first [src/plan/plan.ts] (`d3ece98`)
- [x] [Review][Patch] CP-2 The `SEQNUM_TOO_FAR` remedy offers `--partial` only when the plan runs something before its merge, and names it [src/plan/plan.ts, src/plan/blockers.ts] (`f18a2d4`)
- [x] [Review][Defer] CA-11 A near guard whose unblocking ledger passes while the typed confirmation waits aborts with `PLAN_CHANGED` (nothing signed, exit 3); kept as the known limitation recorded in the Dev Notes, for the builder

## Dev Notes

- Policy: canonical decision 10; architecture section 8 and rule R8; PRD FR-14 and section 7 (`maxWaitLedgers`); review finding R8; edge cases A-14 and A-15; matrix row S-04.
- Protocol facts checked for this story (2026-09-28):
  - "Source's account sequence number is too high. It must be less than (ledgerSeq << 32) = (ledgerSeq * 0x100000000)." (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge; Raven MCP). Horizon's code is `op_seq_num_too_far` (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge).
  - stellar-core, read on 2026-09-28 at `master`: `MergeOpFrame::isSeqnumTooFar` compares the source account's `seqNum` with `getStartingSequenceNumber(header)`, which is `ledgerSeq << 32` of the ledger being applied (`src/transactions/TransactionUtils.cpp`). From protocol 19 it also fails when a `maxSeqNumToApply` entry for the account is at or above that number; `LedgerManagerImpl::processFeesSeqNums` creates it, when the transaction set holds a merge, with the highest sequence number among the account's transactions in the set (https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp, https://github.com/stellar/stellar-core/blob/master/src/ledger/LedgerManagerImpl.cpp). Dustin submits one transaction of the account at a time, so that highest number is the merge's own. The story's technical note speaks of a protocol-19 age check; the protocol-19 addition to the merge is this check, and it cannot trigger for Dustin.
  - The transaction consumes its sequence number before its operations run, so the number the check sees is the merge transaction's own; a failed merge consumes it too (edge case A-15; day-1 experiment 5; the live probes above).
  - "Bumps forward the sequence number of the source account to the given sequence number, invalidating any transaction with a smaller sequence number"; threshold low (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#bump-sequence). The live fixtures read back exactly `bumpTo` after the bump.
- When the merge may go. A merge with sequence number s can land from ledger `(s >> 32) + 1`, `unblocksAtLedger`. A transaction submitted now lands at the earliest in the ledger after the latest one closed, so the executor submits once Horizon reports ledger `unblocksAtLedger - 1`. The live near case landed in `unblocksAtLedger` itself. A Horizon behind the one that answered the wait cannot hold the merge back again: the preflight after the wait goes by the later of its own reading and the ledger the wait saw (`knownLedger`).
- The bound. The wait is allowed when `unblocksAtLedger - latest ledger` is at most `plan.options.maxWaitLedgers` (default 120), the planner's rule, so a plan the planner made closable is waited for and one it blocked never reaches the executor's merge. The executor polls only the latest ledger, every `pollIntervalMs` (default 2000 ms, at least 200) with the injected `sleep`. The local clock bounds the wait at `ledgerWaitLimitMs`: twice the time of the ledgers to wait for at 5 s each, plus two ledgers (`src/execute/preflight.ts`). The ledgers decide when the wait is over; the limit only ends a wait on a network that closes ledgers far slower than usual. The pace used for ETAs is the observed 5 s per ledger (day-1 experiment 12); the live wait saw 12 ledgers in 60.2 s. Since the closing review each pause is clipped to the time left before that limit, never below 200 ms (CX-8), and a read of the latest ledger that fails after the read client's own retries counts as a poll that did not reach the ledger: the wait goes on, and a wait that gives up after a failed last read names that read in its stop (`readError` next to the last ledger known, the one seen before the wait when no read was answered; CX-7).
- The known gap. `runPlans` ran the merge preflight only when the merge followed work of the run (`tx.index > 0 || transactions submitted`), so a plan whose only transaction is the merge, with its guard failing within the bound, sent the merge at once: it failed on the ledger with `op_seq_num_too_far`, spending a fee and a sequence number. The preflight now also runs whenever the plan's `sequenceGuard.ok` is false.
- `op_seq_num_too_far` on the ledger (another client bumped the sequence number between the preflight and the merge, or a merge built elsewhere). The account is read again and the guard recomputed. Within the bound the rest is re-planned from the ledger: the re-plan's merge carries the failing guard and waits in its preflight, and it is built at the new sequence number. Beyond the bound, or when the merge has failed this way twice, the run stops with `SEQNUM_TOO_FAR` and the ledger. A re-plan counts against `maxReplans` (default 3). Since the closing review only failures with `op_seq_num_too_far` count toward "twice" (the run records the code of each failure; CX-4), and a run with no re-plan left, or whose re-plan does not fit what is left of the budget, stops with `SEQNUM_TOO_FAR`, `verdict: "replan"` and `unblocksAtLedger` too, with a detail that says to run the close again at or after that ledger; other triggers keep `REPLAN_LIMIT` and `OVER_BUDGET` (CX-5).
- Status of a run the guard stops. The code has four final statuses (`CloseStatus` in `src/execute/report.ts`). `partial` means that an `allowPartial` run of a plan that cannot merge did everything else. `failed` means the run stopped part-way and running it again continues from the ledger. A plan blocked by the guard when planned follows the first: with `allowPartial` it ends `partial` (CLI exit 4), the AC's wording. A run that was asked to merge and could not finish yet, because the wait ran out or the sequence number moved beyond the bound, follows the second. It ends `failed` with the stop `SEQNUM_TOO_FAR`, `verdict: "replan"` and `unblocksAtLedger`, which is what exit 5 says ("stopped or failed during execution; re-run to continue"). A script may read exit 4 as "the account cannot be closed as it is", and here running the same command again after the ledger closes it. One that submitted nothing ends `aborted`, exit 3, like every run that submitted nothing. Either way the report says when to run again: the stop's detail and the receipt's "Next" line for a stop, the blocker's reason and the "Next" line for a partial run.
- Events and output. The `wait` event is new in the public surface (`CloseEvent` in `src/execute/events.ts`); the CLI prints "tx N/M  waiting for the sequence guard: the merge can land from ledger X", "the latest ledger is Y, about Z s to go" and "waited  ledger W has closed; ...". A wait that runs out emits a failed `preflight` event and no `end` event. PRD section 7 did not list the event when this story was written; it does since the documentation update of 2026-09-28. The planner's warning names what runs before the merge, "The cleanup runs first", "The sale runs first" or "The cleanup and the sale run first" (and "sales" for more than one), from the plan's phases (closing review CP-17).
- Known limitation, kept. A plan approved with a near guard whose unblocking ledger passes while the typed confirmation waits is planned again by the executor with the guard ok, so the merge joins the cleanup transaction (canonical decision 6); the grouping is part of the plan hash, so the run stops with `PLAN_CHANGED` and nothing signed (CLI exit 3). Running the command again closes the account. Treating that regrouping as no drift would change the drift rules of E2-S3, which are outside this story.
- Fixed in E4-S2 (commit 0bfee67): the plan hash leaves the sequence guard's regrouping of the merge out (PRD decision D-10), so a near guard that clears while the confirmation waits is no drift; the run follows the fresh plan's grouping and its report says so (`test/unit/plan/plan-hash-guard.test.ts`, `test/unit/cli/guard-regroup.test.ts`, `test/unit/execute/guard-regroup.test.ts`).
- Out of scope, kept as found: `src/execute/classify.ts` still lists `op_seq_num_too_far` as a stop code; the executor handles it before the verdict is read.

### References

- docs/epics-and-stories.md, Story 3.4; docs/README.md canonical decisions 4, 5, 10
- docs/architecture.md section 8; docs/prd.md FR-14, section 7, "Decisions after review" D-2
- docs/reviews/2026-09-27-e2-integration-review.md (R8)
- docs/edge-cases-and-test-matrix.md A-14, A-15 and matrix row S-04; docs/progress-log.md day-1 experiments 5 and 12

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- The wait sits in `mergePreflightStop`, which runs before the first submission and before every rebuild of a merge-carrying transaction, so every path to a merge goes through it. The attempt loop was not changed.
- `mergePreflight` checks the guard last, so a result that names `unblocksAtLedger` means every other check passed: that is the only case the executor waits for. After the wait everything is checked again.
- One bound, the plan's `maxWaitLedgers`, for the planner and the executor.

### Debug Log References

- Red before green: 17 of the 23 new executor and preflight tests failed before the change, among them the known gap (the merge-only plan's merge refused on the ledger with `op_seq_num_too_far`). The other six pinned behaviour that already held (the far-guard plan, `executeClose()`'s refusal, the partial run, a stop beyond the bound after `op_seq_num_too_far`, a merge that needs no wait).
- Two existing tests encoded the old stop; see "How each is met" above.
- A CLI line of 125 columns was split in two (the receipt and progress lines stay within 120).

### Completion Notes List

- Offline tier: 73 files and 635 tests before this story and Story 3.3; 81 files and 687 tests after both; 84 files and 752 tests after merging `main` (Agent E's review fixes). Lint, format, typecheck and build pass.
- Live tier: `test/testnet/sequence-guard.test.ts`, 9 tests, passed twice on 2026-09-28, before and after merging `main` (hashes above).
- Recorded evidence of AC-E3-S4-2 through the CLI: `evidence/runs/20260928T125223Z-e3s4-wait/` (section "The wait through the CLI" above). The closing review's fixes to the wait (CX-4, CX-5, CX-7, CX-8) and to the guard wording (CP-2, CP-17) are listed under "Closing review (2026-09-28)"; the offline tier is 89 files and 864 tests after them.
- New in the public surface: the `wait` event; `PreflightResult.currentLedger`; `mergePreflight`'s `knownLedger` option; `waitForLedger()` and `ledgerWaitLimitMs()` in `src/execute/preflight.ts` (internal, not exported from the package). No new execute option.

### File List

- `src/execute/executor.ts` (`runPlans`, `mergePreflightStop`, `waitForSequence`, `sequenceStop`, the `op_seq_num_too_far` branch of `afterFailure`, `aboutTime`), `src/execute/preflight.ts`, `src/execute/events.ts`, `src/plan/plan.ts` (guard wording), `src/cli/commands/close.ts` (the `wait` progress lines), `src/render/report-text.ts` (`nextStep`) (modified)
- `test/unit/plan/guard-boundary.test.ts`, `test/unit/plan/guard-plan.test.ts`, `test/unit/execute/sequence-guard.test.ts`, `test/unit/execute/preflight-wait.test.ts`, `test/unit/cli/close-sequence-guard.test.ts`, `test/unit/render/report-sequence-guard.test.ts`, `test/testnet/sequence-guard.test.ts` (new)
- `test/unit/execute/recovery.test.ts`, `test/unit/execute/review-fixes.test.ts` (one test each, see above) (modified)
- `docs/stories/3-4-seqnum-too-far-guard.md` (new), `docs/epics-and-stories.md` (Story 3.4 only) (modified)

## Change Log

- 2026-09-28: the executor waits for the sequence guard within the plan's bound and stops with `SEQNUM_TOO_FAR` beyond it (review R8), the known gap of a merge-only plan closed, `op_seq_num_too_far` recovered within the bound, the CLI and receipt lines, offline and live tests. Status: review.
- 2026-09-28: closing review of Epic 3 (record updated by the documentation pass): CX-4, CX-5, CX-7, CX-8, CP-2 and CP-17, with their commits in the section "Closing review (2026-09-28)"; CA-11 kept as the known limitation; the recorded CLI evidence of AC-E3-S4-2, `evidence/runs/20260928T125223Z-e3s4-wait/`.
- 2026-09-28: Status: done (`docs/reviews/2026-09-28-e3-review.md`, verdicts). The AC-3 deviation, a run the guard stops part-way ends `failed` with exit 5, follows canonical decision 5.
