import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type CanvasLayout,
  type CanvasLayoutResult,
  type Conversation,
  type CreateConversationInput,
  type ForkInput,
  type ForkResult,
  type LooseGraph,
  type Message,
  type MessageListQuery,
  type MessageMetadata,
  type Page,
  type RewindInput,
  type SaveCanvasLayoutInput,
  type SaveDraftInput,
  type SaveDraftResult,
  type UpdateConversationInput,
} from "@arch-flow/shared";
import {
  AgentStateEntity,
  AssetEntity,
  ConversationCanvasLayoutEntity,
  ConversationEntity,
  MessageEntity,
  RunEntity,
} from "@arch-flow/db";
import { In } from "typeorm";
import { apiError } from "../../common/api-error.js";
import {
  decodeCursor,
  encodeCursor,
} from "../../common/pagination.js";
import type { AuthUser } from "../../common/request-context.js";
import { DatabaseService } from "../../database/database.service.js";
import { ProjectService } from "../project/project.service.js";

const MAX_FORK_MESSAGES = 200;

const toMessage = (message: MessageEntity): Message => ({
  id: message.uuid,
  role: message.role as Message["role"],
  content: message.content,
  graphSnapshot: (message.graphSnapshot as LooseGraph | null) ?? null,
  metadata: (message.metadata as MessageMetadata | null) ?? null,
  createdAt: message.createdAt.toISOString(),
});

@Injectable()
export class ConversationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly projects: ProjectService,
  ) {}

  private readonly repository = () =>
    this.database.dataSource.getRepository(ConversationEntity);

  private readonly messages = () =>
    this.database.dataSource.getRepository(MessageEntity);

  create = async (
    user: AuthUser,
    projectUuid: string,
    input: CreateConversationInput,
  ): Promise<Conversation> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    let draftGraph: Record<string, unknown> | null = null;

    if (input.initialAssetId) {
      const asset = await this.database.dataSource
        .getRepository(AssetEntity)
        .findOneBy({
          uuid: input.initialAssetId,
          projectId: project.id,
        });

      if (!asset) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          ERROR_CODES.ASSET_NOT_FOUND,
          "资产不存在",
        );
      }

      draftGraph = asset.graphData;
    }

    const conversation = this.repository().create({
      projectId: project.id,
      title: input.title ?? "新会话",
      currentDraftGraph: draftGraph,
      draftVersion: 0,
    });

    await this.repository().save(conversation);

    return this.toConversation(conversation, project.uuid, 0, null);
  };

  get = async (
    user: AuthUser,
    conversationUuid: string,
  ): Promise<Conversation> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    const project = await this.projects.requireById(
      user,
      conversation.projectId,
    );
    const [messageCount, lastMessage] = await Promise.all([
      this.messages().count({
        where: { conversationId: conversation.id },
      }),
      this.messages().findOne({
        where: { conversationId: conversation.id },
        order: { createdAt: "DESC", id: "DESC" },
      }),
    ]);

    return this.toConversation(
      conversation,
      project.uuid,
      messageCount,
      lastMessage,
    );
  };

  update = async (
    user: AuthUser,
    conversationUuid: string,
    input: UpdateConversationInput,
  ): Promise<Conversation> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    conversation.title = input.title;
    await this.repository().save(conversation);

    return this.get(user, conversationUuid);
  };

  remove = async (
    user: AuthUser,
    conversationUuid: string,
  ): Promise<void> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    await this.repository().remove(conversation);
  };

  saveDraft = async (
    user: AuthUser,
    conversationUuid: string,
    input: SaveDraftInput,
  ): Promise<SaveDraftResult> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    /** TypeORM 的 UPDATE ... RETURNING 返回 [rows, affected]，不是裸 rows。 */
    const [rows] = (await this.database.dataSource.query(
      `UPDATE "conversations"
          SET "current_draft_graph" = $1,
              "draft_version" = "draft_version" + 1,
              "updated_at" = now()
        WHERE "id" = $2 AND "draft_version" = $3
        RETURNING "draft_version", "updated_at"`,
      [JSON.stringify(input.graph), conversation.id, input.baseVersion],
    )) as [Array<{ draft_version: number; updated_at: Date | string }>, number];

    const row = rows[0];

    if (!row) {
      const current = await this.repository().findOneBy({
        id: conversation.id,
      });

      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.DRAFT_VERSION_CONFLICT,
        "草稿已在其他窗口被修改",
        undefined,
        { currentVersion: current?.draftVersion ?? 0 },
      );
    }

    return {
      draftVersion: Number(row.draft_version),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  };

  getLayout = async (
    user: AuthUser,
    conversationUuid: string,
  ): Promise<CanvasLayoutResult> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    const row = await this.database.dataSource
      .getRepository(ConversationCanvasLayoutEntity)
      .findOneBy({ conversationId: conversation.id });

    if (!row) {
      return {
        layout: { nodes: {} },
        version: 0,
        updatedAt: conversation.updatedAt.toISOString(),
      };
    }

    return {
      layout: row.layoutData as CanvasLayout,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  saveLayout = async (
    user: AuthUser,
    conversationUuid: string,
    input: SaveCanvasLayoutInput,
  ): Promise<CanvasLayoutResult> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    const repository = this.database.dataSource.getRepository(
      ConversationCanvasLayoutEntity,
    );
    const row = await repository.findOneBy({
      conversationId: conversation.id,
    });

    if (!row) {
      if (input.baseVersion !== 0) {
        throw apiError(
          HttpStatus.CONFLICT,
          ERROR_CODES.DRAFT_VERSION_CONFLICT,
          "画布布局已在其他窗口被修改",
          undefined,
          { currentVersion: 0 },
        );
      }

      const created = repository.create({
        conversationId: conversation.id,
        layoutData: input.layout,
        version: 1,
      });
      await repository.save(created);

      return {
        layout: input.layout,
        version: created.version,
        updatedAt: created.updatedAt.toISOString(),
      };
    }

    if (row.version !== input.baseVersion) {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.DRAFT_VERSION_CONFLICT,
        "画布布局已在其他窗口被修改",
        undefined,
        { currentVersion: row.version },
      );
    }

    row.layoutData = input.layout;
    row.version += 1;
    await repository.save(row);

    return {
      layout: input.layout,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  listMessages = async (
    user: AuthUser,
    conversationUuid: string,
    query: MessageListQuery,
  ): Promise<Page<Message>> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    const builder = this.messages()
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", {
        conversationId: conversation.id,
      })
      .andWhere("message.role <> :system", { system: "system" })
      .take(query.limit + 1);

    if (query.direction === "forward") {
      builder.orderBy("message.id", "ASC");

      if (query.cursor) {
        const cursor = this.requireCursor(query.cursor);
        builder.andWhere("message.id > :cursorId", {
          cursorId: cursor.id,
        });
      }

      const rows = await builder.getMany();
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items.at(-1);

      return {
        items: items.map(toMessage),
        nextCursor:
          hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        hasMore,
      };
    }

    builder.orderBy("message.id", "DESC");

    if (query.cursor) {
      const cursor = this.requireCursor(query.cursor);
      builder.andWhere("message.id < :cursorId", { cursorId: cursor.id });
    }

    const rows = await builder.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const oldest = page.at(-1);

    return {
      items: [...page].reverse().map(toMessage),
      nextCursor:
        hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
      hasMore,
    };
  };

  fork = async (
    user: AuthUser,
    conversationUuid: string,
    input: ForkInput,
  ): Promise<ForkResult> => {
    const source = await this.requireEntity(user, conversationUuid);
    const sourceMessage = await this.requireMessage(
      source.id,
      input.sourceMessageId,
    );
    const history = await this.messages()
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", {
        conversationId: source.id,
      })
      .andWhere("message.id <= :sourceId", {
        sourceId: sourceMessage.id,
      })
      .orderBy("message.id", "ASC")
      .getMany();

    if (history.length > MAX_FORK_MESSAGES) {
      throw apiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.VALIDATION_FAILED,
        `消息数超过 ${MAX_FORK_MESSAGES} 条，暂不支持分叉`,
      );
    }

    const project = await this.projects.requireById(
      user,
      source.projectId,
    );
    const now = new Date();
    const target = this.repository().create({
      projectId: source.projectId,
      title: `${source.title}（分叉）`.slice(0, 50),
      currentDraftGraph:
        sourceMessage.graphSnapshot ?? source.currentDraftGraph,
      draftVersion: 0,
      createdAt: now,
      updatedAt: now,
    });

    await this.repository().save(target);

    const copies = history.map((message) =>
      this.messages().create({
        conversationId: target.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        graphSnapshot: message.graphSnapshot,
        createdAt: message.createdAt,
        updatedAt: now,
      }),
    );

    if (copies.length > 0) {
      await this.messages().save(copies);
    }

    const last = copies.at(-1) ?? null;

    return {
      ...this.toConversation(target, project.uuid, copies.length, last),
      forkedFrom: {
        conversationId: source.uuid,
        sourceMessageId: sourceMessage.uuid,
      },
    };
  };

  /**
   * 原地回退：删除 sourceMessage 之后的全部消息，画布恢复到该时间点。
   * 与 fork 的区别：fork 新建会话、保留原会话；rewind 直接截断当前会话。
   */
  rewind = async (
    user: AuthUser,
    conversationUuid: string,
    input: RewindInput,
  ): Promise<Conversation> => {
    const conversation = await this.requireEntity(user, conversationUuid);
    const source = await this.requireMessage(
      conversation.id,
      input.sourceMessageId,
    );
    const active = await this.database.dataSource
      .getRepository(RunEntity)
      .findOne({
        where: {
          conversationId: conversation.id,
          status: In(["queued", "running", "waiting_input"]),
        },
        order: { createdAt: "DESC", id: "DESC" },
      });

    /**
     * waiting_input 的 run 可以直接放弃：删除消息时会级联删除 run；
     * running / queued 仍在写库，回退会与写入竞争，必须先等它结束或取消。
     */
    if (active && active.status !== "waiting_input") {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONVERSATION_BUSY,
        "会话正在生成中，暂时不能回退",
        undefined,
        { activeRunId: active.uuid },
      );
    }

    const previousSnapshot = await this.messages()
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", {
        conversationId: conversation.id,
      })
      .andWhere("message.id <= :sourceId", { sourceId: source.id })
      .andWhere("message.graphSnapshot IS NOT NULL")
      .orderBy("message.id", "DESC")
      .getOne();

    const snapshot =
      source.graphSnapshot ?? previousSnapshot?.graphSnapshot ?? null;

    await this.database.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(MessageEntity)
        .createQueryBuilder()
        .delete()
        .where(
          "conversation_id = :conversationId AND id > :sourceId",
          { conversationId: conversation.id, sourceId: source.id },
        )
        .execute();

      /** 约束是会话级快照，回退后重新从剩余对话提取，避免带着未来状态。 */
      await manager
        .getRepository(AgentStateEntity)
        .delete({ conversationId: conversation.id });

      conversation.currentDraftGraph = snapshot;
      conversation.draftVersion += 1;
      conversation.updatedAt = new Date();
      await manager.getRepository(ConversationEntity).save(conversation);
    });

    return this.get(user, conversationUuid);
  };

  /** 供 Agent / Cards 模块复用：按 uuid 校验会话归属。 */
  requireEntity = async (
    user: AuthUser,
    conversationUuid: string,
  ): Promise<ConversationEntity> => {
    const conversation = await this.repository().findOneBy({
      uuid: conversationUuid,
    });

    if (!conversation) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.CONVERSATION_NOT_FOUND,
        "会话不存在",
      );
    }

    await this.projects.requireById(user, conversation.projectId);

    return conversation;
  };

  requireMessage = async (
    conversationId: string,
    messageUuid: string,
  ): Promise<MessageEntity> => {
    const message = await this.messages().findOneBy({
      uuid: messageUuid,
      conversationId,
    });

    if (!message) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.MESSAGE_NOT_FOUND,
        "消息不存在",
      );
    }

    return message;
  };

  private readonly toConversation = (
    conversation: ConversationEntity,
    projectUuid: string,
    messageCount: number,
    lastMessage: MessageEntity | null,
  ): Conversation => ({
    id: conversation.uuid,
    projectId: projectUuid,
    title: conversation.title,
    draftGraph: (conversation.currentDraftGraph as LooseGraph | null) ?? null,
    draftVersion: conversation.draftVersion,
    messageCount,
    lastMessage: lastMessage
      ? {
          id: lastMessage.uuid,
          role: lastMessage.role as Message["role"],
          contentPreview: lastMessage.content.slice(0, 80),
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  });

  private readonly requireCursor = (
    cursor: string,
  ): { createdAt: Date; id: string } => {
    const decoded = decodeCursor(cursor);

    if (!decoded) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_FAILED,
        "分页游标不合法",
      );
    }

    return { createdAt: decoded.updatedAt, id: decoded.id };
  };
}
