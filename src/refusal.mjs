/** Typed refusal returned at a single formation seam. */
export function refuse(seam, code, detail) {
  return Object.freeze({ type: "DeploymentFormationRefusal", seam, code, detail });
}
