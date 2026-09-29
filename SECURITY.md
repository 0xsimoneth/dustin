# Security policy

Dustin signs transactions that cannot be undone, and it handles secret keys, so a flaw in it matters even on the testnet. Please report one privately, not in a public issue.

## How to report a vulnerability

Use GitHub's private vulnerability reporting for this repository ([GitHub documentation](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository)): on the repository's page (https://github.com/0xsimoneth/dustin), open the **Security** tab and choose **Report a vulnerability**. The report stays private between you and the maintainer until an advisory is published. If the button is missing, open a public issue that asks for a private channel and holds no detail of the problem.

Please include:

- the version (`dustin --version`) or the commit, and Node.js's version;
- the command or the SDK call, and what you expected;
- what happened, with the exit code and the output or the report (`--report <file>` or `--json`).

Never include a secret key, not even a testnet one: Dustin's reports and output hold public keys, hashes and envelopes only, but check once more before you attach anything. If a secret was exposed, treat it as compromised and create a new account.

A fix is released as a new version, and the advisory names the versions it affects.

## Scope

Dustin is **testnet only** in this release (`SUCCESSFUL_SOW.md`, section 4.1): it refuses any network passphrase but `Test SDF Network ; September 2015`, any Horizon that does not serve the testnet, and an explorer base that names another network. Reports about the following are in scope:

- a secret key reaching output, a report, a `--report` file, a `--json` line, an error message or a file Dustin writes, or being read from the command line;
- a path that submits, or signs for, a network other than the testnet;
- the fee sponsor signing anything but a fee-bump envelope, or beyond the per-close budget;
- a transaction submitted without the typed confirmation, `--yes` or `confirm: true`, or a plan that is not the one shown;
- the published package (`stellar-dustin` on npm) carrying anything but the built code, the README, the changelog, the license and `package.json`.

Out of scope: mainnet use (not supported), the security of the Stellar network, of Horizon or of Friendbot, the key management of an integrator's own `Signer`, and the pages of third-party explorers.

## Supported versions

Only the latest release gets fixes while the version starts with 0.
