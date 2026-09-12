/**
 * proofDocument.js — builds the shareable proof a student hands to a recruiter.
 *
 * This is the last step in the chain of trust: the point where a credential
 * leaves the app and reaches someone who has no reason to trust us. It lives
 * on its own, with no imports at all, for two reasons — it's the piece most
 * worth testing directly, and the alternative was a test that re-implemented
 * it, which would pass happily while the real thing was broken.
 *
 * Everything it needs is passed in, so the tests exercise this exact function
 * rather than a copy of it.
 *
 * ── The guarantee ────────────────────────────────────────────────────────────
 * The student chooses which credentials to disclose. That part is deliberate
 * and legitimate: nobody should have to hand over their whole history to show
 * one offer letter. What they must NOT be able to do is show a credential
 * while hiding the fact that it was later corrected — that would turn a
 * rescinded offer into a valid-looking one, which is exactly the forgery this
 * project exists to make impossible.
 *
 * So: you may omit a credential entirely, but you may never show one without
 * its current status. Any correction superseding a disclosed credential is
 * pulled in automatically and can't be toggled off.
 */

export const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

export function buildProofDocument({
  credentials = [],
  visibility = {},
  studentAddress,
  studentName,
  deployment,
  // Optional lookups, injected so this module stays import-free.
  lookupMetadata = () => null,
  labelFor = (credType) => credType,
  formatTime = (timestamp) => String(timestamp),
}) {
  const chosen = credentials.filter((c) => visibility[c.id] !== false);
  const chosenIds = new Set(chosen.map((c) => String(c.id)));

  // Walks the full chain rather than one link: a correction can itself be
  // corrected, and stopping at the first hop would show a superseded record
  // without showing what actually replaced it.
  const forcedIds = new Set();
  const queue = [...chosen];
  while (queue.length > 0) {
    const cred = queue.shift();
    if (!cred.superseded) continue;
    for (const other of credentials) {
      if (String(other.supersedesId) !== String(cred.id)) continue;
      if (chosenIds.has(String(other.id))) continue;
      chosenIds.add(String(other.id));
      forcedIds.add(String(other.id));
      queue.push(other);
    }
  }

  const included = credentials
    .filter((c) => chosenIds.has(String(c.id)))
    .sort((a, b) => Number(a.id) - Number(b.id));

  const entries = included.map((c) => {
    const entry = {
      id: String(c.id),
      type: labelFor(c.credType) || c.credType,
      // The single most important field in this document.
      status: c.superseded
        ? "SUPERSEDED — this credential was later corrected and no longer stands"
        : "active",
      issuedBy: c.issuerName || "(issuer not indexed)",
      issuerRole: c.issuerRole || null,
      issuerAddress: c.issuerAddress,
      issuedAt: formatTime(c.timestamp),
      blockNumber: c.blockNumber ?? null,
    };
    if (c.isCorrection) entry.correctsCredentialId = String(c.supersedesId);
    if (forcedIds.has(String(c.id))) {
      entry.includedAutomatically =
        "This correction applies to a credential disclosed above and cannot be omitted.";
    }
    entry.ipfsHash = c.ipfsHash;
    entry.documentUrl = IPFS_GATEWAY + c.ipfsHash;
    // Convenience copy only, and only if this browser happens to hold it —
    // the document at documentUrl is the authoritative one.
    entry.metadata = lookupMetadata(c.ipfsHash) || null;
    return entry;
  });

  const contracts = deployment?.contracts || {};
  const registry = contracts.ActorRegistry?.address;
  const issuer = contracts.CredentialIssuer?.address;

  return {
    schema: "chainproof-proof-v2",
    studentAddress,
    studentName,
    generatedAt: new Date().toISOString(),
    disclosure:
      included.length === credentials.length
        ? "Complete: every credential on this student's record is included."
        : "Partial: " +
          included.length +
          " of " +
          credentials.length +
          " credentials disclosed. The student chose what to share, but no disclosed " +
          "credential can hide its own correction.",
    credentials: entries,
    verification: {
      network: deployment?.network ?? null,
      chainId: deployment?.chainId ?? null,
      contracts: {
        ActorRegistry: registry,
        CredentialIssuer: issuer,
        PlacementTracker: contracts.PlacementTracker?.address,
      },
      howToVerify: [
        "1. Open each credential's documentUrl on any public IPFS gateway. It loads from IPFS, not from ChainProof's servers.",
        "2. An IPFS hash is derived from the document's own contents — alter one character of the document and its hash changes, so it would no longer match what the chain recorded.",
        '3. Call getStudentCredentials("' +
          studentAddress +
          '") on the CredentialIssuer contract at ' +
          issuer +
          ", chain " +
          (deployment?.chainId ?? "?") +
          ", using any node or block explorer.",
        "4. Compare: every id, ipfsHash, issuer and timestamp below must match the chain exactly. The chain is authoritative; this document is not.",
        "5. Check each credential's superseded flag on-chain. A superseded credential has been corrected and does not stand, whatever it says.",
        "6. Confirm the issuer is an approved institution by calling getActor(issuerAddress) on the ActorRegistry at " +
          registry +
          ".",
      ],
      note:
        "This file is generated by the student and proves nothing by itself. Its only job is to tell you where to look. Trust the chain and IPFS, not this document.",
    },
  };
}
