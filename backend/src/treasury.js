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
/**
 * Raised when the treasury can't cover another gas drip.
 *
 * Distinguished from any other transaction failure because the operator
 * response is completely different: a dry treasury is not a bug to debug, it
 * is a wallet to top up, and nothing else will work until someone does. On a
 * local chain the accounts hold thousands of test ETH so this is invisible;
 * on a real network the treasury is a fixed balance that every signup draws
 * down, and when it empties every signup fails with no explanation.
 */
export class TreasuryExhaustedError extends Error {
  constructor(balanceEth, requiredEth) {
    super(
      `Treasury has ${balanceEth} ETH left, which cannot cover the ${requiredEth} ETH ` +
        `gas drip a new account needs. Top up ${treasurySigner.address} to accept signups again.`
    );
    this.name = "TreasuryExhaustedError";
    this.balanceEth = balanceEth;
    this.requiredEth = requiredEth;
  }
}

export const treasuryAddress = treasurySigner.address;

/** Current treasury balance, as a decimal string in ether units. */
export async function getTreasuryBalance() {
  return ethers.formatEther(await provider.getBalance(treasurySigner.address));
}

export async function fundWallet(address) {
  const value = ethers.parseEther(config.walletGasDripEth);

  // Checked before sending so the failure names its own cause. Without this
  // the caller only sees a generic send error and reports "please try again"
  // to someone whose request can never succeed.
  const balance = await provider.getBalance(treasurySigner.address);
  if (balance <= value) {
    throw new TreasuryExhaustedError(ethers.formatEther(balance), config.walletGasDripEth);
  }

  try {
    const receipt = await withWalletLock(treasurySigner.address, async (nonce) => {
      const tx = await treasurySigner.sendTransaction({ to: address, value, nonce });
      return tx.wait();
    });
    return receipt.hash;
  } catch (err) {
    // The balance can still be too low once gas is added on top, and the
    // pre-check above races anything else spending from the same wallet.
    if (err?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(err?.message || "")) {
      throw new TreasuryExhaustedError(
        ethers.formatEther(await provider.getBalance(treasurySigner.address)),
        config.walletGasDripEth
      );
    }
    throw err;
  }
}
