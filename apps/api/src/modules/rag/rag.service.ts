import { Injectable } from "@nestjs/common";
import { DocumentChunkEntity, KnowledgeFileEntity } from "@arch-flow/db";
import type { Citation } from "@arch-flow/shared";
import { DatabaseService } from "../../database/database.service.js";
import { EmbeddingService } from "./embedding.service.js";
import { chunkText } from "./text-chunker.js";

const TOP_K = 6;

type ChunkSearchRow = {
  file_uuid: string;
  file_name: string;
  content: string;
  score: number;
};

const toVectorLiteral = (vector: number[]): string =>
  `[${vector.join(",")}]`;

@Injectable()
export class RagService {
  constructor(
    private readonly database: DatabaseService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /** 文本入库：切片 → Embedding → 覆盖写 chunks。失败由调用方标记 file.status。 */
  indexFile = async (
    file: KnowledgeFileEntity,
    content: string,
  ): Promise<void> => {
    const chunks = chunkText(content);

    if (chunks.length === 0) {
      throw new Error("文件内容为空，无法建立索引");
    }

    const vectors = await this.embeddings.embed(chunks);

    await this.database.dataSource.transaction(async (manager) => {
      await manager.delete(DocumentChunkEntity, {
        knowledgeId: file.id,
      });

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index] ?? "";
        const vector = vectors[index];

        if (!vector) {
          throw new Error("Embedding 结果缺失");
        }

        await manager.query(
          `INSERT INTO "documents_chunks"
             ("project_id", "knowledge_id", "content", "embedding", "metadata")
           VALUES ($1, $2, $3, $4::vector, $5)`,
          [
            file.projectId,
            file.id,
            chunk,
            toVectorLiteral(vector),
            JSON.stringify({ chunkIndex: index }),
          ],
        );
      }
    });
  };

  search = async (
    projectId: string,
    query: string,
    topK = TOP_K,
  ): Promise<Citation[]> => {
    const [vector] = await this.embeddings.embed([query]);

    if (!vector) {
      return [];
    }

    const rows = (await this.database.dataSource.query(
      `SELECT k."uuid" AS file_uuid,
              k."file_name" AS file_name,
              c."content" AS content,
              1 - (c."embedding" <=> $1::vector) AS score
         FROM "documents_chunks" c
         JOIN "knowledge_base" k ON k."id" = c."knowledge_id"
        WHERE c."project_id" = $2
        ORDER BY c."embedding" <=> $1::vector
        LIMIT $3`,
      [toVectorLiteral(vector), projectId, topK],
    )) as ChunkSearchRow[];

    return rows.map((row) => ({
      fileId: row.file_uuid,
      fileName: row.file_name,
      snippet: row.content.slice(0, 240),
      score: Math.max(0, Math.min(1, Number(row.score))),
    }));
  };
}
