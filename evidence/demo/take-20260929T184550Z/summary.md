# Demo take 20260929T184550Z

The take behind the 60-second demo video (story E4-S6), produced by `node scripts/demo/make-demo.mjs` from the rehearsal script [`docs/demo-video-script.md`](../../../docs/demo-video-script.md) on a fresh `messy` fixture, on the Stellar testnet, with `dustin` 0.1.0. Every terminal shot is cut from the three recordings in this directory; nothing in them was typed or printed by anything but the shell and the CLI.

## Accounts

| Role | Address | Links |
|---|---|---|
| Closed account (fixture `messy-20260929T184553Z-26ba57`) | `GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID` | [explorer](https://stellar.expert/explorer/testnet/account/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID), [Horizon](https://horizon-testnet.stellar.org/accounts/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID) (404 after the close) |
| Destination | `GCQUZG3DO2QBVEMBDVLKU4WVJIC5GLEF5JXZJTLLYH7I23P2VUGLVYQU` | [explorer](https://stellar.expert/explorer/testnet/account/GCQUZG3DO2QBVEMBDVLKU4WVJIC5GLEF5JXZJTLLYH7I23P2VUGLVYQU), [Horizon](https://horizon-testnet.stellar.org/accounts/GCQUZG3DO2QBVEMBDVLKU4WVJIC5GLEF5JXZJTLLYH7I23P2VUGLVYQU) |
| Fee sponsor (fee account of every transaction) | `GDPRJ7CDJLTOIK3H4QBRMGPD34HJKLCZEEHUGXVWZ6K3642L5LY3L7XN` | [explorer](https://stellar.expert/explorer/testnet/account/GDPRJ7CDJLTOIK3H4QBRMGPD34HJKLCZEEHUGXVWZ6K3642L5LY3L7XN), [Horizon](https://horizon-testnet.stellar.org/accounts/GDPRJ7CDJLTOIK3H4QBRMGPD34HJKLCZEEHUGXVWZ6K3642L5LY3L7XN) |

## The close shown in the video

| # | Hash (the fee bump's) | Ledger | Fee charged to the sponsor | Links |
|---|---|---|---|---|
| 1 | `c50b60c4f77dc7fbab436d0e7ec07ba6308fef878f7babff41846deb3c6957e9` | 4936816 | 1,000 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/c50b60c4f77dc7fbab436d0e7ec07ba6308fef878f7babff41846deb3c6957e9), [Horizon](https://horizon-testnet.stellar.org/transactions/c50b60c4f77dc7fbab436d0e7ec07ba6308fef878f7babff41846deb3c6957e9), [record](tx-1.json) |
| 2 | `84ae16b059145bc40e32cde955dc34f1c44815aab172e68afbca3e4a5b67f735` | 4936817 | 300 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/84ae16b059145bc40e32cde955dc34f1c44815aab172e68afbca3e4a5b67f735), [Horizon](https://horizon-testnet.stellar.org/transactions/84ae16b059145bc40e32cde955dc34f1c44815aab172e68afbca3e4a5b67f735), [record](tx-2.json) |
| 3 | `17ba87c58fc5c5849e3b9510c2ba607742c87f6c0d2dcd82bfc3ffda8d32e8f3` | 4936818 | 200 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/17ba87c58fc5c5849e3b9510c2ba607742c87f6c0d2dcd82bfc3ffda8d32e8f3), [Horizon](https://horizon-testnet.stellar.org/transactions/17ba87c58fc5c5849e3b9510c2ba607742c87f6c0d2dcd82bfc3ffda8d32e8f3), [record](tx-3.json) |

Checked by the script before it wrote anything: each transaction succeeded with `fee_account` the sponsor and `source_account` the closed account ([`tx-1.json`](tx-1.json) to [`tx-3.json`](tx-3.json)); Horizon answers 404 for the account ([`account-after.json`](account-after.json)); its last operation is the merge of transaction 3 ([`operations-after.json`](operations-after.json)). The fixture met SOW Appendix B right before the take: [`fixture-verify.txt`](fixture-verify.txt), [`fixture-verification.json`](fixture-verification.json); its build is in [`fixture-manifest.json`](fixture-manifest.json) and on camera in [`fixture-create.cast`](fixture-create.cast).

## The fixture's build, on camera

| Step | Ledger | Hash |
|---|---|---|
| create-accounts | 4936795 | [`dd2e298b0ba785d0489904ab46ecf00ae5e11336120b07b08447bdc1da09dd4d`](https://stellar.expert/explorer/testnet/tx/dd2e298b0ba785d0489904ab46ecf00ae5e11336120b07b08447bdc1da09dd4d) |
| trustlines | 4936796 | [`e5f9c40ace6339661368897cd63f0ecde398dee00f2343029229cc14f942356b`](https://stellar.expert/explorer/testnet/tx/e5f9c40ace6339661368897cd63f0ecde398dee00f2343029229cc14f942356b) |
| sponsored-trustline | 4936797 | [`002edd3a05c0a14381a7858d25e7c705b0ded65018b7f06e91aaf11085e343c8`](https://stellar.expert/explorer/testnet/tx/002edd3a05c0a14381a7858d25e7c705b0ded65018b7f06e91aaf11085e343c8) |
| dust-payments | 4936798 | [`12094806c1a0f2226ab7b9157a5517de760a87019eefae2c5514f16a3bb3b839`](https://stellar.expert/explorer/testnet/tx/12094806c1a0f2226ab7b9157a5517de760a87019eefae2c5514f16a3bb3b839) |
| market-maker-bid | 4936799 | [`c679dfff4b398a33cbea72460a4f9e52fe3756ed32a4aa5ba0fe823934dfe48b`](https://stellar.expert/explorer/testnet/tx/c679dfff4b398a33cbea72460a4f9e52fe3756ed32a4aa5ba0fe823934dfe48b) |
| offers-and-data | 4936800 | [`d2cad33acfc5983ac28bc9426670ad17066c12443473bda0e72af852c53dc8a0`](https://stellar.expert/explorer/testnet/tx/d2cad33acfc5983ac28bc9426670ad17066c12443473bda0e72af852c53dc8a0) |
| drain-to-minimum | 4936801 | [`63c553b9c97fb2e7687a0ef3d409fa7b66226d9f34778164fdde181a8ae60310`](https://stellar.expert/explorer/testnet/tx/63c553b9c97fb2e7687a0ef3d409fa7b66226d9f34778164fdde181a8ae60310) |

## The video

| Field | Value |
|---|---|
| File | `evidence/demo/dustin-demo-60s.mp4` (not in git; hosted as a release asset once the builder uploads it) |
| Duration | 59.80 s |
| Size | 1920 x 1080, H.264, 30 frames per second, no sound |
| SHA-256 | `7de0640d94ccc669efa14fdcc3d46af177874a79eaa76152c2f5ca16cdbc2f1b` |
| Captions | burned in on a band at the top, and [`dustin-demo.srt`](../dustin-demo.srt) |

## The cut

| Time | Shot | Source | Caption |
|---|---|---|---|
| 0.0 to 5.0 s | title | still | This Stellar account holds 4 XLM but cannot spend any of it, so it cannot even pay the fee to close itself. |
| 5.0 to 8.0 s | before-balances | still | Before: 4 trustlines with balances, 2 open offers, 1 data entry. All 4 XLM are locked as reserve. |
| 8.0 to 10.5 s | before-offers | still | (the caption above continues) |
| 10.5 to 13.0 s | before-data | still | (the caption above continues) |
| 13.0 to 16.0 s | unsponsored | recording seconds 44.42 to 44.42 | Without a sponsor, the account cannot pay a fee: the fixture builder's own unsponsored attempt is rejected. |
| 16.0 to 26.0 s | plan | recording seconds 0.58 to 7.72, pauses over 1 s shortened | The plan is read-only. Every step has a reason. Nothing is signed yet. |
| 26.0 to 28.1 s | close-command | recording seconds 1.16 to 3.30 | To run it, you confirm the destination. |
| 28.1 to 31.0 s | confirmation | recording seconds 8.63 to 13.03, pauses over 1.2 s shortened | (the caption above continues) |
| 31.0 to 44.0 s | execution | recording seconds 13.03 to 33.27, pauses over 1.9000000000000004 s shortened | Three transactions. Every fee is paid by the sponsor. The account pays nothing. |
| 44.0 to 49.0 s | receipt | recording seconds 33.27 to 33.30 | Result: 4 XLM arrived at the destination. Fees paid by the account: zero. |
| 49.0 to 52.5 s | after-horizon-404 | still | After: the account no longer exists. Anyone can check this link. |
| 52.5 to 56.0 s | after-merge | still | (the caption above continues) |
| 56.0 to 59.8 s | end | still | Dustin. Read the plan, then close the account. Testnet only. |

The browser pages, each captured with Playwright (Chromium) when the cut above shows it, under a strip that names its URL (they are not links here: after the close the account's pages on Horizon answer 404):

```text
https://testnet.steexp.com/account/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID
https://testnet.steexp.com/account/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID/offers
https://horizon-testnet.stellar.org/accounts/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID/data/dustin.fixture
https://horizon-testnet.stellar.org/accounts/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID
https://horizon-testnet.stellar.org/accounts/GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID/operations?order=desc&limit=1
```

The key frames, taken from the finished video: [`01-before-balances.png`](frames/01-before-balances.png), [`02-plan.png`](frames/02-plan.png), [`03-confirmation.png`](frames/03-confirmation.png), [`04-transactions.png`](frames/04-transactions.png), [`05-receipt.png`](frames/05-receipt.png), [`06-horizon-404.png`](frames/06-horizon-404.png), [`07-merge-operation.png`](frames/07-merge-operation.png).

## Recordings

[`fixture-create.cast`](fixture-create.cast), [`plan.cast`](plan.cast) and [`close.cast`](close.cast) are asciicast v2 files (https://docs.asciinema.org/manual/asciicast/v2/): every byte the terminal showed, with its time. `asciinema play close.cast` replays the close as it ran, the typed confirmation included; the commands' secrets came from a `.env` file written right before the close and removed right after it, and appear nowhere.
