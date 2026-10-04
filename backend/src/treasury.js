import { ethers } from "ethers";
import { provider, verifierSigner } from "./chain.js";
import { config } from "./config.js";
import { withWalletLock, setBeforeSend } from "./txQueue.js";

const treasurySigner = new ethers.Wallet(config.treasuryPrivateKey, provider);

/**
 * Sends a small amount of native gas token to a custodial wallet so it can pay
 * for its own transactions. On local Hardhat this is effectively
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

/**
 * Throws TreasuryExhaustedError when the treasury can't fund another wallet.
 * Signup calls it without spending anything: wallets are funded on first use
 * now, but a signup that can never get as far as its first transaction should
 * be told so at the door, not after the email code and the roster.
 */
export async function assertCanFund() {
  const value = ethers.parseEther(config.walletGasDripEth);
  const balance = await provider.getBalance(treasurySigner.address);
  if (balance <= value) {
    throw new TreasuryExhaustedError(ethers.formatEther(balance), config.walletGasDripEth);
  }
}

export async function fundWallet(address) {
  const value = ethers.parseEther(config.walletGasDripEth);

  // Checked before sending so the failure names its own cause. Without this
  // the caller only sees a generic send error and reports "please try again"
  // to someone whose request can never succeed.
  await assertCanFund();

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

/**
 * Funds a wallet before its first transaction, and tops it back up when it is
 * nearly out of gas.
 *
 * Wallets used to be funded at signup, so every signup cost the treasury a drip
 * whether or not the account ever did anything — an abandoned signup or a typo'd
 * email spent it all the same. Checked before each transaction instead, only
 * wallets actually in use are ever funded. A wallet's first transaction is its
 * on-chain registration, which needs a confirmed email (see /me/register and
 * studentVerification.js), so an unconfirmed account never costs anything.
 * The platform's own signers are funded by hand and skipped.
 */
export async function ensureFunded(address) {
  const key = address.toLowerCase();
  if (key === treasurySigner.address.toLowerCase()) return;
  if (key === verifierSigner.address.toLowerCase()) return;

  const threshold = ethers.parseEther(config.walletGasDripEth) / 4n;
  if ((await provider.getBalance(address)) >= threshold) return;
  await fundWallet(address);
}

setBeforeSend(ensureFunded);
