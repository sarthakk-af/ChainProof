require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

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
  // Outputting artifacts directly to the frontend/src/contracts directory
  // allows Vite to resolve ABIs without extra copy scripts in the CI pipeline.
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

    // Ethereum Sepolia Testnet (requires .env variables)
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 11155111,
    },

    // Polygon Amoy Testnet — used for the live demo deployment
    amoy: {
      url: process.env.AMOY_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
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
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
  },

  // -------------------------------------------------------------------------
  // Mocha Test Runner Configuration
  // -------------------------------------------------------------------------
  mocha: {
    timeout: 60000, // 60 seconds per test (generous for local node interactions)
  },
};
