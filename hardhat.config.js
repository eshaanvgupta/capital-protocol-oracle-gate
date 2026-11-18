require("@nomicfoundation/hardhat-toolbox");

// Pinned Ethereum mainnet fork. The default endpoint is a public archive RPC
// that serves state at this block; set ETH_RPC_URL to use your own.
const ETH_RPC = process.env.ETH_RPC_URL || "https://eth.drpc.org";
const FORK_BLOCK = Number(process.env.ETH_FORK_BLOCK || 26423488);

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {
      forking: { url: ETH_RPC, blockNumber: FORK_BLOCK },
      chainId: 1,
      hardfork: "cancun",
      allowUnlimitedContractSize: true,
      gas: 16000000,
      blockGasLimit: 16000000,
    },
  },
  mocha: { timeout: 1800000 },
};
