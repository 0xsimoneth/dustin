/**
 * The builder's baseline fixture on the testnet (`test/fixtures/horizon/messy/manifest.json` in
 * the repository): a messy account at its minimum balance, built on 2026-09-26 for the SOW's
 * success metric and never touched since. Planning reads it and changes nothing. These are public
 * addresses; the page holds no secret of any account.
 */
export const EXAMPLE = {
  account: "GAZF3X7YYCI7PHZYZDQOGPLVN2RVD37YIQG7YEY6QJW6IK224Y4R3MBK",
  destination: "GBQGFM635UIV2BTCTYSMKKJBESY47VXZLCIPGKW3GZJSSY6B45U2DH2C",
  sponsor: "GBISNFQ4KAM62Z22MGKULQ7PI6H3RVMMWJZTWU6NP2DAIYAVN7XYQN4K",
} as const;
