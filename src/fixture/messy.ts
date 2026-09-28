import { Asset, Operation, type xdr } from "@stellar/stellar-sdk";

/**
 * The `messy` fixture profile (docs/README.md canonical decision 3; recipe from
 * docs/edge-cases-and-test-matrix.md section 5.2). Every balance is disposable, so the account can be
 * closed completely; the unclosable case lives in the separate `edge` profile.
 */
export type MessyRole =
  "sponsor" | "reserveSponsor" | "issuer" | "marketMaker" | "destination" | "fixture";

export type MessyRoles = Record<MessyRole, string>;

/** Every account of a messy fixture, in the order the builder creates their keys. */
export const MESSY_ROLES: readonly MessyRole[] = [
  "sponsor",
  "reserveSponsor",
  "issuer",
  "marketMaker",
  "destination",
  "fixture",
];

export type ExpectedRung = "path_payment" | "return_to_issuer";

export interface MessyAsset {
  code: string;
  dust: string;
  /** The rung the default (SOW-order) ladder is expected to pick. */
  expectedRung: ExpectedRung;
  sponsored?: boolean;
  destinationTrusts?: boolean;
}

export interface MessyOffer {
  selling: string;
  buying: string;
  amount: string;
  price: string;
}

export const MESSY = {
  profile: "messy",
  startingBalances: {
    reserveSponsor: "10",
    issuer: "10",
    marketMaker: "100",
    destination: "10",
    fixture: "10",
  } satisfies Record<Exclude<MessyRole, "sponsor">, string>,
  // Amounts below 1e-6 on purpose: JavaScript numbers would print them in scientific notation.
  assets: [
    { code: "DUSTA", dust: "0.0000007", expectedRung: "path_payment" },
    { code: "DUSTB", dust: "0.0000003", expectedRung: "return_to_issuer" },
    { code: "DUSTC", dust: "0.0000005", expectedRung: "return_to_issuer", destinationTrusts: true },
    { code: "SPTA", dust: "0.0000001", expectedRung: "return_to_issuer", sponsored: true },
  ] satisfies MessyAsset[],
  /** The market maker bids for DUSTA with XLM so that a strict-send path to XLM exists. */
  marketMakerBid: { asset: "DUSTA", buyAmount: "10", price: "1" },
  /**
   * The fixture's own offers. Neither sells XLM, so native selling liabilities stay 0. The DUSTA
   * offer asks 100 XLM per DUSTA, far above the bid of 1, because a sell limit at or below the best
   * bid is marketable and would fill at once
   * (https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools#orders).
   * The DUSTC offer buys DUSTB, giving DUSTB buying liabilities that must be cleared before its
   * trustline can be removed.
   */
  offers: [
    { selling: "DUSTA", buying: "native", amount: "0.0000002", price: "100" },
    { selling: "DUSTC", buying: "DUSTB", amount: "0.0000002", price: "1" },
  ] satisfies MessyOffer[],
  dataEntry: { name: "dustin.fixture", value: "messy" },
  destinationTrustLimit: "1000",
  expected: {
    /** 4 trustlines + 2 offers + 1 data entry. */
    subentryCount: 7,
    numSponsored: 1,
    /** Minimum balance in base reserves: 2 + 7 - 1. */
    minimumBaseReserves: 8,
  },
} as const;

export interface MessyStep {
  name: string;
  /** Transaction source. Fixture-side transactions are fee-bumped by the sponsor. */
  source: MessyRole;
  signers: MessyRole[];
  feeBumped: boolean;
  operations: xdr.Operation[];
}

export function messyAsset(code: string, issuer: string): Asset {
  return code === "native" ? Asset.native() : new Asset(code, issuer);
}

/** The ordered construction steps as a pure function of the participants' public keys. */
export function messySteps(roles: MessyRoles): MessyStep[] {
  const asset = (code: string) => messyAsset(code, roles.issuer);
  const assets: readonly MessyAsset[] = MESSY.assets;
  return [
    {
      name: "create-accounts",
      source: "sponsor",
      signers: ["sponsor"],
      feeBumped: false,
      operations: (Object.entries(MESSY.startingBalances) as [MessyRole, string][]).map(
        ([role, startingBalance]) =>
          Operation.createAccount({ destination: roles[role], startingBalance }),
      ),
    },
    {
      name: "trustlines",
      source: "fixture",
      signers: ["fixture", "marketMaker", "destination"],
      feeBumped: true,
      operations: [
        ...assets
          .filter((a) => !a.sponsored)
          .map((a) => Operation.changeTrust({ asset: asset(a.code) })),
        Operation.changeTrust({
          asset: asset(MESSY.marketMakerBid.asset),
          source: roles.marketMaker,
        }),
        ...assets
          .filter((a) => a.destinationTrusts)
          .map((a) =>
            Operation.changeTrust({
              asset: asset(a.code),
              limit: MESSY.destinationTrustLimit,
              source: roles.destination,
            }),
          ),
      ],
    },
    {
      // Sponsorship sandwich (CAP-33): the reserve sponsor begins, the fixture creates the
      // trustline and ends. Both sign; the fee sponsor only pays the fee.
      name: "sponsored-trustline",
      source: "fixture",
      signers: ["fixture", "reserveSponsor"],
      feeBumped: true,
      operations: [
        Operation.beginSponsoringFutureReserves({
          sponsoredId: roles.fixture,
          source: roles.reserveSponsor,
        }),
        ...assets
          .filter((a) => a.sponsored)
          .map((a) => Operation.changeTrust({ asset: asset(a.code) })),
        Operation.endSponsoringFutureReserves({}),
      ],
    },
    {
      name: "dust-payments",
      source: "issuer",
      signers: ["issuer"],
      feeBumped: true,
      operations: MESSY.assets.map((a) =>
        Operation.payment({ destination: roles.fixture, asset: asset(a.code), amount: a.dust }),
      ),
    },
    {
      name: "market-maker-bid",
      source: "marketMaker",
      signers: ["marketMaker"],
      feeBumped: true,
      operations: [
        Operation.manageBuyOffer({
          selling: Asset.native(),
          buying: asset(MESSY.marketMakerBid.asset),
          buyAmount: MESSY.marketMakerBid.buyAmount,
          price: MESSY.marketMakerBid.price,
        }),
      ],
    },
    {
      name: "offers-and-data",
      source: "fixture",
      signers: ["fixture"],
      feeBumped: true,
      operations: [
        ...MESSY.offers.map((o) =>
          Operation.manageSellOffer({
            selling: asset(o.selling),
            buying: asset(o.buying),
            amount: o.amount,
            price: o.price,
          }),
        ),
        Operation.manageData({ name: MESSY.dataEntry.name, value: MESSY.dataEntry.value }),
      ],
    },
  ];
}
