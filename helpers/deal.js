const { ethers, network } = require("hardhat");

// Known ERC20 balance storage slots (avoids a slow brute-force scan).
const KNOWN = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 9,  // USDC, Ethereum mainnet
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 2,  // USDT, Ethereum mainnet
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": 0,  // WBTC, Ethereum mainnet
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 3,  // WETH, Ethereum mainnet
};

async function trySlot(tokenAddr, holder, amount, slot, vyper) {
  const idx = vyper
    ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address"], [slot, holder]))
    : ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot]));
  const prev = await network.provider.send("eth_getStorageAt", [tokenAddr, idx, "latest"]);
  await network.provider.send("hardhat_setStorageAt", [tokenAddr, idx, ethers.toBeHex(amount, 32)]);
  const erc20 = new ethers.Contract(tokenAddr, ["function balanceOf(address) view returns (uint256)"], ethers.provider);
  if ((await erc20.balanceOf(holder)) === amount) return true;
  await network.provider.send("hardhat_setStorageAt", [tokenAddr, idx, prev]);
  return false;
}

/// Writes an ERC20 balance directly into storage via hardhat_setStorageAt.
/// This only funds the attacker's own wallet; no protocol account or owner key is used.
async function deal(tokenAddr, holder, amount, maxSlot = 60) {
  const hint = KNOWN[tokenAddr.toLowerCase()];
  if (hint !== undefined && (await trySlot(tokenAddr, holder, amount, hint, false))) return { slot: hint };
  for (let slot = 0; slot < maxSlot; slot++) {
    for (const vyper of [false, true]) {
      if (await trySlot(tokenAddr, holder, amount, slot, vyper)) return { slot, vyper };
    }
  }
  throw new Error(`could not locate balance slot for ${tokenAddr}`);
}
module.exports = { deal };
