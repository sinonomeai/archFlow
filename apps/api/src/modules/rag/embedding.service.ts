import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../../config/env.js";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const hashToken = (token: string): number => {
  let hash = FNV_OFFSET;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
};

/**
 * 本地哈希向量：无 Embedding Key 时的开发降级。
 * 不是语义模型，只保证同词命中；生产必须配置 EMBEDDING_API_KEY。
 */
const localEmbedding = (text: string, dim: number): number[] => {
  const vector = new Array<number>(dim).fill(0);
  const normalized = text.toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const token of tokens) {
    const units =
      token.length <= 2
        ? [token]
        : Array.from({ length: token.length - 1 }, (_value, index) =>
            token.slice(index, index + 2),
          );

    for (const unit of units) {
      const hash = hashToken(unit);
      const index = hash % dim;
      const sign = (hash & 0x80000000) === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
  }

  const norm = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  return norm === 0
    ? vector
    : vector.map((value) => Number((value / norm).toFixed(8)));
};

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private warned = false;

  readonly dimension = (): number => loadEnv().EMBEDDING_DIM;

  embed = async (texts: string[]): Promise<number[][]> => {
    const env = loadEnv();

    if (!env.EMBEDDING_API_KEY) {
      if (!this.warned) {
        this.logger.warn(
          "未配置 EMBEDDING_API_KEY，RAG 使用本地哈希向量（仅开发可用）",
        );
        this.warned = true;
      }

      return texts.map((text) => localEmbedding(text, env.EMBEDDING_DIM));
    }

    const vectors: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += 10) {
      const batch = texts.slice(offset, offset + 10);
      const response = await fetch(
        `${env.EMBEDDING_BASE_URL.replace(/\/$/, "")}/embeddings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.EMBEDDING_API_KEY}`,
          },
          body: JSON.stringify({
            model: env.EMBEDDING_MODEL,
            input: batch,
            dimensions: env.EMBEDDING_DIM,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Embedding 请求失败：HTTP ${response.status} ${(
            await response.text()
          ).slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as EmbeddingResponse;
      const batchVectors = (payload.data ?? []).map((item) => item.embedding);

      for (const vector of batchVectors) {
        if (!vector || vector.length !== env.EMBEDDING_DIM) {
          throw new Error(
            `Embedding 维度不匹配：期望 ${env.EMBEDDING_DIM}，实际 ${vector?.length ?? 0}`,
          );
        }

        vectors.push(vector);
      }
    }

    if (vectors.length !== texts.length) {
      throw new Error("Embedding 返回数量与输入不一致");
    }

    return vectors;
  };
}
