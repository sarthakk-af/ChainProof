import { Router } from "express";
import { ethers } from "ethers";
import { listActors, getCredentialsForStudent, getCredentialSummaries, getActor } from "../db.js";
import { ROLE, STATUS } from "../chain.js";
import { serializeActor, serializeCredential, CRED_TYPE_NAMES } from "../serializers.js";

export const studentsRouter = Router();

/**
 * Everything in this router is personal data about identifiable people — real
 * names, which institution they attend, whether they have a job, and their
 * full credential history. It used to be served to anyone who asked, with no
 * session at all, which flatly contradicted the care taken on the public
 * dashboard (see routes/public.js, which deliberately strips student identity
 * from the records behind a college's percentage).
 *
 * Who legitimately needs it:
 *   - a Company, to browse candidates — that's what the platform is for;
 *   - a College, for its own students and nobody else's;
 *   - a Student, for themselves.
 *
 * The router is mounted behind userAuth (see app.js); these helpers decide
 * what an authenticated caller may then see.
 */
function requireActiveIssuerOrSelf(req, res, subjectAddress) {
  const caller = getActor(req.user.address);
  const isSelf = req.user.address.toLowerCase() === String(subjectAddress).toLowerCase();
  if (isSelf) return caller ?? { role: ROLE.Student };

  if (!caller || caller.status !== STATUS.Active) {
    res.status(403).json({ error: "Not allowed to view this student's records." });
    return null;
  }
  if (caller.role === ROLE.Company) return caller;
  if (caller.role === ROLE.College) {
    const subject = getActor(subjectAddress);
    if (subject && (subject.college || "").toLowerCase() === req.user.address.toLowerCase()) {
      return caller;
    }
  }
  res.status(403).json({ error: "Not allowed to view this student's records." });
  return null;
}

studentsRouter.get("/", (req, res) => {
  const caller = getActor(req.user.address);
  if (!caller || caller.status !== STATUS.Active) {
    return res.status(403).json({ error: "Only a verified College or Company can list students." });
  }

  let college = req.query.college;
  if (caller.role === ROLE.College) {
    // A college sees its own students, whatever the query string asks for.
    college = req.user.address;
  } else if (caller.role !== ROLE.Company) {
    return res.status(403).json({ error: "Only a verified College or Company can list students." });
  }

  const rows = listActors({ role: ROLE.Student, college });
  const summaries = getCredentialSummaries();

  const students = rows.map((row) => {
    const summary = summaries.get(row.address);
    return {
      ...serializeActor(row),
      highestCredentialStage: summary ? CRED_TYPE_NAMES[summary.max_cred_type] : null,
      isPlaced: Boolean(summary?.is_placed),
    };
  });

  res.json({ students });
});

studentsRouter.get("/:address/credentials", (req, res) => {
  if (!ethers.isAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid student address" });
  }
  if (!requireActiveIssuerOrSelf(req, res, req.params.address)) return;

  const credentials = getCredentialsForStudent(req.params.address);
  res.json({ credentials: credentials.map(serializeCredential) });
});
