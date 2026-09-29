# Matrix row B-03: the existing tool and Dustin on the same recipe

The side-by-side table of matrix row B-03 (docs/edge-cases-and-test-matrix.md, section 4), written by `node scripts/baseline-b03.mjs`. The existing tool's rows come from the builder's recordings ([README.md](README.md)); Dustin's rows from the two runs linked below, each on a fixture rebuilt from the baseline recipe.

Recipe hash of the baseline fixture `messy-20260926T035942Z`: `a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b`. Both rebuilt fixtures carry the same recipe hash.

| Row | Tool | Fixture | Transactions submitted | Where it stopped | Account afterwards | XLM to the destination |
|---|---|---|---|---|---|---|
| B-01 | StellarExpert Account Demolisher | the baseline fixture `messy-20260926T035942Z` (zero spendable) | `<pending: transactions, from the recording>` | `<pending: stop point, from the recording>` | `<pending: state, from the recording>` | `<pending: XLM delivered, from the recording>` |
| B-02 | StellarExpert Account Demolisher | the baseline recipe plus 1 XLM | `<pending: transactions, from the recording>` | `<pending: stop point, from the recording>` | `<pending: state, from the recording>` | `<pending: XLM delivered, from the recording>` |
| B-03 | Dustin 0.1.0 (`dustin close --execute`) | FIX-base-1 (zero spendable), [`messy-20260929T185242Z-9f9ece`](../../evidence/runs/20260929T185240Z-b03-rehearsal-base1/summary.md), `GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO` | 3, every one a fee bump paid by the sponsor: `74107c9554ba...`, `12cc646a8022...`, `d83b46ec8578...` | nowhere: `closed` | gone, Horizon 404 | 4.0000007 XLM |
| B-03 | Dustin 0.1.0 (`dustin close --execute`) | FIX-base-2 (plus 1 XLM), [`messy-20260929T185401Z-9a66ec`](../../evidence/runs/20260929T185359Z-b03-rehearsal-base2/summary.md), `GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ` | 3, every one a fee bump paid by the sponsor: `cce9e8532022...`, `a932f3dc988e...`, `6d4307854ac2...` | nowhere: `closed` | gone, Horizon 404 | 5.0000007 XLM |

Dustin's runs: [`evidence/runs/20260929T185240Z-b03-rehearsal-base1`](../../evidence/runs/20260929T185240Z-b03-rehearsal-base1/summary.md), [`evidence/runs/20260929T185359Z-b03-rehearsal-base2`](../../evidence/runs/20260929T185359Z-b03-rehearsal-base2/summary.md).
