// Where the page points. Everything that changes at launch is in CONFIG.
//
// Pre-launch (mint empty): the rotation runs as a preview on its own clock, the
// stats and rounds feed say plainly that nothing has launched, and no number on
// the page pretends to be live.

export const CONFIG = {
  /** $ROTATOR's mint — set at launch */
  mint: "",
  /** unix seconds the rotation started — must equal the keeper's T0 */
  t0: 0,
  /** the wallet that receives the creator fees and pays holders */
  payout: "4LN3aSbKKuBvirqaZBPo4VKSUSYqq282Hsc2RVTcYvcp",
  /** where the 5% operations cut is swept */
  ops: "E82hb8ssuhX3bi1cWPFuMNeGcCCv6rSp8bByMXSnTWqN",
  /** keyless and browser-reachable; api.mainnet-beta refuses browsers */
  rpc: "https://solana-rpc.publicnode.com",
  /** the coin's StonkFun page and X account — set at launch */
  stonkfun: "",
  x: "https://x.com/StonkRotator",
};

export const PERIOD_SECS = 300;

/**
 * Rotation order, pinned by mint — the same five, in the same order, as the
 * keeper. The keeper decides what is paid; this list only has to agree with it
 * so the page names the right stock for each window.
 *
 * Accents are the art's tile colours, bright enough to glow on the night background.
 */
export const STOCKS = [
  { symbol: "AAPL", name: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", pyth: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW", accent: "#dfe3ea" },
  { symbol: "TSLA", name: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", pyth: "FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z", accent: "#ff4150" },
  { symbol: "NVDA", name: "NVIDIA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", pyth: "5VETJ8h3p4JrESYrzhjTDAWPEjDjfcnduqe9CjxgqBNd", accent: "#7ee03a" },
  { symbol: "MSFT", name: "Microsoft", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", pyth: "EKhrgXYwqsjgxF71Gxznui1zdoeqgxJzzPzfefEmm5un", accent: "#3aa0ff" },
  { symbol: "AMZN", name: "Amazon", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", pyth: "4eT5d4SJ7GjD8HMpMysSNoPV7RBVTBGzoSEkynmPLMPS", accent: "#ff9d1a" },
];

/** never paid, whatever they hold — mirrors the keeper's exclusions() */
export const EXCLUDED = {
  [CONFIG.payout]: "the payout wallet",
  [CONFIG.ops]: "the ops wallet",
  "1nc1nerator11111111111111111111111111111111": "the burn address",
};

export const XSTOCK_DECIMALS = 8;

export const solscan = (kind, id) => `https://solscan.io/${kind}/${id}`;
