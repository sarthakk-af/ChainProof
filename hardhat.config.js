require("@nomicfoundation/hardhat-toolbox");
// The project's single .env, at the repository root — shared with the backend.
require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

/** Hardhat wants a 0x-prefixed key; a key pasted without one is accepted too. */
function withHexPrefix(key) {
  const trimmed = key.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

/**
 * @type {import('hardhat/config').HardhatUserConfig}
 *
 * ChainProof Hardhat Configuration
 * ---------------------------------
 * - Solidity 0.8.20 compiler with optimizer enabled (200 runs = balance of
 *   deployment cost vs. runtime execution cost)
 * - Build output goes to artifacts/; scripts/deploy.js writes the deployed
 *   addresses and ABIs to frontend/src/contracts/deployment.js, which the
 *   backend reads on start-up
 * - Network configs load from .env for security (never hardcode private keys)
 */
module.exports = {
  // -------------------------------------------------------------------------
  // Solidity Compiler
  // -------------------------------------------------------------------------
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200, // Optimized for frequent external calls
      },
      // Enable metadata for source verification on block explorers
      metadata: {
        bytecodeHash: "ipfs",
      },
    },
  },

  // -------------------------------------------------------------------------
  // Artifact Output Path
  // -------------------------------------------------------------------------
  // Compiled output stays in ./artifacts. The deploy script copies just the
  // addresses and ABIs the app needs into frontend/src/contracts/deployment.js.
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  // -------------------------------------------------------------------------
  // Network Configurations
  // -------------------------------------------------------------------------
  networks: {
    // Local Hardhat development node (default, no config required)
    hardhat: {
      chainId: 31337,
      // Mining interval: 0 = automining (instant transactions, ideal for testing)
      mining: {
        auto: true,
        interval: 0,
      },
    },

    // Named localhost network pointing to a running `npx hardhat node`
    // LOCAL_RPC_URL lets a sandbox chain on another port be deployed to.
    localhost: {
      url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // Polygon Amoy Testnet — the intended target. Nothing is deployed there yet;
    // everything runs on the local node above.
    // The deploying key becomes the contracts' verifier, and the backend signs
    // with the same DEPLOYER_PRIVATE_KEY from the same .env — one key, so the
    // two can never disagree about who the verifier is.
    amoy: {
      url: process.env.AMOY_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [withHexPrefix(process.env.DEPLOYER_PRIVATE_KEY)]
        : [],
      chainId: 80002,
    },
  },

  // -------------------------------------------------------------------------
  // Gas Reporter (optional, activated via env variable)
  // -------------------------------------------------------------------------
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || "",
    outputFile: "gas-report.txt",
    noColors: true,
  },

  // -------------------------------------------------------------------------
  // Etherscan / Block Explorer Verification
  // -------------------------------------------------------------------------
  // A single Etherscan key, which covers Polygon Amoy through Etherscan's
  // multichain (v2) API. Per-network keys such as a separate Polygonscan key
  // belong to the v1 API, which was switched off in 2025 — verification
  // configured that way fails.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },

  // -------------------------------------------------------------------------
  // Mocha Test Runner Configuration
  // -------------------------------------------------------------------------
  mocha: {
    timeout: 60000, // 60 seconds per test (generous for local node interactions)
  },
};
