import { AgentStateEntity } from "./agent-state.entity.js";
import { AssetEntity } from "./asset.entity.js";
import { ConversationEntity } from "./conversation.entity.js";
import { ConversationCanvasLayoutEntity } from "./conversation-canvas-layout.entity.js";
import { DocumentChunkEntity } from "./document-chunk.entity.js";
import { KnowledgeFileEntity } from "./knowledge-file.entity.js";
import { MessageEntity } from "./message.entity.js";
import { ProjectEntity } from "./project.entity.js";
import { RunEntity } from "./run.entity.js";
import { UserEntity } from "./user.entity.js";

export { AgentStateEntity } from "./agent-state.entity.js";
export { AssetEntity } from "./asset.entity.js";
export { bigintNumberTransformer, UuidEntity } from "./base.entity.js";
export { ConversationCanvasLayoutEntity } from "./conversation-canvas-layout.entity.js";
export { ConversationEntity } from "./conversation.entity.js";
export { DocumentChunkEntity } from "./document-chunk.entity.js";
export { KnowledgeFileEntity } from "./knowledge-file.entity.js";
export { MessageEntity } from "./message.entity.js";
export { ProjectEntity } from "./project.entity.js";
export { RunEntity } from "./run.entity.js";
export { UserEntity } from "./user.entity.js";

/** TypeORM DataSource 注册用；顺序不影响建表，迁移 SQL 负责外键顺序。 */
export const entities = [
  UserEntity,
  ProjectEntity,
  KnowledgeFileEntity,
  DocumentChunkEntity,
  AssetEntity,
  ConversationEntity,
  ConversationCanvasLayoutEntity,
  MessageEntity,
  RunEntity,
  AgentStateEntity,
];
