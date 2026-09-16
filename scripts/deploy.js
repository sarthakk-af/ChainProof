const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * ChainProof Deployment Script
 * ==============================
 * Deploys ActorRegistry, then PlacementDrive (registry address), then
 * DriveOutcomes (both addresses), then PreparationLog (registry address).
 * After deployment, writes a deployment manifest (addresses + ABIs) directly to the
 * frontend/src/contracts directory so the Vite app can import them without extra build steps.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 */

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  console.log("=".repeat(60));
  console.log("  ChainProof Deployment Script");
  console.log("=".repeat(60));
  console.log(`  Network:  ${network}`);
  console.log(`  Deployer: ${deployer.address}`);

  // Fetch deployer balance for pre-flight check
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:  ${hre.ethers.formatEther(balance)} ETH`);
  console.log("=".repeat(60));

  // -------------------------------------------------------------------------
  // Step 1: Deploy ActorRegistry (deployer is the initial platform verifier —
  // the address that approves/rejects College and Company registrations)
  // -------------------------------------------------------------------------
  console.log("\n[1/3] Deploying ActorRegistry...");
  const ActorRegistry = await hre.ethers.getContractFactory("ActorRegistry");
  const actorRegistry = await ActorRegistry.deploy(deployer.address);
  await actorRegistry.waitForDeployment();
  const registryAddress = await actorRegistry.getAddress();
  console.log(`      ✓ ActorRegistry deployed at: ${registryAddress}`);
  console.log(`      ✓ Initial verifier: ${deployer.address}`);

  // -------------------------------------------------------------------------
  // Step 2: Deploy PlacementDrive (passing registry address to constructor)
  // -------------------------------------------------------------------------
  console.log("\n[2/3] Deploying PlacementDrive...");
  const PlacementDrive = await hre.ethers.getContractFactory("PlacementDrive");
  const placementDrive = await PlacementDrive.deploy(registryAddress);
  await placementDrive.waitForDeployment();
  const driveAddress = await placementDrive.getAddress();
  console.log(`      ✓ PlacementDrive deployed at: ${driveAddress}`);

  // -------------------------------------------------------------------------
  // Step 3: Deploy DriveOutcomes — needs the registry for roles, and the drive
  //         contract to establish which company owns a drive before accepting
  //         an outcome recorded against it.
  // -------------------------------------------------------------------------
  console.log("\n[3/3] Deploying DriveOutcomes...");
  const DriveOutcomes = await hre.ethers.getContractFactory("DriveOutcomes");
  const driveOutcomes = await DriveOutcomes.deploy(registryAddress, driveAddress);
  await driveOutcomes.waitForDeployment();
  const outcomesAddress = await driveOutcomes.getAddress();
  console.log(`      ✓ DriveOutcomes deployed at: ${outcomesAddress}`);

  // -------------------------------------------------------------------------
  // Step 4: Deploy PreparationLog — the college's record of what it did to
  //         prepare students. Needs only the registry, to check the caller is
  //         an Active College.
  // -------------------------------------------------------------------------
  console.log("\n[4/4] Deploying PreparationLog...");
  const PreparationLog = await hre.ethers.getContractFactory("PreparationLog");
  const preparationLog = await PreparationLog.deploy(registryAddress);
  await preparationLog.waitForDeployment();
  const preparationAddress = await preparationLog.getAddress();
  console.log(`      ✓ PreparationLog deployed at: ${preparationAddress}`);

  // -------------------------------------------------------------------------
  // Step 5: Extract ABIs from compiled artifacts
  // -------------------------------------------------------------------------
  const registryArtifact = await hre.artifacts.readArtifact("ActorRegistry");
  const driveArtifact = await hre.artifacts.readArtifact("PlacementDrive");
  const outcomesArtifact = await hre.artifacts.readArtifact("DriveOutcomes");
  const preparationArtifact = await hre.artifacts.readArtifact("PreparationLog");

  // -------------------------------------------------------------------------
  // Step 6: Write deployment manifest to frontend/src/contracts/
  // -------------------------------------------------------------------------
  const contractsDir = path.join(__dirname, "..", "frontend", "src", "contracts");

  // Ensure directory exists (create recursively if needed)
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
    console.log(`\n[FS] Created directory: ${contractsDir}`);
  }

  // Build the deployment manifest object
  const deploymentManifest = {
    network: network,
    chainId: hre.network.config.chainId || 31337,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ActorRegistry: {
        address: registryAddress,
        abi: registryArtifact.abi,
      },
      PlacementDrive: {
        address: driveAddress,
        abi: driveArtifact.abi,
      },
      DriveOutcomes: {
        address: outcomesAddress,
        abi: outcomesArtifact.abi,
      },
      PreparationLog: {
        address: preparationAddress,
        abi: preparationArtifact.abi,
      },
    },
  };

  // Write the manifest as a single importable JS module
  const manifestContent = `// AUTO-GENERATED by scripts/deploy.js — DO NOT EDIT MANUALLY
// Generated: ${new Date().toISOString()}
// Network: ${network}

export const DEPLOYMENT = ${JSON.stringify(deploymentManifest, null, 2)};

export const ACTOR_REGISTRY_ADDRESS = "${registryAddress}";
export const PLACEMENT_DRIVE_ADDRESS = "${driveAddress}";
export const DRIVE_OUTCOMES_ADDRESS = "${outcomesAddress}";
export const PREPARATION_LOG_ADDRESS = "${preparationAddress}";
`;

  const manifestPath = path.join(contractsDir, "deployment.js");
  fs.writeFileSync(manifestPath, manifestContent, "utf8");

  console.log("\n[FS] Deployment manifest written to:");
  console.log(`     ${manifestPath}`);

  // -------------------------------------------------------------------------
  // Step 6: Summary
  // -------------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("  Deployment Complete!");
  console.log("=".repeat(60));
  console.log(`  ActorRegistry:     ${registryAddress}`);
  console.log(`  PlacementDrive:    ${driveAddress}`);
  console.log(`  DriveOutcomes:     ${outcomesAddress}`);
  console.log(`  PreparationLog:    ${preparationAddress}`);
  console.log(`  Network:           ${network}`);
  console.log("=".repeat(60));
  console.log("\n  Next Steps:");
  console.log("  1. cd backend && npm run dev   (see backend/.env.example)");
  console.log("  2. cd frontend && npm run dev");
  console.log("  No wallet/MetaMask needed — sign up with email/password in the app.");
  console.log("=".repeat(60) + "\n");
}

// Execute deployment and handle top-level errors gracefully
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n[ERROR] Deployment failed:");
    console.error(error);
    process.exit(1);
  });
