import { Router } from "express";
import { listActors, getCredentialsForStudent, getCredentialSummaries } from "../db.js";
import { ROLE } from "../chain.js";
import { serializeActor, serializeCredential, CRED_TYPE_NAMES } from "../serializers.js";

export const studentsRouter = Router();

studentsRouter.get("/", (req, res) => {
  const { college } = req.query;
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
  const credentials = getCredentialsForStudent(req.params.address);
  res.json({ credentials: credentials.map(serializeCredential) });
});
