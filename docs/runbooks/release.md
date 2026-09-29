# Runbook: releasing 0.1.0

For the builder and the agent. The builder publishes to npm and approves every step that leaves the machine (the tag push, the GitHub release, the settings change); the agent does the rest, on the builder's word, and records it. Nothing here has been run.

Order: first the history decision ([`history-rewrite.md`](history-rewrite.md)), because the `v0.1.0` tag and the release must point at the final history; then the builder's publish; then the agent's steps. Every `gh` command below runs after `gh auth switch --user 0xsimoneth` and `gh auth status`; switch `gh` back to your other account when done.

## Before the release: one repository setting

`SECURITY.md` asks reporters to use GitHub's private vulnerability reporting, which is off until someone with admin rights switches it on (Epic 4 review, part 2, decision 3):

- in the browser: the repository's Settings, "Advanced Security" (or "Code security"), "Private vulnerability reporting", Enable; or
- with the builder's approval, the agent runs `gh api -X PUT repos/0xsimoneth/dustin/private-vulnerability-reporting` (answers 204).

Check: `gh api repos/0xsimoneth/dustin/private-vulnerability-reporting` prints `{"enabled":true}`. On 2026-09-29 it printed `{"enabled":false}`.

## The builder: publish to npm

From a clean checkout of `main` at the commit to release, with Node 22.12 or newer:

```bash
git switch main && git pull --ff-only && git status --short   # nothing listed
npm ci
npm pack --dry-run && npm run check:package                    # 11 files, "package check passed"
npm login                                                      # the publishing account, with 2FA
npm publish --access public                                    # prepack builds dist/; prepublishOnly runs lint, typecheck and the offline tests
npm view stellar-dustin@0.1.0 version gitHead dist.shasum
```

`gitHead` is the commit npm recorded for the published tarball; the tag goes on it. Tell the agent "0.1.0 is published" with that output.

## The agent: after the publish

### 1. Check what the registry serves

```bash
T="$(mktemp -d)"
npm view stellar-dustin@0.1.0 version gitHead dist.tarball dist.shasum dist.integrity
npm pack stellar-dustin@0.1.0 --pack-destination "$T" && tar -tzf "$T"/stellar-dustin-0.1.0.tgz   # the 11 files of check:package
git worktree add "$T/at-gitHead" <gitHead> && (cd "$T/at-gitHead" && npm ci && npm pack --pack-destination "$T/local")
shasum "$T"/stellar-dustin-0.1.0.tgz "$T"/local/stellar-dustin-0.1.0.tgz   # equal: the build is reproducible (review of 2026-09-29, step 3)
(mkdir "$T/app" && cd "$T/app" && npm init -y >/dev/null && npm install stellar-dustin@0.1.0 && npx --no-install dustin --version)   # 0.1.0
git worktree remove "$T/at-gitHead"
```

Stop and tell the builder if a file list, a checksum or the version differs.

### 2. The tag (on the builder's word)

```bash
git tag -a v0.1.0 <gitHead> -m "stellar-dustin 0.1.0"
git push origin v0.1.0
```

The tag is annotated, on the published commit, and never moved afterwards.

### 3. The release notes, from the CHANGELOG

```bash
awk '/^## \[0\.1\.0\]/ { on = 1; next } /^## \[/ || /^\[[^]]+\]: / { on = 0 } on' CHANGELOG.md > "$T/notes.md"
cat >> "$T/notes.md" <<'EOF'

## Links

- npm: https://www.npmjs.com/package/stellar-dustin/v/0.1.0
- Evidence package, row by row against the SOW: https://github.com/0xsimoneth/dustin/blob/v0.1.0/evidence/README.md
- Write-up (ordering rules and known limits): https://github.com/0xsimoneth/dustin/blob/v0.1.0/docs/write-up.md
- The 60-second demo: `dustin-demo-60s.mp4` below, captions in `dustin-demo.srt`

Testnet only: every entry point refuses any network but the Stellar testnet.
EOF
```

Read the notes once: they must say what the CHANGELOG says and nothing more.

### 4. The draft release with the video

The video is `evidence/demo/dustin-demo-60s.mp4` (ignored by git). Check it is the file the evidence names, then attach it to a draft:

```bash
shasum -a 256 evidence/demo/dustin-demo-60s.mp4     # the SHA-256 in evidence/demo/README.md
gh release create v0.1.0 --draft --verify-tag --title "stellar-dustin 0.1.0" --notes-file "$T/notes.md" \
  "evidence/demo/dustin-demo-60s.mp4#Demo video, 60 s, 1920x1080, captions burned in" \
  "evidence/demo/dustin-demo.srt#Captions of the demo video (.srt)"
```

The builder reads the draft on GitHub and publishes it (or tells the agent to run `gh release edit v0.1.0 --draft=false`). Once it is public, the video's stable address is `https://github.com/0xsimoneth/dustin/releases/download/v0.1.0/dustin-demo-60s.mp4`; check it answers 200 with the file's size: `curl -sIL <address> | grep -i -E '^(HTTP/|content-length)'`.

### 5. The links, in one commit

Every `<pending: ...>` that the release settles is replaced; the others stay the builder's. `grep -rn '<pending:' README.md evidence docs` lists them before and after.

| File | What changes |
|---|---|
| `README.md` | the status line (published; `npm install stellar-dustin`), the Demo section (the video's address, and the GIF `evidence/demo/dustin-demo.gif` inline), the install section's "once 0.1.0 is published" wording, the D2, documentation and week-4 rows of the SOW table |
| `evidence/demo/README.md` | the video link; check that its duration and SHA-256 are the uploaded file's |
| `evidence/README.md` | SOW 6.1, the D2 and documentation rows (the video); the pending table (the video and the npm publish done, with links); Appendix A, the week-4 row and the D2 and D4 rows (D2 is done once the video is linked; D4 once the video and the npm package are); the sentence that counts the builder's pending items |
| `evidence/completion-report.md` | the header (the tag `v0.1.0`, the full `gitHead`, the npm URL); D1's "Source" commit; D2's video; D4's video and npm rows; section C, week 4 |
| `CHANGELOG.md` | `## [0.1.0] - <publish date>`, and the compare and tag links at the bottom |
| `docs/stories/4-4-npm-publish-readme-integration-notes.md`, `4-6-demo-video.md`, `sprint-status.yaml` | E4-S4 done (the package is on npm); E4-S6 done once the builder approved the video and it is linked |
| `docs/progress-log.md`, `sprint-status.yaml` `sessions:` | a session entry: the publish, the tag, the release, the links |

### 6. The gates, then the push (on the builder's word)

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
npm run evidence:check          # every link, the release asset and the npm page among them; exit 0, or 3 for bot protections only
git config user.name && git config user.email   # 0xsimoneth and the noreply address
git add <the files above> && git commit -m "Docs: 0.1.0 released: npm, the v0.1.0 tag, the demo video as a release asset, and the links"
git push origin main && gh run list --limit 3
```

Optionally, on the builder's word, run the live tier once more on the tag and cite that run beside the screenshot of `evidence/tests/`: `gh workflow run testnet.yml --ref v0.1.0`, then `gh run list --workflow testnet.yml --limit 1`.

## Sources

- npm, `npm publish` and `gitHead`: https://docs.npmjs.com/cli/v11/commands/npm-publish, https://docs.npmjs.com/cli/v11/commands/npm-view
- GitHub CLI, `gh release create` (assets with a display label after `#`, `--draft`, `--verify-tag`): https://cli.github.com/manual/gh_release_create
- GitHub, private vulnerability reporting (`GET`, `PUT` and `DELETE /repos/{owner}/{repo}/private-vulnerability-reporting`): https://docs.github.com/en/rest/repos/repos#enable-private-vulnerability-reporting-for-a-repository
