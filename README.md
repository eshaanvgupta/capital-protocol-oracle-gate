# A single late Chainlink publication halts all five Morpheus DepositPools

Proof of concept for a Morpheus Bug Bounty submission. It runs against the **deployed bytecode** on an **Ethereum mainnet fork pinned to block 26,423,488** and uses **no privileged account**.

## Run

```bash
npm install
npx hardhat test
```

That is the whole setup. The default endpoint is a public Ethereum archive RPC that serves state at the pinned block; set `ETH_RPC_URL` to use your own:

```bash
ETH_RPC_URL=<your ethereum archive rpc> npx hardhat test
```

## What it shows

Every state changing entry point a capital provider can call on any of the five DepositPool proxies routes through `Distributor.distributeRewards(0)`, which calls `updateDepositTokensPrices(0)`. That function prices **every** registered deposit token in one loop behind a single `require(price_ > 0, "DR: price for pair is zero")`, and `ChainLinkDataConsumer` returns `0` for any feed older than its entry in `allowedPriceUpdateDelay`.

Those tolerances are set to exactly each aggregator's publication heartbeat, with no margin. The test makes **one** feed, STETH/USD, 3696 seconds old against its 3600 second tolerance, leaves every other feed publishing on time, and shows that `stake`, `withdraw`, `claim` and `lockClaim` then revert on **all five pools**, including the four tokens whose own feeds are confirmed healthy in the same run.

3696 seconds is not invented. It is the largest publication gap in a 399 round sample of that feed's own live mainnet history, measured by `scripts/measure-chainlink-gaps.js` and recorded in `evidence/chainlink-gaps.txt`.

| Assertion | Result |
|---|---|
| Every configured tolerance equals a Chainlink heartbeat exactly | 3600 s or 86400 s, no margin |
| Capital behind the shared gate at the pinned block | **$6,965,707** |
| Baseline, all feeds fresh | deposit accepted |
| One feed late | 20 of 20 user operations revert across 5 pools |
| Feed republishes | deposits accepted again |

## Targets

All listed in Appendix A of the Morpheus Bug Bounty Program, version 2, dated 2026-08-07.

| Contract | Address |
|---|---|
| Distributor | `0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A` |
| ChainLinkDataConsumer | `0xd182263D06Fdc463c96190005d6359Cc3d3BbC5E` |
| DepositPool (stETH) | `0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790` |
| DepositPool (wETH) | `0x9380d72aBbD6e0Cc45095A2Ef8c2CA87d77Cb384` |
| DepositPool (wBTC) | `0xdE283F8309Fd1AA46c95d299f6B8310716277A42` |
| DepositPool (USDC) | `0x6cCE082851Add4c535352f596662521B4De4750E` |
| DepositPool (USDT) | `0x3B51989212BEdaB926794D6bf8e9E991218cf116` |

## No privileged accounts

The test is driven by default Hardhat signers that hold no role in any Morpheus contract. There is no `impersonateAccount` of an owner, admin or multisig anywhere in this repository.

State written outside the attacker's own wallet is limited to the code and storage of the six Chainlink aggregator addresses, which is how a fork models a feed publishing late. The answer and decimals written there are copied verbatim from the real aggregators at the pinned block, so prices stay exactly what they were on chain; the only variable under test is how many seconds behind `block.timestamp` a feed's `updatedAt` sits.

**No Morpheus contract code and no Morpheus storage slot is modified.**

## Supporting measurement

```bash
node scripts/measure-chainlink-gaps.js
```

Reads each aggregator's published round history straight from mainnet and compares consecutive `updatedAt` values against the tolerance stored in `ChainLinkDataConsumer`. A captured run is in `evidence/chainlink-gaps.txt`:

| Aggregator | Tolerance | Gaps over tolerance | Time over |
|---|---|---|---|
| STETH / USD | 3600 s | 281 of 399 | 0.516% |
| WBTC / BTC | 86400 s | 383 of 399 | 0.026% |
| BTC / USD | 3600 s | 165 of 399 | 0.464% |
| ETH / USD | 3600 s | 87 of 399 | 0.327% |
| USDT / USD | 86400 s | 61 of 64 | 0.028% |
| USDC / USD | 86400 s | 0 of 66 | 0.000% |

## Layout

```
contracts/MockAggregator.sol        Chainlink aggregator stand-in; publication age is the only variable
helpers/deal.js                     funds a test wallet's own ERC20 balance via storage
helpers/oracles.js                  reads live feed config, installs the stand-ins
scripts/measure-chainlink-gaps.js   measures live publication gaps against the configured tolerance
evidence/chainlink-gaps.txt         captured output of the above
test/OracleGateHalt.js              the proof of concept
hardhat.config.js                   Ethereum mainnet fork, pinned to block 26,423,488
```
