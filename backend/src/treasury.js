import { ethers } from "ethers";
import { provider } from "./chain.js";
import { config } from "./config.js";
import { withWalletLock } from "./txQueue.js";

const treasurySigner = new ethers.Wallet(config.treasuryPrivateKey, provider);

/**
 * Sends a small amount of native gas token to a newly created custodial wallet
 * so it can pay for its own transactions. On local Hardhat this is effectively
 * free (test accounts hold ~10000 ETH); on a real network the treasury address
 * needs to be kept topped up out-of-band.
 *
 * Goes through `withWalletLock` because every signup shares this one treasury
 * signer — without it, two signups close together can race on the treasury's
 * nonce the same way user actions could (see txQueue.js).
 */
export async function fundWallet(address) {
  const receipt = await withWalletLock(treasurySigner.address, async (nonce) => {
    const tx = await treasurySigner.sendTransaction({
      to: address,
      value: ethers.parseEther(config.walletGasDripEth),
      nonce,
    });
    return tx.wait();
  });
  return receipt.hash;
}
