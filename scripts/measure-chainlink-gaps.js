/**
 * Measures, directly from mainnet round history, how often each ChainLink feed
 * the Morpheus Distributor depends on publishes later than the tolerance
 * configured in ChainLinkDataConsumer.allowedPriceUpdateDelay.
 *
 * Run:  node scripts/measure-chainlink-gaps.js
 * (set ETH_RPC_URL to use your own endpoint)
 */
const { ethers } = require("ethers");

const RPC = process.env.ETH_RPC_URL || "https://eth.drpc.org";
const CLDC = ethers.getAddress("0xd182263d06fdc463c96190005d6359cc3d3bbc5e");
const PATHS = ["stETH/USD", "wBTC/BTC,BTC/USD", "wETH/USD", "USDC/USD", "USDT/USD"];
const SAMPLE_ROUNDS = Number(process.env.SAMPLE_ROUNDS || 400);

const cldcAbi = [
  "function dataFeeds(bytes32,uint256) view returns (address)",
  "function getPathId(string) pure returns (bytes32)",
  "function allowedPriceUpdateDelay(address) view returns (uint64)",
];
const proxyAbi = [
  "function latestRound() view returns (uint256)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function description() view returns (string)",
];

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const cldc = new ethers.Contract(CLDC, cldcAbi, p);

  console.log(`ChainLinkDataConsumer ${CLDC}`);
  console.log(`sampling the last ${SAMPLE_ROUNDS} rounds of every feed it depends on\n`);

  const seen = new Set();
  for (const path of PATHS) {
    const pathId = await cldc.getPathId(path);
    for (let i = 0; i < 5; i++) {
      let feed;
      try { feed = await cldc.dataFeeds(pathId, i); } catch (e) { break; }
      if (seen.has(feed)) continue;
      seen.add(feed);

      const tolerance = Number(await cldc.allowedPriceUpdateDelay(feed));
      const agg = new ethers.Contract(feed, proxyAbi, p);
      const description = await agg.description();
      const latest = await agg.latestRound();

      const ts = [];
      for (let k = 0; k < SAMPLE_ROUNDS; k++) {
        try {
          const r = await agg.getRoundData(latest - BigInt(k));
          if (r[3] > 0n) ts.push(Number(r[3]));
        } catch (e) { break; }
      }
      ts.sort((a, b) => a - b);

      const gaps = [];
      for (let k = 1; k < ts.length; k++) gaps.push(ts[k] - ts[k - 1]);
      const over = gaps.filter((g) => g > tolerance);
      const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
      const staleSeconds = over.reduce((a, g) => a + (g - tolerance), 0);

      console.log(`${description}  (${feed})`);
      console.log(`  configured tolerance        : ${tolerance}s`);
      console.log(`  rounds sampled              : ${ts.length}  spanning ${(span / 86400).toFixed(1)} days`);
      console.log(`  largest publication gap     : ${Math.max(...gaps, 0)}s`);
      console.log(`  gaps exceeding tolerance    : ${over.length} of ${gaps.length}`);
      console.log(`  time spent past tolerance   : ${staleSeconds}s  (${((staleSeconds / Math.max(span, 1)) * 100).toFixed(3)}% of the window)`);
      if (over.length) {
        console.log(`  worst offenders             : ${over.sort((a, b) => b - a).slice(0, 6).join(", ")}`);
      }
      console.log("");
    }
  }
})();
