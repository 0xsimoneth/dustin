// Writes the committed D1 evidence for a fixture: the dry-run plan as text and as JSON, each with
// the command line and the capture time. Usage: npm run build && npm run evidence:plan -- <manifest.json>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: npm run evidence:plan -- <manifest.json>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { fixture, destination, sponsor } = manifest.accounts;
const args = ["plan", fixture, "--to", destination, "--sponsor", sponsor];
const cli = (extra) =>
  execFileSync(process.execPath, ["dist/cli/main.js", ...args, ...extra], { encoding: "utf8" });

const capturedAt = new Date().toISOString();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const command = `dustin ${args.join(" ")}`;
const text = cli([]);
const plan = JSON.parse(cli(["--json"]));

mkdirSync("evidence/plan", { recursive: true });
writeFileSync(
  "evidence/plan/fixture-plan.txt",
  `$ ${command}\n# captured ${capturedAt} on Stellar testnet, fixture ${manifest.id}, code at commit ${commit}\n\n${text}`,
);
writeFileSync(
  "evidence/plan/fixture-plan.json",
  `${JSON.stringify({ command, capturedAt, commit, fixture: manifest.id, plan }, null, 2)}\n`,
);
console.log(
  `wrote evidence/plan/fixture-plan.txt and .json (status ${plan.status}, plan hash ${plan.planHash})`,
);
