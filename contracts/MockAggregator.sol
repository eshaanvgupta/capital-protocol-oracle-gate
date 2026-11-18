// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Chainlink AggregatorV3 stand-in used by the PoC to control ONE variable:
 *         how many seconds behind `block.timestamp` a feed's `updatedAt` is.
 *
 *         The answer and the decimals are copied verbatim from the real mainnet
 *         aggregator at the pinned fork block, so prices stay exactly what they
 *         were on chain. `age` reproduces a publication delay that Chainlink
 *         feeds exhibit in production, measured by measure-chainlink-gaps.js.
 *
 *         Storage layout (set with hardhat_setStorageAt after hardhat_setCode):
 *           slot 0 -> answer
 *           slot 1 -> dec
 *           slot 2 -> age
 */
contract MockAggregator {
    int256 public answer;
    uint8 public dec;
    uint256 public age;

    function decimals() external view returns (uint8) {
        return dec;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 t = block.timestamp - age;
        return (1, answer, t, t, 1);
    }
}
