# Runbook: rewriting the history for review findings R4 and R5

For the builder. The history rewrite was the builder's decision (PRD decision D-7 postponed it; review findings R4 and R5 of [`docs/reviews/2026-09-26-e0-e2-review.md`](../reviews/2026-09-26-e0-e2-review.md), D-15 of [`docs/reviews/2026-09-29-e4-review.md`](../reviews/2026-09-29-e4-review.md)), and it was done on 2026-09-30 (below). This page says what changes, how to do it in about 30 minutes, how to check it, and how to clean up GitHub afterwards. It never shows the personal data itself: every command that needs it reads it from the old commit into a file outside the repository.

## Done on 2026-09-30

The builder decided on 2026-09-30 to rewrite, and steps 1 to 7 ran as this page describes, on a fresh clone:

- `git filter-repo` 2.47.0 with `--sensitive-data-removal`, `--replace-text` and `--mailmap`. First changed commit: the root, `bedc4a6`, now `77d36b9`. 364 commits before and after; the tree of `main` unchanged (`3f64462`).
- Checks before the push: no old value left in any object of the rewritten repository, reachable or not, nor in any name, e-mail or message; the only e-mails left are `333815469+0xsimoneth@users.noreply.github.com` and `noreply@github.com`; the first version of `SUCCESSFUL_SOW.md` holds the redacted rows.
- Step 6: commit `622d1b8` rewrote 620 citations in 43 files, each an exact old-to-new pair of the commit-map. This page and `test/unit/scripts/remap-commit-hashes.test.ts` keep their hashes: here they name the history before the rewrite, on purpose (`ca7bf53` is now `c6d8ee7`, `706cd73` is now `bca0853`, `bedc4a6` is now `77d36b9`); in the test they are test data.
- Step 7: `main` pushed with `--force-with-lease` against the old tip `d7f557b`; `main` was the only branch on GitHub and no pull request ever existed. CI passed on the new tip on Node 22.12.0, 22 and 24 ([run 36639605562](https://github.com/0xsimoneth/dustin/actions/runs/36639605562)).
- After the push, a repository ruleset ("main: no force push, no deletion") blocks force pushes to `main` and its deletion, with no bypass; direct pushes stay allowed. A later rewrite has to switch it off for its push and on again after.
- Two backups of the old history, a mirror clone of GitHub and a bundle of every local ref, are kept offline, outside the repository, until step 8 is confirmed.

Still the builder's: step 8 (the GitHub Support request), and the rest of step 9 (the usual working copy now tracks the new `main`; the agent worktrees of past sessions and their branches still point at the old history and are to be removed there). The run pages of GitHub Actions keep naming the old hashes; [`evidence/tests/README.md`](../../evidence/tests/README.md#ci-runs-and-the-rewritten-history) maps them.

## What is in the history

A scan on 2026-09-29 of every object reachable from every ref (359 commits, their trees and blobs, and every commit message) found the personal data of R4 and R5 in exactly two objects:

| Finding | Object | What changes |
|---|---|---|
| R4 | The version of `SUCCESSFUL_SOW.md` added by commit `ca7bf53` ("setup project"), unchanged until commit `706cd73` redacted it | Three rows of the table in section 1, lines 12, 13 and 15 of that version of the file: the second cell of "Builder / Team Name" (line 12), of "Primary Contact (Name + Email)" (line 13, whose label also becomes "Primary Contact") and of "Ambassador Chapter Lead" (line 15). Each whole line is replaced by the redacted row that `706cd73` wrote at lines 13, 14 and 16 of its version (the file gained a note line at the top), which is also what `SUCCESSFUL_SOW.md` holds today. No other line and no other file changes. |
| R5 | Commit `bedc4a6` ("Initial commit", the root commit, made on GitHub's web page) | Its author e-mail becomes the noreply address `333815469+0xsimoneth@users.noreply.github.com`; the author name `0xsimoneth` stays. Its committer, `GitHub <noreply@github.com>`, is not personal and stays. |

No commit message holds any of it, and the current files hold none of it.

## What the rewrite changes, and when to do it

- **Every commit hash changes**, because the root commit changes. The documents cite commits by hash: a dry run of `scripts/remap-commit-hashes.mjs` on 2026-09-29 found 617 citations in 43 files (the reviews, the progress log, the test matrix, the stories, the evidence headers). Step 6 rewrites them to the new hashes in one commit.
- **The content of the files at the tip does not change.** The tree of `main` after the rewrite is byte for byte the tree before it (step 5 checks this); only the history does.
- **GitHub Actions runs keep the old hashes.** The run pages cited in the evidence (for example [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977)) stay reachable, but their commit links point at commits that are no longer in the repository.
- **Local copies must be replaced** (step 9). A `git pull` from an old copy would bring the old history back.
- **The right moment is now**: before the `v0.1.0` tag, before the npm publish (the package's `repository` link and the release notes then point at the final history), and while the repository has no forks. The npm package itself carries no history, so the rewrite is not a publish blocker; it is cheaper before than after.

## Before you start

- Everything is committed and pushed; no pull request is open (`gh pr list --state all`); nobody else is pushing.
- Check the repository's counters: `gh auth switch --user 0xsimoneth && gh auth status`, then `gh api repos/0xsimoneth/dustin --jq '{forks: .forks_count, stars: .stargazers_count}'`. A fork keeps the old history whatever happens here.
- If a branch protection rule on `main` refuses force pushes, allow them for the duration of step 7 and restore the rule after it.
- As read on 2026-09-29: 0 forks, 0 stars, no pull request ever opened, and no branch protection on `main`, so nothing on GitHub stands in the way of step 7.

## Step 1: install git filter-repo

```bash
brew install git-filter-repo
git filter-repo --version      # 2.47 or newer, for --sensitive-data-removal
```

`pip3 install --user git-filter-repo` is the alternative where Homebrew is not available.

## Step 2: a fresh clone in a scratch workspace

filter-repo refuses to run outside a fresh clone, and a fresh clone keeps the working copy (with its `.fixture/` keys) out of harm's way.

```bash
W="$(mktemp -d)"                       # scratch workspace; the input files stay here, outside any repository
git clone git@github-work:0xsimoneth/dustin.git "$W/dustin"
cd "$W/dustin"
git config user.name 0xsimoneth
git config user.email 333815469+0xsimoneth@users.noreply.github.com
git config user.name && git config user.email
```

The two `git config` lines matter: the automatic switch to the `0xsimoneth` identity applies only inside the usual working copy, and step 6 makes a commit in this clone. Stop if the check does not print `0xsimoneth` and the noreply address.

Record two facts of the history before the rewrite:

```bash
git rev-parse 'HEAD^{tree}' > "$W/tree-before"
git rev-list --count HEAD > "$W/count-before"
```

## Step 3: the three input files, written outside the repository

None of these commands prints the personal data. Do not `cat` the files on a shared screen.

```bash
# The three rows as ca7bf53 committed them (lines 12, 13 and 15) and as 706cd73 redacted them (lines 13, 14 and 16).
git show ca7bf53:SUCCESSFUL_SOW.md | sed -n '12p;13p;15p' > "$W/old-rows"
git show 706cd73:SUCCESSFUL_SOW.md | sed -n '13p;14p;16p' > "$W/new-rows"

# --replace-text: one "<old line>==><new line>" expression per row (literal matching, the default).
awk 'NR==FNR { old[FNR] = $0; next } { print old[FNR] "==>" $0 }' "$W/old-rows" "$W/new-rows" > "$W/replacements.txt"

# --mailmap: "<proper name> <proper e-mail> <e-mail in the commit>".
printf '0xsimoneth <333815469+0xsimoneth@users.noreply.github.com> <%s>\n' "$(git log -1 --format=%ae bedc4a6)" > "$W/mailmap"

# For the checks: the three old cell values and the old e-mail, one per line.
awk -F'|' '{ gsub(/^ +| +$/, "", $3); print $3 }' "$W/old-rows" > "$W/tokens"
git log -1 --format=%ae bedc4a6 >> "$W/tokens"

wc -l "$W/replacements.txt" "$W/mailmap" "$W/tokens"   # 3, 1 and 4 lines
grep -c '==>' "$W/replacements.txt"                      # 3
grep -c -E '^(literal|regex|glob):' "$W/replacements.txt" # 0: every row starts with "|", so matching is literal
```

Count the hits before the rewrite, so the check after it means something:

```bash
git log --all -p --format='%an %ae %cn %ce%n%B' | grep -c -F -f "$W/tokens"   # more than 0
```

## Step 4: the rewrite

```bash
git filter-repo --sensitive-data-removal --replace-text "$W/replacements.txt" --mailmap "$W/mailmap"
cp -R .git/filter-repo "$W/filter-repo-output"   # commit-map, ref-map, first-changed-commits
cat "$W/filter-repo-output/first-changed-commits"
```

The first changed commit should be the full hash of `bedc4a6`, the root commit. filter-repo also prints what it found and what to do next; keep that output with the files above.

## Step 5: check the result before anything leaves the machine

```bash
git log --all -p --format='%an %ae %cn %ce%n%B' | grep -c -F -f "$W/tokens"   # 0
git log --all --format='%ae%n%ce' | sort -u      # only 333815469+0xsimoneth@users.noreply.github.com and noreply@github.com
test "$(git rev-parse 'HEAD^{tree}')" = "$(cat "$W/tree-before")" && echo "tip unchanged"
test "$(git rev-list --count HEAD)" = "$(cat "$W/count-before")" && echo "no commit lost"
git show "$(git rev-list --max-parents=0 HEAD)" --format='%an <%ae>' --no-patch   # the root commit's author: the noreply address
first="$(git log --reverse --format=%H --diff-filter=A -- SUCCESSFUL_SOW.md | head -1)"
git show "$first:SUCCESSFUL_SOW.md" | sed -n '9,17p'   # the table as it was first committed, with the redacted rows
```

Every line must hold. If one does not, delete `$W` and start again from step 2: nothing on GitHub has changed yet.

## Step 6: rewrite the commit hashes the documents cite

```bash
node scripts/remap-commit-hashes.mjs .git/filter-repo/commit-map            # dry run: lists <file>:<line>: <old> -> <new>
node scripts/remap-commit-hashes.mjs .git/filter-repo/commit-map --apply    # writes the files
git diff --stat
npm ci && npm run format:check && npm test
```

Read the dry run first: every line should be a commit citation (about 617 in 43 files); a token the script could not map is listed as "left as it is" with the reason. The script touches only lower-case hexadecimal tokens of 7 to 40 characters that stand alone and name exactly one old commit, so transaction hashes, addresses and ledger numbers are never changed. Then commit, with the identity checked again:

```bash
git config user.name && git config user.email
git add -u && git commit -m "Docs: the commit hashes cited in the documents remapped to the rewritten history (review findings R4, R5; decision D-7)"
```

## Step 7: push over GitHub

filter-repo may have removed the `origin` remote, as a guard against pushing by accident. Put it back exactly as the repository rules require, then push every ref:

```bash
git remote -v
git remote get-url origin >/dev/null 2>&1 || git remote add origin git@github-work:0xsimoneth/dustin.git
git remote get-url origin        # git@github-work:0xsimoneth/dustin.git, never git@github.com:...
git push --force --mirror origin
```

GitHub refuses updates to its read-only `refs/pull/*` refs; that refusal is expected. Check the result:

```bash
git ls-remote origin | head
gh run list --limit 3            # CI runs on the new main
```

## Step 8: ask GitHub Support to drop the old objects

After the force push, GitHub can still serve the old commits by their hash (cached views, pull request refs) until its support team removes them. Open a ticket at https://support.github.com/contact (topic: removing sensitive data) with:

- the repository: `0xsimoneth/dustin`;
- the number of affected pull requests (0 unless one was opened; `gh pr list --state all`);
- the first changed commit(s) that filter-repo reported, from `$W/filter-repo-output/first-changed-commits`;
- that no LFS objects are involved.

Until they confirm, `https://github.com/0xsimoneth/dustin/commit/<old hash>` may still open. After they confirm, check that it answers 404.

## Step 9: replace the local copies

The usual working copy still holds the old history. Replace it with a fresh clone, keeping the files git ignores that must survive:

1. In the old working copy, list what to keep: `git status --ignored --short`. Keep **`.fixture/`** (the keys of every fixture, among them the baseline fixture `messy-20260926T035942Z` that the Demolisher recording needs), `.env` if there is one, the local tooling `stellar-build/` and `.stellar-build/`, and the local settings under `.claude/` (not `.claude/worktrees/`).
2. Remove the agent worktrees of past sessions: `git worktree list`, then `git worktree remove <path>` for each one under `.claude/worktrees/`.
3. Rename the old working copy, clone the repository again at the old working copy's path (so the automatic identity switch applies), and move the kept files into the new clone. Check `git config user.name`, `git config user.email` and `git remote get-url origin` there.
4. Keep the renamed old copy offline until GitHub Support confirms step 8, then delete it. It is the only way back (a `git push --force --mirror` from it restores the old history, and the personal data with it).

## Step 10: the records

- `docs/stories/sprint-status.yaml` and `docs/progress-log.md`: a session entry saying the history was rewritten, with the date, the first changed commit and the support ticket number.
- `docs/prd.md`, decision D-7: add that the rewrite was done on that date.
- Then the release: [`docs/runbooks/release.md`](release.md) (the `v0.1.0` tag goes on the rewritten history).

## Sources

- git filter-repo manual (`--replace-text`, `--mailmap`, `--sensitive-data-removal`, the commit-map and first-changed-commits files, why `origin` is removed, `git push --force --mirror origin`): https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt
- GitHub, removing sensitive data from a repository (fresh clone, `--sensitive-data-removal`, the mirror push, what GitHub Support needs): https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- The mailmap format: https://git-scm.com/docs/gitmailmap
