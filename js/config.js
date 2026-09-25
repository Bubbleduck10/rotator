// Where this page points, and what it is honest about.

export const CONFIG = {
  cluster: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  programId: "5ZCcQQtgHnhKmHMy2ct2cUJmvEC6YQTzTgnrnxtWpPzG",
  mint: "gnoH1WayBSzzUpqc2A637zxJuEkSzKbSF2A73YsuNkB",
  pool: "9Aj6PvL6pnf2eFC2TTKG6PEzX7E6Ar4Ur5Qwp2CmCZ6C",
  explorer: "https://explorer.solana.com/{kind}/{id}?cluster=devnet",

  /**
   * The deployed pool runs in ORACLE_TEST mode on mock feeds, not on Pyth.
   *
   * This matters for what the page is allowed to claim. The live Pyth prices
   * shown alongside are the ones a MAINNET pool would read; they are not what
   * is moving this pool's index. Putting them side by side without saying so
   * would imply a connection that does not exist, which is the single most
   * misleading thing this page could do.
   */
  oracleMode: "test",

  xDecimals: 6,
  xSymbol: "SWAP",
};

/**
 * Symbol order must match the feeds passed at initialize — the program stores
 * feed addresses, not tickers, so nothing on chain can correct a wrong order
 * here. It would simply mislabel every rotation.
 */
export const SYMBOLS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN"];

/**
 * One accent per stock, so the whole page tints as the pairing rotates — the
 * mechanic is legible at a glance rather than buried in a field.
 *
 * These are deliberately MID-TONE. Each one has to stay legible in two places
 * at once: against the near-black hero panel and against warm paper in the
 * masthead and stat row. A colour picked for either background alone fails on
 * the other — the earlier silver read well on black and vanished on paper.
 */
export const ACCENTS = {
  AAPL: "#5b7a8c",
  TSLA: "#b0433c",
  NVDA: "#5d8a2b",
  MSFT: "#2c7cb0",
  AMZN: "#bd7a1c",
};

export const explorerUrl = (kind, id) =>
  CONFIG.explorer.replace("{kind}", kind).replace("{id}", id);
