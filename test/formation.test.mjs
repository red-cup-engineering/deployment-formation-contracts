import test from "node:test";
import assert from "node:assert/strict";
import formationSchema from "../schemas/public-delivery-formation.schema.json" with { type: "json" };
import receiptSchema from "../schemas/provider-effect-receipt.schema.json" with { type: "json" };
import { boundSolicitation, authorExactEffectOffer, acceptCustomerOffer, grantCustody, attestArtifact, admitCutover } from "../src/formation.mjs";
import { settleReceiptVector } from "../src/receipt-vector.mjs";

const digest = (tail) => `ni:///sha-256;${tail}`;
const request = Object.freeze({ type: "PublicDeliverySolicitation", formationType: "PublicDeliveryFormation", customer: "urn:customer:koios", formationDigest: digest("formation"), artifactDigest: digest("artifact"), targetDigest: digest("target"), executionMode: "live", exactEffects: ["stage exact artifact"] });
const solicited = boundSolicitation(request).value;
const offered = authorExactEffectOffer({ solicitation: solicited, offer: { type: "ProviderExactEffectOffer", author: "provider", formationDigest: request.formationDigest, artifactDigest: request.artifactDigest, targetDigest: request.targetDigest, executionMode: "live", exactEffects: request.exactEffects, offerDigest: digest("offer") } }).value;
const accepted = acceptCustomerOffer({ offer: offered, acceptance: { type: "CustomerOfferAcceptance", author: "customer", formationDigest: request.formationDigest, artifactDigest: request.artifactDigest, targetDigest: request.targetDigest, offerDigest: digest("offer") } }).value;
const custody = grantCustody({ acceptance: accepted, grant: { type: "CustodyGrantReference", formationDigest: request.formationDigest, artifactDigest: request.artifactDigest, targetDigest: request.targetDigest, grantDigest: digest("grant") } }).value;
const artifact = attestArtifact({ custody, artifact: { type: "DigestBoundArtifact", formationDigest: request.formationDigest, artifactDigest: request.artifactDigest, targetDigest: request.targetDigest, attestationDigest: digest("attested") } }).value;
const allPass = Object.freeze({ artifactByteParity: "pass", requestedProviderRoute: "pass", effectScopeAndCustody: "pass", dnsTlsPath: "pass", accessPolicy: "pass", rollback: "pass" });
const providerReceipt = (overrides = {}) => ({ type: "ProviderEffectReceipt", formationDigest: request.formationDigest, artifactDigest: request.artifactDigest, targetDigest: request.targetDigest, artifactAttestationDigest: artifact.attestationDigest, receiptDigest: digest("receipt"), residue: allPass, ...overrides });
const receipt = settleReceiptVector(providerReceipt());
const assay = (overrides = {}) => ({ type: "IndependentExternalAssay", independent: true, stage: "staging", passed: true, formationDigest: request.formationDigest, artifactDigest: request.artifactDigest, targetDigest: request.targetDigest, artifactAttestationDigest: artifact.attestationDigest, effectReceiptDigest: receipt.receiptDigest, assayDigest: digest("assay"), ...overrides });

test("cutover closes attested artifact, delivered receipt, and independent assay", () => {
  assert.equal(receipt.delivered, true);
  assert.equal(admitCutover({ artifact, receipt, assay: assay() }).stage, "cutover-admitted");
});
test("cutover refuses missing, failed, or mismatched provider receipt", () => {
  assert.equal(admitCutover({ artifact, assay: assay() }).code, "malformed-record");
  const failed = settleReceiptVector(providerReceipt({ residue: { ...allPass, rollback: "fail" } }));
  assert.equal(admitCutover({ artifact, receipt: failed, assay: assay({ effectReceiptDigest: failed.receiptDigest }) }).code, "effect-receipt-not-closed");
  const otherAttestation = settleReceiptVector(providerReceipt({ artifactAttestationDigest: digest("other-attestation") }));
  assert.equal(admitCutover({ artifact, receipt: otherAttestation, assay: assay() }).code, "effect-receipt-not-closed");
});
test("cutover refuses assay not bound to receipt and attestation", () => {
  assert.equal(admitCutover({ artifact, receipt, assay: assay({ effectReceiptDigest: digest("other-receipt") }) }).code, "assay-not-independent-or-bound");
  assert.equal(admitCutover({ artifact, receipt, assay: assay({ artifactAttestationDigest: digest("other-attestation") }) }).code, "assay-not-independent-or-bound");
  assert.equal(admitCutover({ artifact, receipt, assay: assay({ independent: false }) }).code, "assay-not-independent-or-bound");
});
test("empty required residue set refuses and failed or unclaimed residues never deliver", () => {
  assert.equal(settleReceiptVector(providerReceipt({ requiredResidues: [] })).code, "invalid-required-residue");
  const failures = Object.fromEntries(Object.keys(allPass).map((key) => [key, "fail"]));
  assert.equal(settleReceiptVector(providerReceipt({ residue: failures })).delivered, false);
  assert.equal(settleReceiptVector(providerReceipt({ residue: { ...allPass, rollback: "not-claimed" }, requiredResidues: ["rollback"] })).code, "invalid-required-residue");
});
test("dry run refuses runtime, actuation, and equivalent delivery claims", () => {
  for (const effect of ["invoke runtime", "actuate provider", "upload artifact", "publish preview", "apply headers", "bind endpoint", "rehearse rollback"]) {
    assert.equal(boundSolicitation({ ...request, executionMode: "dry-run", exactEffects: [effect] }).code, "dry-run-overclaim", effect);
  }
});
test("raw secret material refuses recursively at every later seam", () => {
  assert.equal(grantCustody({ acceptance: accepted, grant: { ...custody, metadata: { password: "value" } } }).code, "forbidden-secret-material");
  assert.equal(attestArtifact({ custody, artifact: { ...artifact, nested: [{ apiKey: "value" }] } }).code, "forbidden-secret-material");
  assert.equal(settleReceiptVector(providerReceipt({ nested: { token: "value" } })).code, "forbidden-secret-material");
  assert.equal(admitCutover({ artifact, receipt, assay: assay({ nested: { secret: "value" } }) }).code, "forbidden-secret-material");
});
test("opaque provider-held secret reference carries identity only", () => {
  const result = grantCustody({ acceptance: accepted, grant: { ...custody, credentialReference: { type: "OpaqueSecretReference", id: "urn:provider-custody:42" } } });
  assert.equal(result.stage, "custody-granted");
  assert.equal(grantCustody({ acceptance: accepted, grant: { ...custody, credentialReference: { type: "OpaqueSecretReference", id: "urn:provider-custody:42", value: "raw" } } }).code, "forbidden-secret-material");
});
test("malformed predecessor and receipt inputs settle as typed refusals", () => {
  for (const result of [boundSolicitation(null), authorExactEffectOffer(null), acceptCustomerOffer({}), grantCustody({ grant: {} }), attestArtifact({ custody: null }), settleReceiptVector(null), admitCutover(null)]) {
    assert.equal(result.type, "DeploymentFormationRefusal");
  }
});
test("provider offer cannot drift from requested effect", () => {
  assert.equal(authorExactEffectOffer({ solicitation: solicited, offer: { ...offered, exactEffects: ["different effect"] } }).code, "offer-effect-drift");
});
test("schemas close secret-bearing extra properties", () => {
  assert.equal(formationSchema.additionalProperties, false);
  assert.equal(receiptSchema.additionalProperties, false);
  assert.equal(receiptSchema.properties.residue.additionalProperties, false);
  assert.equal(receiptSchema.properties.requiredResidues.minItems, 1);
});

test("required subset cannot hide a failed claimed residue", () => {
  const result = settleReceiptVector(providerReceipt({ residue: { ...allPass, rollback: "fail" }, requiredResidues: ["artifactByteParity"] }));
  assert.equal(result.type, "DeploymentFormationRefusal");
  assert.equal(result.code, "invalid-required-residue");
});

test("contextual secret assignments refuse under neutral keys", () => {
  assert.equal(boundSolicitation({ ...request, metadata: "password=correct-horse-battery-staple" }).code, "forbidden-secret-material");
  assert.equal(settleReceiptVector(providerReceipt({ metadata: "token:correct-horse-battery-staple" })).code, "forbidden-secret-material");
});

test("benign cyclic immutable record graphs terminate without secret refusal", () => {
  const cyclic = { ...request };
  cyclic.metadata = cyclic;
  const result = boundSolicitation(cyclic);
  assert.equal(result.stage, "solicited");
});
