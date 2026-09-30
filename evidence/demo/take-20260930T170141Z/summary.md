# Demo take 20260930T170141Z

The take behind the 60-second demo video (story E4-S6), produced by `node scripts/demo/make-demo.mjs` from the rehearsal script [`docs/demo-video-script.md`](../../../docs/demo-video-script.md) on a fresh `messy` fixture, on the Stellar testnet, with `dustin` 0.1.0. Every terminal shot is cut from the three recordings in this directory; nothing in them was typed or printed by anything but the shell and the CLI.

## Accounts

| Role | Address | Links |
|---|---|---|
| Closed account (fixture `messy-20260930T170147Z-b5d6bd`) | `GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV` | [explorer](https://stellar.expert/explorer/testnet/account/GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV), [Horizon](https://horizon-testnet.stellar.org/accounts/GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV) (404 after the close) |
| Destination | `GCBM3FL3BHBJ25SMZZ2M3IA6EY3UVP24XLLJD2CR6P4KPCCS4FRCKYUA` | [explorer](https://stellar.expert/explorer/testnet/account/GCBM3FL3BHBJ25SMZZ2M3IA6EY3UVP24XLLJD2CR6P4KPCCS4FRCKYUA), [Horizon](https://horizon-testnet.stellar.org/accounts/GCBM3FL3BHBJ25SMZZ2M3IA6EY3UVP24XLLJD2CR6P4KPCCS4FRCKYUA) |
| Fee sponsor (fee account of every transaction) | `GDDBZF7IELFILL5S5JWIG5LBUBO4RU5YZOPZSM4G4OWVHRKIYXVSZKYP` | [explorer](https://stellar.expert/explorer/testnet/account/GDDBZF7IELFILL5S5JWIG5LBUBO4RU5YZOPZSM4G4OWVHRKIYXVSZKYP), [Horizon](https://horizon-testnet.stellar.org/accounts/GDDBZF7IELFILL5S5JWIG5LBUBO4RU5YZOPZSM4G4OWVHRKIYXVSZKYP) |

## The close shown in the video

| # | Hash (the fee bump's) | Ledger | Fee charged to the sponsor | Links |
|---|---|---|---|---|
| 1 | `5cadb010d1a463cb3d115caf0614eb1b31b6c9ee47d8d5994e69d56e538bec4e` | 4952864 | 1,000 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/5cadb010d1a463cb3d115caf0614eb1b31b6c9ee47d8d5994e69d56e538bec4e), [Horizon](https://horizon-testnet.stellar.org/transactions/5cadb010d1a463cb3d115caf0614eb1b31b6c9ee47d8d5994e69d56e538bec4e), [record](tx-1.json) |
| 2 | `1a4acd278f77f10f6ad344499c53f144ac56f9a703780d66e16a94d03c5a1ef4` | 4952865 | 300 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/1a4acd278f77f10f6ad344499c53f144ac56f9a703780d66e16a94d03c5a1ef4), [Horizon](https://horizon-testnet.stellar.org/transactions/1a4acd278f77f10f6ad344499c53f144ac56f9a703780d66e16a94d03c5a1ef4), [record](tx-2.json) |
| 3 | `3b6bd13146034ea60e6b74a496fff40071af68dd7ef39a30ee474af823ca2e50` | 4952868 | 200 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/3b6bd13146034ea60e6b74a496fff40071af68dd7ef39a30ee474af823ca2e50), [Horizon](https://horizon-testnet.stellar.org/transactions/3b6bd13146034ea60e6b74a496fff40071af68dd7ef39a30ee474af823ca2e50), [record](tx-3.json) |

Checked by the script before it wrote anything: each transaction succeeded with `fee_account` the sponsor and `source_account` the closed account ([`tx-1.json`](tx-1.json) to [`tx-3.json`](tx-3.json)); Horizon answers 404 for the account ([`account-after.json`](account-after.json)); its last operation is the merge of transaction 3 ([`operations-after.json`](operations-after.json)). The fixture met SOW Appendix B right before the take: [`fixture-verify.txt`](fixture-verify.txt), [`fixture-verification.json`](fixture-verification.json); its build is in [`fixture-manifest.json`](fixture-manifest.json) and on camera in [`fixture-create.cast`](fixture-create.cast).

## The fixture's build, on camera

| Step | Ledger | Hash |
|---|---|---|
| create-accounts | 4952828 | [`3268224dad770f9baff534b0a7bda2366cb3316d7f9d6e3a897b73d6e2ad329a`](https://stellar.expert/explorer/testnet/tx/3268224dad770f9baff534b0a7bda2366cb3316d7f9d6e3a897b73d6e2ad329a) |
| trustlines | 4952829 | [`8778ff760c8175040d1069b0e335a85e912fd42333cf670052a70dce30eea8dd`](https://stellar.expert/explorer/testnet/tx/8778ff760c8175040d1069b0e335a85e912fd42333cf670052a70dce30eea8dd) |
| sponsored-trustline | 4952830 | [`f70ec887f1e70eb5fb3f0335e1c95645533cd0e3252cde8570d24f94eac4025b`](https://stellar.expert/explorer/testnet/tx/f70ec887f1e70eb5fb3f0335e1c95645533cd0e3252cde8570d24f94eac4025b) |
| dust-payments | 4952831 | [`b713a57f2bfcd432c1779fa362d3a402a67564b99d6b59c71970681e07fb93a0`](https://stellar.expert/explorer/testnet/tx/b713a57f2bfcd432c1779fa362d3a402a67564b99d6b59c71970681e07fb93a0) |
| market-maker-bid | 4952832 | [`b7452ba082db3b747d12dcf2a60d006db259791ac60e1ace8363b20a13f74e54`](https://stellar.expert/explorer/testnet/tx/b7452ba082db3b747d12dcf2a60d006db259791ac60e1ace8363b20a13f74e54) |
| offers-and-data | 4952833 | [`ea3e5ce00ccc3cda16349d31e2cb68a16eedd68b11703e4d847c08b4a53ad8a3`](https://stellar.expert/explorer/testnet/tx/ea3e5ce00ccc3cda16349d31e2cb68a16eedd68b11703e4d847c08b4a53ad8a3) |
| drain-to-minimum | 4952835 | [`7d50324bfe0d5decb55ac6d389aadcbe39853c18e730ffad8e6122c6b36fb6c3`](https://stellar.expert/explorer/testnet/tx/7d50324bfe0d5decb55ac6d389aadcbe39853c18e730ffad8e6122c6b36fb6c3) |

## The video

| Field | Value |
|---|---|
| File | `evidence/demo/dustin-demo-60s.mp4` (not in git; hosted as a release asset once the builder uploads it) |
| Duration | 59.80 s |
| Size | 1920 x 1080, H.264, 30 frames per second, no sound |
| SHA-256 | `6d2fe4c0afc2be94cb2b5cf056fcda4c1bb5a314a34903d87cda13b8538740dc` |
| Captions | burned in on a band at the top, and [`dustin-demo.srt`](../dustin-demo.srt) |

## The cut

| Time | Shot | Source | Caption |
|---|---|---|---|
| 0.0 to 5.0 s | title | still | This Stellar account holds 4 XLM but cannot spend any of it, so it cannot even pay the fee to close itself. |
| 5.0 to 9.0 s | before-balances | still | Before: 4 trustlines with balances, 2 open offers, 1 data entry. All 4 XLM are locked as reserve. |
| 9.0 to 13.0 s | before-history | still | (the caption above continues) |
| 13.0 to 16.0 s | unsponsored | recording seconds 68.17 to 68.17 | Without a sponsor, the account cannot pay a fee: the fixture builder's own unsponsored attempt is rejected. |
| 16.0 to 26.0 s | plan | recording seconds 0.61 to 11.18, pauses over 1 s shortened | The plan is read-only. Every step has a reason. Nothing is signed yet. |
| 26.0 to 28.1 s | close-command | recording seconds 2.07 to 4.16 | To run it, you confirm the destination. |
| 28.1 to 31.0 s | confirmation | recording seconds 12.52 to 17.00, pauses over 1.2 s shortened | (the caption above continues) |
| 31.0 to 44.0 s | execution | recording seconds 17.00 to 54.98, pauses over 0.9600000000000002 s shortened | Three transactions. Every fee is paid by the sponsor. The account pays nothing. |
| 44.0 to 49.0 s | receipt | recording seconds 54.98 to 55.01 | Result: 4 XLM arrived at the destination. Fees paid by the account: zero. |
| 49.0 to 52.5 s | after-explorer | still | After: the account no longer exists. Anyone can check this link. |
| 52.5 to 56.0 s | after-horizon-404 | still | (the caption above continues) |
| 56.0 to 59.8 s | end | still | Dustin. Read the plan, then close the account. Testnet only. |

The browser pages, each captured with Playwright (Chromium) when the cut above shows it, under a strip that names its URL (they are not links here: after the close the account's pages on Horizon answer 404):

```text
https://stellar.expert/explorer/testnet/account/GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV
https://stellar.expert/explorer/testnet/account/GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV
https://stellar.expert/explorer/testnet/account/GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV
https://horizon-testnet.stellar.org/accounts/GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV
```

The key frames, taken from the finished video: [`01-before-balances.png`](frames/01-before-balances.png), [`02-before-history.png`](frames/02-before-history.png), [`03-plan.png`](frames/03-plan.png), [`04-confirmation.png`](frames/04-confirmation.png), [`05-transactions.png`](frames/05-transactions.png), [`06-receipt.png`](frames/06-receipt.png), [`07-explorer-after.png`](frames/07-explorer-after.png), [`08-horizon-404.png`](frames/08-horizon-404.png).

## Recordings

[`fixture-create.cast`](fixture-create.cast), [`plan.cast`](plan.cast) and [`close.cast`](close.cast) are asciicast v2 files (https://docs.asciinema.org/manual/asciicast/v2/): every byte the terminal showed, with its time. `asciinema play close.cast` replays the close as it ran, the typed confirmation included; the commands' secrets came from a `.env` file written right before the close and removed right after it, and appear nowhere.
