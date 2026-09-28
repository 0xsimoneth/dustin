# Evidence index

What a reviewer can check in this directory, mapped to the SOW's binary success metric (`SUCCESSFUL_SOW.md`, Appendix B). Everything here is public data: public keys, hashes, envelopes and Horizon JSON. The complete evidence package, with every SOW 6.1 row, the demo video and the baseline recording, is assembled in week 4 (story E4-S7).

Explorer links stop resolving at the next testnet reset, scheduled for 2026-12-16; the JSON and XDR files in each run directory are the durable record (`docs/README.md`, canonical decision 12).

## The metric close (story E3-S7, 2026-09-28)

Two fresh `messy` fixtures, each closed with the complete Epic 3 code and the default ladder order:

- through the SDK: [`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md)
- through the CLI, with its transcript and receipt: [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md)

## SOW Appendix B, row by row

The links below are to the CLI run; the SDK run's directory holds the same files for its own account.

| # | Appendix B item | Status | Evidence |
|---|---|---|---|
| 1 | Fixture account on testnet holds zero spendable XLM | ☑ | [`fixture-verification.json`](runs/20260928T112252Z-e3-cli/fixture-verification.json): balance 4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0, checked right before the close |
| 2 | Fixture holds at least 3 trustlines with non-zero balances | ☑ | same file: 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001, the last one sponsored by a separate reserve sponsor) |
| 3 | Fixture holds at least 1 open offer | ☑ | same file: 2 open offers |
| 4 | Fixture holds at least 1 data entry | ☑ | same file: 1 data entry (`dustin.fixture`) |
| 5 | Every transaction in the close is fee-bumped by the sponsor (the closed account pays no fee) | ☑ | [`tx-1.json`](runs/20260928T112252Z-e3-cli/tx-1.json), [`tx-2.json`](runs/20260928T112252Z-e3-cli/tx-2.json), [`tx-3.json`](runs/20260928T112252Z-e3-cli/tx-3.json): Horizon's records show `fee_account` = the sponsor, `source_account` = the closed account and inner `max_fee` 0; on the explorer: [tx 1](https://stellar.expert/explorer/testnet/tx/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac), [tx 2](https://stellar.expert/explorer/testnet/tx/f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700), [tx 3](https://stellar.expert/explorer/testnet/tx/36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c) |
| 6 | The account no longer exists on a public testnet explorer | ☑ | [`account-after.json`](runs/20260928T112252Z-e3-cli/account-after.json): Horizon answered HTTP 404; [explorer page of the account](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), [Horizon](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7) |
| 7 | The full transaction chain is linkable from the evidence package | ☑ | [`summary.md`](runs/20260928T112252Z-e3-cli/summary.md) (every hash with its explorer link), [`report.json`](runs/20260928T112252Z-e3-cli/report.json) (both envelopes of every transaction as XDR), [`transcript.txt`](runs/20260928T112252Z-e3-cli/transcript.txt) (the command's output, with the receipt) |

The destination received exactly 4.0000007 XLM: the fixture's 4.0000000 XLM plus 0.0000007 XLM from selling DUSTA. The reserve sponsor's `num_sponsoring` went from 1 to 0 and its minimum balance from 1.5 to 1.0 XLM, with its XLM balance unchanged: the sponsored trustline's reserve went back to the sponsor, never to the closed account.

## Other evidence

| Directory | What it holds |
|---|---|
| [`plan/`](plan/) | The dry-run plan of the builder's baseline fixture, as text and JSON (Deliverable 1, 2026-09-26) |
| [`runs/`](runs/README.md) | Every live close: the layout, and how to reproduce a run, through the SDK (`test/testnet/execute-close.test.ts`) or through the command line (`node scripts/evidence-cli.mjs <case>`, cases `metric`, `edge-frozen`, `memo-partial` and `seq-wait`) |
| [`runs/20260926T125350Z/`](runs/20260926T125350Z/summary.md), [`runs/20260927T200015Z-cli/`](runs/20260927T200015Z-cli/summary.md) | The first live closes of week 2 (story E2-S6) |
| [`baseline/`](baseline/README.md) | The recording protocol for the StellarExpert Demolisher baseline (Deliverable 3); the recording is pending (builder, story E1-S2) |
| [`../docs/test-matrix.md`](../docs/test-matrix.md) | The D3 test matrix: every row, its tests and their status |
