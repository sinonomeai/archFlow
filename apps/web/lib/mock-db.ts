import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  MockAccountId,
  MockDatabase,
  type AssetBrief,
  type Conversation,
  type ConversationBrief,
  type CreateConversationInput,
  type CreateProjectInput,
  type FileBrief,
  type Message,
  type MessageListQuery,
  type MockAssetRecord,
  type MockConversationRecord,
  type MockFileRecord,
  type MockGraph,
  type Page,
  type Project,
  type ProjectNode,
  type SendMessageInput,
} from "@arch-flow/shared";
import { getMockDir, readMockJson, withMockFileWrite, writeMockJson } from "./mock-files";

const PROJECT_CREATE_KEY_MS = 24 * 60 * 60 * 1000;
const getUserMockPath = (userId: string) =>
  path.join(getMockDir(), "users", `${MockAccountId.parse(userId)}.json`);
const emptyDatabase = () => MockDatabase.parse({ projects: [], conversations: [] });

export const readMockDatabase = (userId: string): Promise<MockDatabase> =>
  readMockJson(getUserMockPath(userId), MockDatabase, emptyDatabase);

export const updateMockDatabase = async <T>(
  userId: string,
  mutate: (database: MockDatabase) => T,
): Promise<T> => {
  const filePath = getUserMockPath(userId);
  return withMockFileWrite(filePath, async () => {
    const database = await readMockJson(filePath, MockDatabase, emptyDatabase);
    const result = mutate(database);
    await writeMockJson(filePath, MockDatabase, database);
    return result;
  });
};

/** 新建项目时种入的示例资产画布，用于验证“从资产开新会话”。 */
const DEFAULT_ASSET_GRAPH: MockGraph = {
  nodes: [
    {
      id: "node-client",
      kind: "client",
      eyebrow: "客户端",
      label: "Web / App",
      meta: "用户入口",
      left: 16,
      top: 50,
    },
    {
      id: "node-gateway",
      kind: "gateway",
      eyebrow: "接入层",
      label: "API Gateway",
      meta: "鉴权 / 限流",
      left: 40,
      top: 50,
    },
    {
      id: "node-service",
      kind: "service",
      eyebrow: "应用层",
      label: "核心服务",
      meta: "领域逻辑",
      left: 64,
      top: 30,
    },
    {
      id: "node-database",
      kind: "database",
      eyebrow: "存储层",
      label: "PostgreSQL",
      meta: "主数据",
      left: 84,
      top: 52,
    },
    {
      id: "node-cache",
      kind: "cache",
      eyebrow: "存储层",
      label: "Redis",
      meta: "热点缓存",
      left: 64,
      top: 74,
    },
  ],
  edges: [
    { id: "edge-client-gateway", path: "M 16 50 L 40 50" },
    { id: "edge-gateway-service", path: "M 40 50 L 64 30" },
    { id: "edge-service-db", path: "M 64 30 L 84 52" },
    { id: "edge-gateway-cache", path: "M 40 50 L 64 74" },
  ],
};

const toConversationBrief = (
  conversation: MockConversationRecord,
): ConversationBrief => ({
  id: conversation.id,
  title: conversation.title,
  updatedAt: conversation.updatedAt,
});

export const toMockConversation = (
  conversation: MockConversationRecord,
): Conversation => ({
  id: conversation.id,
  projectId: conversation.projectId,
  title: conversation.title,
  draftGraph: conversation.draftGraph,
  draftVersion: conversation.draftVersion,
  messageCount: conversation.messageCount,
  lastMessage: conversation.lastMessage,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const toFileBrief = (file: MockFileRecord): FileBrief => ({
  id: file.id,
  fileName: file.fileName,
  fileType: file.fileType,
  status: file.status,
  createdAt: file.createdAt,
});

const toAssetBrief = (asset: MockAssetRecord): AssetBrief => ({
  id: asset.id,
  name: asset.name,
  createdAt: asset.createdAt,
});

const sortByUpdatedAtDesc = (
  conversations: MockConversationRecord[],
): MockConversationRecord[] =>
  [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const sortByCreatedAtDesc = <T extends { createdAt: string }>(
  records: T[],
): T[] => [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const toProjectNode = (
  project: Project,
  conversations: MockConversationRecord[],
  files: MockFileRecord[],
  assets: MockAssetRecord[],
): ProjectNode => {
  const sortedConversations = sortByUpdatedAtDesc(conversations);

  return {
    ...project,
    lastActiveConversationId: sortedConversations[0]?.id ?? null,
    files: sortByCreatedAtDesc(files).slice(0, 20).map(toFileBrief),
    assets: sortByCreatedAtDesc(assets).slice(0, 20).map(toAssetBrief),
    conversations: sortedConversations.slice(0, 20).map(toConversationBrief),
  };
};

export const listProjectNodes = async (userId: string): Promise<ProjectNode[]> => {
  const database = await readMockDatabase(userId);

  return database.projects.map((project) =>
    toProjectNode(
      project,
      database.conversations.filter(
        (conversation) => conversation.projectId === project.id,
      ),
      database.files.filter((file) => file.projectId === project.id),
      database.assets.filter((asset) => asset.projectId === project.id),
    ),
  );
};

export const createProject = async (
  userId: string,
  input: CreateProjectInput,
  idempotencyKey: string,
): Promise<ProjectNode | null> =>
  updateMockDatabase(userId, (database) => {
    const now = Date.now();
    database.projectCreations = database.projectCreations.filter((entry) => entry.expiresAt > now);
    const replay = database.projectCreations.find((entry) => entry.key === idempotencyKey);
    if (replay) {
      return replay.input.name === input.name && replay.input.description === input.description
        ? replay.project
        : null;
    }

    const timestamp = new Date(now).toISOString();
    const projectId = randomUUID();
    const conversationId = randomUUID();
    const fileId = randomUUID();
    const assetId = randomUUID();

    const project: Project = {
      id: projectId,
      name: input.name,
      description: input.description ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    /** 知识库骨架：挂一个可点击的示例文件，便于验证文件操作菜单。 */
    const file: MockFileRecord = {
      id: fileId,
      projectId,
      fileName: "需求说明.md",
      fileType: "text",
      status: "ready",
      createdAt: timestamp,
    };

    /** 资产库骨架：挂一个示例资产，便于验证资产操作菜单。 */
    const asset: MockAssetRecord = {
      id: assetId,
      projectId,
      name: "初始架构",
      createdAt: timestamp,
      graphData: DEFAULT_ASSET_GRAPH,
    };

    /** 历史会话骨架：新项目下创建一条新会话。 */
    const conversation: MockConversationRecord = {
      id: conversationId,
      projectId,
      title: "新会话",
      draftGraph: null,
      draftVersion: 0,
      messageCount: 0,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    database.projects.push(project);
    database.files.push(file);
    database.assets.push(asset);
    database.conversations.push(conversation);
    const result = toProjectNode(project, [conversation], [file], [asset]);
    database.projectCreations.push({
      key: idempotencyKey,
      input,
      project: result,
      expiresAt: now + PROJECT_CREATE_KEY_MS,
    });
    return result;
  });

export type CreateConversationResult =
  | { status: "created"; conversation: Conversation }
  | { status: "project_not_found" }
  | { status: "asset_not_found" };

/** 在项目下新建空会话（画布初始为空）。 */
export const createConversation = async (
  userId: string,
  projectId: string,
  input: CreateConversationInput,
): Promise<CreateConversationResult> =>
  updateMockDatabase(userId, (database) => {
    const projectExists = database.projects.some(
      (project) => project.id === projectId,
    );

    if (!projectExists) {
      return { status: "project_not_found" };
    }

    /** §4.1：initialAssetId 必须属于当前项目，并用资产图初始化草稿。 */
    const initialAsset = input.initialAssetId
      ? database.assets.find(
          (asset) =>
            asset.id === input.initialAssetId && asset.projectId === projectId,
        )
      : undefined;

    if (input.initialAssetId && !initialAsset) {
      return { status: "asset_not_found" };
    }

    const timestamp = new Date().toISOString();
    const conversation: MockConversationRecord = {
      id: randomUUID(),
      projectId,
      title: input.title ?? "新会话",
      draftGraph: initialAsset?.graphData ?? null,
      draftVersion: 0,
      messageCount: 0,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    database.conversations.push(conversation);

    return {
      status: "created",
      conversation: toMockConversation(conversation),
    };
  });

/** 删除项目：级联删除其知识库文件、资产与会话。 */
export const deleteProject = async (userId: string, projectId: string): Promise<boolean> =>
  updateMockDatabase(userId, (database) => {
    const exists = database.projects.some(
      (project) => project.id === projectId,
    );

    if (!exists) {
      return false;
    }

    database.projects = database.projects.filter((project) => project.id !== projectId);
    database.files = database.files.filter((file) => file.projectId !== projectId);
    database.assets = database.assets.filter((asset) => asset.projectId !== projectId);
    database.conversations = database.conversations.filter(
      (conversation) => conversation.projectId !== projectId,
    );

    return true;
  });

export const deleteFile = async (
  userId: string,
  projectId: string,
  fileId: string,
): Promise<boolean> =>
  updateMockDatabase(userId, (database) => {
    const exists = database.files.some(
      (file) => file.id === fileId && file.projectId === projectId,
    );

    if (!exists) {
      return false;
    }

    database.files = database.files.filter(
      (file) => !(file.id === fileId && file.projectId === projectId),
    );

    return true;
  });

export const deleteAsset = async (
  userId: string,
  projectId: string,
  assetId: string,
): Promise<boolean> =>
  updateMockDatabase(userId, (database) => {
    const exists = database.assets.some(
      (asset) => asset.id === assetId && asset.projectId === projectId,
    );

    if (!exists) {
      return false;
    }

    database.assets = database.assets.filter(
      (asset) => !(asset.id === assetId && asset.projectId === projectId),
    );

    return true;
  });

export const deleteConversation = async (
  userId: string,
  conversationId: string,
): Promise<boolean> =>
  updateMockDatabase(userId, (database) => {
    const exists = database.conversations.some(
      (conversation) => conversation.id === conversationId,
    );

    if (!exists) {
      return false;
    }

    database.conversations = database.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );

    return true;
  });

/** 重命名会话；不改变 updatedAt，避免侧边栏排序因改名而跳动。 */
export const renameConversation = async (
  userId: string,
  conversationId: string,
  title: string,
): Promise<Conversation | null> =>
  updateMockDatabase(userId, (database) => {
    const conversation = database.conversations.find(
      (item) => item.id === conversationId,
    );

    if (!conversation) {
      return null;
    }

    conversation.title = title;
    conversation.titleManuallySet = true;
    return toMockConversation(conversation);
  });

/** 追加一条用户消息，并同步会话的计数、摘要与更新时间。 */
export const appendMessage = async (
  userId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<Message | null> =>
  updateMockDatabase(userId, (database) => {
    const conversation = database.conversations.find(
      (item) => item.id === conversationId,
    );

    if (!conversation) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const message: Message = {
      id: randomUUID(),
      role: "user",
      content: input.content,
      graphSnapshot: null,
      metadata: null,
      createdAt: timestamp,
    };

    conversation.messages.push(message);
    conversation.messageCount += 1;
    conversation.lastMessage = {
      id: message.id,
      role: message.role,
      contentPreview: input.content.slice(0, 80),
      createdAt: timestamp,
    };
    conversation.updatedAt = timestamp;

    return message;
  });

export const getMockConversationRecord = async (
  userId: string,
  conversationId: string,
): Promise<MockConversationRecord | null> => {
  const database = await readMockDatabase(userId);
  return (
    database.conversations.find(
      (conversation) => conversation.id === conversationId,
    ) ?? null
  );
};

export const updateMockConversationRecord = async (
  userId: string,
  conversationId: string,
  update: (record: MockConversationRecord) => MockConversationRecord | null,
): Promise<MockConversationRecord | null> =>
  updateMockDatabase(userId, (database) => {
    const index = database.conversations.findIndex(
      (conversation) => conversation.id === conversationId,
    );
    const updated = index !== -1 && update(database.conversations[index]);
    if (!updated) return null;

    database.conversations[index] = updated;
    return updated;
  });

/** §4.2：只返回会话元信息 + 草稿图，不含消息。 */
export const getConversation = async (
  userId: string,
  conversationId: string,
): Promise<Conversation | null> => {
  const record = await getMockConversationRecord(userId, conversationId);
  return record ? toMockConversation(record) : null;
};

/**
 * §4.4：消息游标分页。
 * cursor 使用消息 id（对前端不透明）；backward 从最新往前翻，forward 从游标往后翻。
 * 返回的 items 始终按时间正序排列，便于直接渲染。
 */
export const listMessages = async (
  userId: string,
  conversationId: string,
  query: MessageListQuery,
): Promise<Page<Message> | null> => {
  const database = await readMockDatabase(userId);
  const record = database.conversations.find(
    (conversation) => conversation.id === conversationId,
  );

  if (!record) {
    return null;
  }

  const messages = record.messages.filter(
    (message) => message.role !== "system",
  );
  const { limit, cursor, direction } = query;

  if (direction === "backward") {
    const cursorIndex = cursor
      ? messages.findIndex((message) => message.id === cursor)
      : messages.length;
    const endIndex = cursorIndex === -1 ? messages.length : cursorIndex;
    const startIndex = Math.max(0, endIndex - limit);
    const items = messages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[0].id : null,
      hasMore,
    };
  }

  const cursorIndex = cursor
    ? messages.findIndex((message) => message.id === cursor)
    : -1;
  const startIndex = cursorIndex + 1;
  const items = messages.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + items.length < messages.length;

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  };
};
