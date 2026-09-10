import { ROLE, STATUS, CRED_TYPE } from "./chain.js";

const ROLE_NAMES = Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [v, k]));
const STATUS_NAMES = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]));
const CRED_TYPE_NAMES = Object.fromEntries(Object.entries(CRED_TYPE).map(([k, v]) => [v, k]));

export { ROLE_NAMES, STATUS_NAMES, CRED_TYPE_NAMES };

export function serializeActor(row) {
  return {
    address: row.address,
    role: ROLE_NAMES[row.role],
    status: STATUS_NAMES[row.status],
    name: row.name,
    website: row.metadata || null,
    college: row.college,
    registeredAtBlock: row.registered_at_block,
    updatedAtBlock: row.updated_at_block,
    rejectionReason: row.rejection_reason || null,
    rejectionCount: row.rejection_count || 0,
  };
}

export function serializeCredential(row) {
  return {
    id: row.id,
    studentAddress: row.student_address,
    issuerAddress: row.issuer_address,
    ipfsHash: row.ipfs_hash,
    credType: CRED_TYPE_NAMES[row.cred_type],
    timestamp: row.timestamp,
    blockNumber: row.block_number,
    isCorrection: Boolean(row.is_correction),
    supersedesId: row.supersedes_id,
    superseded: Boolean(row.superseded),
  };
}

export function serializeVisit(row) {
  return {
    id: row.id,
    collegeAddress: row.college_address,
    companyName: row.company_name,
    ipfsHash: row.ipfs_hash,
    visitDate: row.visit_date,
    timestamp: row.timestamp,
    blockNumber: row.block_number,
  };
}

export function parseEnumQueryParam(value, enumMap, paramName) {
  if (value === undefined) return undefined;
  const numeric = enumMap[value];
  if (numeric === undefined) {
    throw new Error(
      `Invalid ${paramName}: "${value}". Expected one of: ${Object.keys(enumMap).join(", ")}`
    );
  }
  return numeric;
}
