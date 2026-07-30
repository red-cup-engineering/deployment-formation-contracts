import { refuse } from "./refusal.mjs";

export const RESIDUE_DIMENSIONS = Object.freeze([
  "artifactByteParity", "requestedProviderRoute", "effectScopeAndCustody",
  "dnsTlsPath", "accessPolicy", "rollback",
]);
export const RESIDUE_STATUSES = Object.freeze(["pass", "fail", "not-claimed", "not-applicable"]);
const forbiddenKey = /(?:secret|credential|token|password|api[_-]?key)/iu;
const rawSecretValue = /(?:^|\s)(?:(?:bearer\s+|sk-)[A-Za-z0-9._~+\/=-]{8,}|(?:password|credential|token|api[_-]?key|secret)\s*[:=]\s*\S+)(?:$|\s)/iu;

export function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isOpaqueSecretReference(value) {
  return isRecord(value) && value.type === "OpaqueSecretReference" && typeof value.id === "string" && value.id.startsWith("urn:") && Object.keys(value).every((key) => key === "type" || key === "id");
}
export function hasForbiddenMaterial(value, path = "$", seen = new Set()) {
  if (typeof value === "string") return rawSecretValue.test(value) ? path : null;
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item, index) => hasForbiddenMaterial(item, `${path}[${index}]`, seen)).find(Boolean) ?? null
    : Object.entries(value).map(([key, item]) => {
      if (forbiddenKey.test(key)) return key.endsWith("Reference") && isOpaqueSecretReference(item) ? null : `${path}.${key}`;
      return hasForbiddenMaterial(item, `${path}.${key}`, seen);
    }).find(Boolean) ?? null;
  seen.delete(value);
  return result;
}
export function digestBound(record, fields) {
  return isRecord(record) && fields.every((field) => typeof record[field] === "string" && record[field].startsWith("ni:///sha-256;"));
}
export function sameBinding(left, right, fields) { return isRecord(left) && isRecord(right) && fields.every((field) => left[field] === right[field]); }
export function ensureClean(record, seam) {
  if (!isRecord(record)) return refuse(seam, "malformed-record", "the seam requires a record object");
  const at = hasForbiddenMaterial(record);
  return at ? refuse(seam, "forbidden-secret-material", `records may not contain credentials or raw secrets (${at})`) : null;
}
export function closedStage(stage) { return Object.freeze({ ...stage, closed: true }); }
