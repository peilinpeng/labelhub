export type CanonicalSerializationVersion = "canonical-json-v1";

export type ChecksumInputEnvelope = {
  canonicalSerializationVersion: CanonicalSerializationVersion;
  checksumAlgorithm: "SHA-256";
  checksumInput: unknown;
};
