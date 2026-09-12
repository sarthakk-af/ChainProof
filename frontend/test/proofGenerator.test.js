import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProofDocument } from "../src/utils/proofDocument.js";

/**
 * The proof document is the last step in the chain of trust — the point where
 * a credential leaves our app and reaches someone who has no reason to trust
 * us. These tests exist because of one specific attack: a student showing a
 * rescinded offer while hiding the correction that rescinded it.
 *
 * They import the real builder. An earlier version of this file re-implemented
 * it instead, to avoid pulling React and the deployment manifest into Node —
 * which meant the tests could pass while the shipped component was broken.
 * buildProofDocument now takes its dependencies as arguments precisely so this
 * file can exercise the actual code.
 */

const DEPLOYMENT = {
  network: "localhost",
  chainId: 31337,
  contracts: {
    ActorRegistry: { address: "0xREGISTRY" },
    CredentialIssuer: { address: "0xISSUER" },
    PlacementTracker: { address: "0xTRACKER" },
  },
};

/** Calls the real builder with the stubs the browser would otherwise supply. */
function build({ credentials, visibility, studentAddress, studentName }) {
  return buildProofDocument({
    credentials,
    visibility,
    studentAddress,
    studentName,
    deployment: DEPLOYMENT,
    lookupMetadata: () => null,
    labelFor: (credType) => credType,
    formatTime: (t) => String(t),
  });
}

// --- fixtures ----------------------------------------------------------------
const STUDENT = "0xStudent";

/** A rescinded offer: credential 1 superseded by correction 2. */
function rescindedOfferHistory() {
  return [
    {
      id: 1,
      credType: "Offer",
      ipfsHash: "QmOffer",
      issuerAddress: "0xCompany",
      issuerName: "Acme Corp",
      issuerRole: "Company",
      timestamp: 1000,
      blockNumber: 10,
      isCorrection: false,
      supersedesId: null,
      superseded: true,
    },
    {
      id: 2,
      credType: "Rejection",
      ipfsHash: "QmRescind",
      issuerAddress: "0xCompany",
      issuerName: "Acme Corp",
      issuerRole: "Company",
      timestamp: 2000,
      blockNumber: 20,
      isCorrection: true,
      supersedesId: 1,
      superseded: false,
    },
  ];
}

// --- the guarantee -----------------------------------------------------------

test("a student cannot show a rescinded offer while hiding the correction", () => {
  const credentials = rescindedOfferHistory();
  // The attack: disclose the offer, hide the rescind.
  const doc = build({
    credentials,
    visibility: { 1: true, 2: false },
    studentAddress: STUDENT,
    studentName: "Test Student",
  });

  const ids = doc.credentials.map((c) => c.id);
  assert.deepEqual(ids, ["1", "2"], "the correction must be pulled in regardless of the toggle");

  const correction = doc.credentials.find((c) => c.id === "2");
  assert.ok(correction.includedAutomatically, "the correction must say why it is there");
  assert.equal(correction.correctsCredentialId, "1");
});

test("a disclosed offer that was rescinded is labelled SUPERSEDED", () => {
  const doc = build({
    credentials: rescindedOfferHistory(),
    visibility: { 1: true, 2: false },
    studentAddress: STUDENT,
    studentName: "Test Student",
  });
  const offer = doc.credentials.find((c) => c.id === "1");
  assert.match(offer.status, /SUPERSEDED/);
});

test("omitting a credential entirely is still allowed — this is selective disclosure, not a lie", () => {
  const credentials = rescindedOfferHistory();
  // Hiding BOTH the offer and its correction is legitimate: the recruiter is
  // simply never told about that episode, rather than told something false.
  const doc = build({
    credentials,
    visibility: { 1: false, 2: false },
    studentAddress: STUDENT,
    studentName: "Test Student",
  });
  assert.equal(doc.credentials.length, 0);
  assert.match(doc.disclosure, /^Partial/);
});

test("a standing offer is reported as active and the disclosure is marked complete", () => {
  const credentials = [
    {
      id: 1,
      credType: "Offer",
      ipfsHash: "QmOffer",
      issuerAddress: "0xCompany",
      issuerName: "Acme Corp",
      issuerRole: "Company",
      timestamp: 1000,
      blockNumber: 10,
      isCorrection: false,
      supersedesId: null,
      superseded: false,
    },
  ];
  const doc = build({
    credentials,
    visibility: {},
    studentAddress: STUDENT,
    studentName: "Test Student",
  });
  assert.equal(doc.credentials[0].status, "active");
  assert.match(doc.disclosure, /^Complete/);
});

test("every credential carries a resolvable document URL and a named issuer", () => {
  const doc = build({
    credentials: rescindedOfferHistory(),
    visibility: {},
    studentAddress: STUDENT,
    studentName: "Test Student",
  });
  for (const cred of doc.credentials) {
    assert.ok(cred.documentUrl.startsWith("https://"), "must be independently openable");
    assert.ok(cred.documentUrl.endsWith(cred.ipfsHash), "URL must match the on-chain hash");
    assert.equal(cred.issuedBy, "Acme Corp", "a hex address alone tells a recruiter nothing");
  }
});

test("the proof names the contracts to verify against", () => {
  const doc = build({
    credentials: rescindedOfferHistory(),
    visibility: {},
    studentAddress: STUDENT,
    studentName: "Test Student",
  });
  // Without these a recruiter is told to "verify on-chain" with no way to.
  assert.equal(doc.verification.contracts.CredentialIssuer, "0xISSUER");
  assert.equal(doc.verification.contracts.ActorRegistry, "0xREGISTRY");
  assert.equal(doc.verification.chainId, 31337);
  assert.ok(doc.verification.howToVerify.length >= 4);
});

test("a chain of corrections keeps each link visible", () => {
  // 1 corrected by 2, then 2 itself corrected by 3. Disclosing only 1 must
  // surface 2; disclosing 2 must surface 3.
  const credentials = [
    { id: 1, credType: "Offer", ipfsHash: "Qm1", issuerAddress: "0xC", issuerName: "Acme Corp", timestamp: 1, isCorrection: false, supersedesId: null, superseded: true },
    { id: 2, credType: "Rejection", ipfsHash: "Qm2", issuerAddress: "0xC", issuerName: "Acme Corp", timestamp: 2, isCorrection: true, supersedesId: 1, superseded: true },
    { id: 3, credType: "Offer", ipfsHash: "Qm3", issuerAddress: "0xC", issuerName: "Acme Corp", timestamp: 3, isCorrection: true, supersedesId: 2, superseded: false },
  ];
  const doc = build({
    credentials,
    visibility: { 1: true, 2: false, 3: false },
    studentAddress: STUDENT,
    studentName: "Test Student",
  });
  const ids = doc.credentials.map((c) => c.id);
  assert.ok(ids.includes("2"), "the direct correction must appear");
  assert.ok(ids.includes("3"), "and so must the correction of that correction");
});
