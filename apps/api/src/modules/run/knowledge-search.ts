import {
  AgentKnowledgeQuery,
  Citation,
  ERROR_CODES,
  type Citation as CitationResult,
} from "@arch-flow/shared";
import type {
  AgentEmbedding,
  CreateAgentEngineOptions,
} from "@arch-flow/agent";
import type { DataSource } from "typeorm";
import { z } from "zod";
import { runException } from "./run-store.js";

const EMBEDDING_DIMENSIONS = 1536;
const MAX_EVIDENCE = 5;
const MIN_SIMILARITY = 0.25;
const SQL_SCOPE = `
  FROM projects AS p
  JOIN documents_chunks AS d ON d.project_id = p.id
  JOIN knowledge_base AS f ON f.id = d.knowledge_id AND f.project_id = p.id
  WHERE p.uuid = $1 AND f.status = 'ready' AND f.file_type IN ('text', 'image')
    AND ($2::uuid[] = '{}'::uuid[] OR f.uuid = ANY($2::uuid[]))`;

/** Intent matching may use another embedding shape. Only 1536-d vectors may enter this query. */
export const createKnowledgeSearch =
  (
    dataSource: DataSource,
    embed?: AgentEmbedding,
  ): NonNullable<CreateAgentEngineOptions["searchKnowledge"]> =>
  async (input, signal): Promise<CitationResult[]> => {
    const { projectId, attachments, query } = AgentKnowledgeQuery.parse(input);
    const scope = [
      z.uuid().parse(projectId),
      z.array(z.uuid()).parse(attachments),
    ];
    signal?.throwIfAborted();

    const eligible: unknown[] = await dataSource.query(
      `SELECT 1 ${SQL_SCOPE} LIMIT 1`,
      scope,
    );
    if (eligible.length === 0) return [];
    if (!embed)
      throw runException(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "知识库检索暂不可用，请配置向量模型",
      );

    const [vector] = await embed([query], signal);
    signal?.throwIfAborted();
    if (
      !vector ||
      vector.length !== EMBEDDING_DIMENSIONS ||
      !vector.every(Number.isFinite) ||
      !vector.some((value) => value !== 0)
    ) {
      throw runException(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "向量模型的维度与知识库不一致",
      );
    }

    const rows: unknown = await dataSource.query(
      `
    SELECT f.uuid AS "fileId", f.file_name AS "fileName", left(d.content, 2000) AS snippet,
      least(1, greatest(0, 1 - (d.embedding <=> $3::vector))) AS score
    ${SQL_SCOPE}
      AND (d.embedding <=> $3::vector) <= $4
    ORDER BY d.embedding <=> $3::vector
    LIMIT $5
  `,
      [...scope, JSON.stringify(vector), 1 - MIN_SIMILARITY, MAX_EVIDENCE],
    );
    signal?.throwIfAborted();
    return z.array(Citation).parse(rows);
  };
