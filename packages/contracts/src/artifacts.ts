import { type SCHEMA_VERSIONS } from './schema-versions.ts';
import type { SafetyState } from './events.ts';

/** Kinds of content that may be referenced by a signed deployment envelope. */
export const ARTIFACT_REFERENCE_KINDS = [
  'recipe',
  'behavior-tree-ir',
  'module-manifest',
  'twin-spec',
  'map',
  'calibration-bundle',
  'model',
  'firmware',
  'configuration',
] as const;

export type ArtifactReferenceKind = (typeof ARTIFACT_REFERENCE_KINDS)[number];

export interface ArtifactReference {
  kind: ArtifactReferenceKind;
  /** Stable identifier, e.g. `poultry-evening-feed@1.0.0` or `WD-01-0042`. */
  id: string;
  /** Lowercase hex SHA-256 of the exact referenced bytes. */
  hash: string;
}

export interface ArtifactSignature {
  /** For example `ed25519`. */
  algorithm: string;
  /** Identifier of the signing key, resolvable in the key register. */
  signerKeyId: string;
  /** Base64 signature over the canonicalised envelope content. */
  value: string;
}

export interface ArtifactApproval {
  /** Gate that authorised this artifact, e.g. `G5`. */
  gate: string;
  approvedBy: string;
  /** ISO 8601 UTC. */
  approvedAt: string;
  changeTicket?: string;
  notes?: string;
}

/**
 * Envelope that makes an artifact deployable. The edge runtime verifies every
 * reference hash and the signature before execution; an unsigned, partially
 * installed or mismatched bundle must not run.
 */
export interface SignedArtifactEnvelope {
  schemaVersion: typeof SCHEMA_VERSIONS.artifact;
  artifactId: string;
  /** ISO 8601 UTC creation time. */
  createdAt: string;
  createdBy: string;
  hashAlgorithm: 'sha256';
  /** Lowercase hex SHA-256 over the canonical artifact payload. */
  contentHash: string;
  references: ArtifactReference[];
  signature: ArtifactSignature;
  approval: ArtifactApproval;
}

/** Deployment instruction for one robot. Fleet services are non-safety. */
export interface DeploymentManifest {
  schemaVersion: typeof SCHEMA_VERSIONS.artifact;
  robotId: string;
  envelope: SignedArtifactEnvelope;
  /** Zones the artifact is approved for; execution outside them is inhibited. */
  approvedZones: string[];
  /** Safety mode the controller must report before the artifact may be armed. */
  requiredSafetyMode: SafetyState;
  /** Envelope to restore if this deployment fails or is rolled back. */
  rollbackEnvelopeId?: string;
  /** ISO 8601 UTC. */
  issuedAt: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}
