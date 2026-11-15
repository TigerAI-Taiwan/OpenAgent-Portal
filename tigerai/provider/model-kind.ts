// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: used by the server (provisioning) and the model page. The gateway does not say which models are embeddings
// (its "kind" field is mostly empty), so the id decides. An embedding model cannot chat, so it is never offered for chat.
export function isEmbeddingModel(id: string): boolean {
  return /(^|[^a-z])(embed|embedding|rerank|reranker)([^a-z]|$)|bge-|(^|[-_/])e5-/i.test(id);
}
