/**
 * Capital protocol, Ethereum mainnet.
 *
 * Every state-changing user entry point on all five DepositPool proxies routes
 * through Distributor.distributeRewards(0) -> updateDepositTokensPrices(0),
 * which reverts unless EVERY ChainLink feed behind EVERY deposit token is fresh
 * by ChainLinkDataConsumer's own rule. The configured tolerance equals each
 * feed's publication heartbeat exactly, so one feed publishing a little past its
 * heartbeat disables deposits, withdrawals and claims for all five tokens at once.
 *
 * Run: npx hardhat test
 */
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deal } = require("../helpers/deal");
const { readFeedConfig, installAggregators, CLDC, cldcAbi } = require("../helpers/oracles");

// ---- Appendix A addresses, Ethereum mainnet -------------------------------
const DIST = "0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A";
const POOLS = {
  stETH: { dp: "0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790", token: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", dec: 18, path: "stETH/USD" },
  wBTC:  { dp: "0xdE283F8309Fd1AA46c95d299f6B8310716277A42", token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", dec: 8,  path: "wBTC/BTC,BTC/USD" },
  wETH:  { dp: "0x9380d72aBbD6e0Cc45095A2Ef8c2CA87d77Cb384", token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", dec: 18, path: "wETH/USD" },
  USDC:  { dp: "0x6cCE082851Add4c535352f596662521B4De4750E", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", dec: 6,  path: "USDC/USD" },
  USDT:  { dp: "0x3B51989212BEdaB926794D6bf8e9E991218cf116", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", dec: 6,  path: "USDT/USD" },
};

// Publication delay actually observed on mainnet for STETH/USD: the largest gap
// between consecutive rounds in a 399-round sample was 3696s against a 3600s
// tolerance. 3696 - 3600 = 96s past the limit.
const OBSERVED_STETH_GAP = 3696;

const dpAbi = [
  "function stake(uint256,uint256,uint128,address) external",
  "function withdraw(uint256,uint256) external",
  "function claim(uint256,address) external payable",
  "function lockClaim(uint256,uint128) external",
  "function totalDepositedInPublicPools() view returns (uint256)",
  "function usersData(address,uint256) view returns (uint128 lastStake,uint256 deposited,uint256 rate,uint256 pendingRewards,uint128 claimLockStart,uint128 claimLockEnd,uint256 virtualDeposited,uint128 lastClaim,address referrer)",
];
const distAbi = [
  "function distributeRewards(uint256) public",
  "function updateDepositTokensPrices(uint256) public",
  "function minRewardsDistributePeriod() view returns (uint256)",
  "function rewardPoolLastCalculatedTimestamp(uint256) view returns (uint128)",
  "function depositPools(uint256,address) view returns (address token,string chainLinkPath,uint256 tokenPrice,uint256 deposited,uint256 lastUnderlyingBalance,uint8 strategy,address aToken,bool isExist)",
];
const erc20Abi = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const usd = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

describe("Capital protocol: one late ChainLink feed halts all five Morpheus DepositPools", function () {
  let user, dist, feeds, forkBlock;

  before(async function () {
    [user] = await ethers.getSigners();
    await network.provider.send("evm_mine");
    forkBlock = await ethers.provider.getBlockNumber();
    dist = new ethers.Contract(DIST, distAbi, user);
    feeds = await readFeedConfig();

    console.log(`\n  Ethereum mainnet fork, block ${forkBlock}`);
    console.log("  ChainLinkDataConsumer", CLDC);
    console.log("  Distributor          ", DIST);
    console.log("  minRewardsDistributePeriod =", (await dist.minRewardsDistributePeriod()).toString(), "s");
  });

  it("1. the configured staleness tolerance leaves no margin over the feed heartbeat", async function () {
    console.log("\n  feed                                       tolerance   age@fork");
    for (const f of feeds) {
      const blk = await ethers.provider.getBlock("latest");
      const age = BigInt(blk.timestamp) - f.updatedAt;
      console.log(
        `  ${f.description.padEnd(14)} ${f.feed}  ${String(f.allowedDelay).padStart(7)}s  ${String(age).padStart(7)}s`
      );
      expect(f.allowedDelay).to.be.gt(0n);
    }
    // Every tolerance is exactly one of the two ChainLink heartbeats in use.
    for (const f of feeds) expect([3600n, 86400n]).to.include(f.allowedDelay);
  });

  it("2. capital under management at the pinned block", async function () {
    let total = 0;
    console.log("");
    for (const [name, p] of Object.entries(POOLS)) {
      const dp = new ethers.Contract(p.dp, dpAbi, user);
      const deposited = await dp.totalDepositedInPublicPools();
      const info = await dist.depositPools(0, p.dp);
      const price = Number(ethers.formatEther(info[2]));
      const amt = Number(deposited) / 10 ** p.dec;
      const value = amt * price;
      total += value;
      console.log(`  ${name.padEnd(6)} ${p.dp}  deposited=${amt.toLocaleString("en-US")}  price=${price.toFixed(2)}  value=${usd(value)}`);
    }
    console.log(`  TOTAL capital exposed to the shared oracle gate: ${usd(total)}`);
    expect(total).to.be.gt(1_000_000);
    this.total = total;
  });

  it("3. with every feed fresh, an ordinary deposit succeeds (baseline)", async function () {
    await installAggregators(feeds, {}); // all feeds fresh
    await deal(POOLS.USDC.token, user.address, 2_000_000n * 10n ** 6n);
    const usdc = new ethers.Contract(POOLS.USDC.token, erc20Abi, user);
    await usdc.approve(DIST, ethers.MaxUint256);

    const dp = new ethers.Contract(POOLS.USDC.dp, dpAbi, user);
    await dp.stake(0, 1_000_000n * 10n ** 6n, 0, ethers.ZeroAddress);
    const ud = await dp.usersData(user.address, 0);
    console.log(`\n  baseline stake accepted: ${(Number(ud[1]) / 1e6).toLocaleString("en-US")} USDC recorded`);
    expect(ud[1]).to.equal(1_000_000n * 10n ** 6n);
  });

  it("4. ONE feed published late halts deposits, withdrawals, claims and locks on ALL FIVE pools", async function () {
    const steth = feeds.find((f) => f.description.toUpperCase().includes("STETH"));
    expect(steth, "STETH/USD feed").to.not.be.undefined;

    // Only the stETH/USD feed is late, by a gap measured on mainnet (3696s vs a
    // 3600s tolerance). Every other feed keeps publishing on time.
    await installAggregators(feeds, { [steth.feed.toLowerCase()]: OBSERVED_STETH_GAP });

    // Move into the next reward-distribution window, which is when the
    // Distributor refreshes prices.
    const period = await dist.minRewardsDistributePeriod();
    await network.provider.send("evm_increaseTime", [Number(period) + 120]);
    await network.provider.send("evm_mine");

    console.log(`\n  only ${steth.description} is late: ${OBSERVED_STETH_GAP}s old vs ${steth.allowedDelay}s tolerance`);

    const cldc = new ethers.Contract(CLDC, cldcAbi, user);
    const stethPrice = await cldc.getChainLinkDataFeedLatestAnswer(steth.pathId);
    console.log(`  ChainLinkDataConsumer reports stETH/USD price = ${stethPrice}`);
    expect(stethPrice).to.equal(0n);

    // Every other path still prices correctly -- the fault is isolated to one feed.
    for (const f of feeds.filter((x) => x.path !== "stETH/USD")) {
      const px = await cldc.getChainLinkDataFeedLatestAnswer(f.pathId);
      expect(px, `${f.path} should still price`).to.be.gt(0n);
    }
    console.log("  USDC/USD, USDT/USD, wETH/USD and wBTC/BTC,BTC/USD all still price normally");

    await expect(dist.updateDepositTokensPrices(0)).to.be.revertedWith("DR: price for pair is zero");
    await expect(dist.distributeRewards(0)).to.be.revertedWith("DR: price for pair is zero");
    console.log("  Distributor.updateDepositTokensPrices(0) -> revert 'DR: price for pair is zero'");
    console.log("  Distributor.distributeRewards(0)         -> revert 'DR: price for pair is zero'");

    // Now every user action on every pool, including the four tokens whose own
    // feeds are perfectly fresh. A second, never-staked address is used so that
    // no per-user timing rule can be mistaken for the cause.
    const [, fresh] = await ethers.getSigners();
    console.log("");
    for (const [name, p] of Object.entries(POOLS)) {
      const dp = new ethers.Contract(p.dp, dpAbi, fresh);
      const future = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 31_536_000n;
      await expect(dp.stake(0, 1n, 0, ethers.ZeroAddress), `${name} stake`).to.be.revertedWith("DR: price for pair is zero");
      await expect(dp.withdraw(0, 1n), `${name} withdraw`).to.be.revertedWith("DR: price for pair is zero");
      await expect(dp.claim(0, fresh.address), `${name} claim`).to.be.revertedWith("DR: price for pair is zero");
      await expect(dp.lockClaim(0, future), `${name} lockClaim`).to.be.revertedWith("DR: price for pair is zero");
      console.log(`  ${name.padEnd(6)} stake / withdraw / claim / lockClaim  -> ALL revert`);
    }
  });

  it("5. the halt clears the moment that single feed publishes, confirming it is the only cause", async function () {
    await installAggregators(feeds, {}); // the late feed publishes
    await dist.distributeRewards(0);
    const dp = new ethers.Contract(POOLS.USDC.dp, dpAbi, user);
    await dp.stake(0, 100n * 10n ** 6n, 0, ethers.ZeroAddress);
    const ud = await dp.usersData(user.address, 0);
    console.log(`\n  feed republished -> deposits accepted again (recorded ${(Number(ud[1]) / 1e6).toLocaleString("en-US")} USDC)`);
    expect(ud[1]).to.be.gt(1_000_000n * 10n ** 6n);
  });
});
