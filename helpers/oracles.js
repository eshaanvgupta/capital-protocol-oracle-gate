const { ethers, network } = require("hardhat");

// ChainLinkDataConsumer, Ethereum mainnet (Appendix A).
const CLDC = ethers.getAddress("0xd182263d06fdc463c96190005d6359cc3d3bbc5e");

// The five ChainLink paths registered on the Distributor, one per DepositPool.
const PATHS = ["stETH/USD", "wBTC/BTC,BTC/USD", "wETH/USD", "USDC/USD", "USDT/USD"];

const cldcAbi = [
  "function dataFeeds(bytes32,uint256) view returns (address)",
  "function getPathId(string) pure returns (bytes32)",
  "function allowedPriceUpdateDelay(address) view returns (uint64)",
  "function getChainLinkDataFeedLatestAnswer(bytes32) view returns (uint256)",
];
const aggAbi = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
];

/** Reads every feed the Distributor depends on, with its configured tolerance. */
async function readFeedConfig() {
  const c = new ethers.Contract(CLDC, cldcAbi, ethers.provider);
  const out = [];
  for (const path of PATHS) {
    const pathId = await c.getPathId(path);
    for (let i = 0; i < 5; i++) {
      let feed;
      try { feed = await c.dataFeeds(pathId, i); } catch (e) { break; }
      const agg = new ethers.Contract(feed, aggAbi, ethers.provider);
      const rd = await agg.latestRoundData();
      out.push({
        path,
        pathId,
        feed,
        description: await agg.description(),
        decimals: await agg.decimals(),
        answer: rd[1],
        updatedAt: rd[3],
        allowedDelay: await c.allowedPriceUpdateDelay(feed),
      });
    }
  }
  return out;
}

/**
 * Replaces each aggregator's code with MockAggregator, preserving the real
 * answer and decimals read at the fork block. `ageByFeed` sets, per feed
 * address, how many seconds behind `block.timestamp` its `updatedAt` sits.
 * Feeds not listed report `updatedAt == block.timestamp` (perfectly fresh).
 *
 * Only ChainLink aggregator addresses are touched. No Morpheus contract,
 * no Morpheus storage and no privileged Morpheus account is involved.
 */
async function installAggregators(feeds, ageByFeed = {}) {
  const F = await ethers.getContractFactory("MockAggregator");
  const tmp = await F.deploy();
  await tmp.waitForDeployment();
  const code = await ethers.provider.getCode(await tmp.getAddress());

  for (const f of feeds) {
    const age = BigInt(ageByFeed[f.feed.toLowerCase()] ?? ageByFeed[f.feed] ?? 0);
    await network.provider.send("hardhat_setCode", [f.feed, code]);
    await network.provider.send("hardhat_setStorageAt", [f.feed, "0x0", ethers.toBeHex(BigInt(f.answer), 32)]);
    await network.provider.send("hardhat_setStorageAt", [f.feed, "0x1", ethers.toBeHex(BigInt(f.decimals), 32)]);
    await network.provider.send("hardhat_setStorageAt", [f.feed, "0x2", ethers.toBeHex(age, 32)]);
  }
}

module.exports = { CLDC, PATHS, cldcAbi, aggAbi, readFeedConfig, installAggregators };
