/**
 * Pluggable text embeddings (ADR-005). Vendor-specific code stays in sidecar adapters; secrets are passed per call.
 */
export interface IEmbeddingPort {
  /**
   * Embed a batch of strings into vectors. Length of result matches `texts`.
   * @param apiKey Optional credential from Obsidian SecretStorage, forwarded by the caller.
   */
  embed(texts: string[], apiKey?: string): Promise<Float32Array[]>;
}
