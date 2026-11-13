import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type {
  Citation,
  ConstraintCard,
  FinishReason,
  Interrupt,
  RunStage,
} from "@arch-flow/shared";
import {
  ARCHITECTURE_TOOL_PROMPT,
  CONSTRAINT_TOOL_PROMPT,
  DESIGN_REVIEW_PROMPT,
  INTENT_PROMPT,
  META_ANSWER_PROMPT,
  SYSTEM_PROMPT,
  buildContext,
  buildReplyPrompt,
} from "./prompts/index.js";
import {
  ArchitectureOutput,
  ExtractedConstraints,
  type ArchitectureGraph,
  type ArchitectureOutput as ArchitectureOutputType,
  type Constraints,
  type GeneratedNode,
} from "./schemas.js";

export type AgentInput = {
  userMessage: string;
  conversationTitle: string;
  constraints: Constraints;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  draftGraph: ArchitectureGraph | null;
  citations: Citation[];
  assistantMessageId: string;
  /** 架构生成后已完成的设计取舍轮次。 */
  designRounds: number;
  /** HITL 恢复：一次可带回多个约束字段。 */
  resume?: Array<{
    field: string;
    values: string[];
    isCustom: boolean;
  }>;
  signal: AbortSignal;
};

export type AgentEvent =
  | { type: "status"; stage: RunStage }
  | { type: "text-delta"; content: string }
  | { type: "graph"; graph: ArchitectureGraph }
  | { type: "citation"; sources: Citation[] }
  | { type: "constraint-card"; card: ConstraintCard }
  | { type: "interrupt"; interrupt: Interrupt }
  | { type: "constraints"; constraints: Constraints }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      model: string;
      latencyMs: number;
    }
  | { type: "title"; title: string }
  | { type: "done"; finishReason: FinishReason }
  | { type: "error"; code: string; message: string };

export type AgentConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
};

const SAVE_CONSTRAINTS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "save_constraints",
    description: "保存从对话中明确提取到的约束；没有提到的字段不要输出。",
    parameters: {
      type: "object",
      properties: {
        teamSize: { type: "string", description: "团队规模，如 1-3 人" },
        deployTarget: {
          type: "string",
          description: "部署方式，如 公有云 / 私有化 / 混合云",
        },
        scale: { type: "string", description: "用户量或并发规模" },
        budget: { type: "string", description: "预算约束" },
        techStack: { type: "string", description: "已有技术栈" },
        dataVolume: { type: "string", description: "数据量级" },
        availability: { type: "string", description: "可用性要求" },
        compliance: {
          type: "string",
          description: "版权、付费或内容合规要求",
        },
        integration: {
          type: "string",
          description: "第三方音源接入方式：服务端代理 / 客户端直连 / 只做元数据转换",
        },
        authModel: {
          type: "string",
          description: "认证与授权模型，如 JWT + RBAC",
        },
        database: { type: "string", description: "数据库选型" },
        apiStyle: {
          type: "string",
          description: "接口风格：REST / GraphQL / tRPC",
        },
        routingPreference: {
          type: "string",
          description: "前后端路由或页面结构偏好",
        },
      },
      additionalProperties: false,
    },
  },
};

const EMIT_ARCHITECTURE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "emit_architecture",
    description: "输出架构方案、说明文字和结构化图数据。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "不超过 20 字的架构标题" },
        reply: {
          type: "string",
          description: "2-5 段中文说明，解释方案与权衡",
        },
        nodes: {
          type: "array",
          minItems: 3,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "client",
                  "gateway",
                  "auth",
                  "service",
                  "worker",
                  "database",
                  "cache",
                  "queue",
                  "storage",
                  "search",
                  "external",
                  "table",
                ],
              },
              label: { type: "string" },
              description: { type: "string" },
              layer: { type: "integer", minimum: 0, maximum: 6 },
              table: {
                type: "object",
                description: "type = table 时必填",
                properties: {
                  name: { type: "string" },
                  columns: {
                    type: "array",
                    minItems: 1,
                    maxItems: 40,
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        nullable: { type: "boolean" },
                        primaryKey: { type: "boolean" },
                        foreignKey: { type: "string" },
                        description: { type: "string" },
                      },
                      required: ["name", "type"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "columns"],
                additionalProperties: false,
              },
            },
            required: ["id", "type", "label", "layer"],
            additionalProperties: false,
          },
        },
        edges: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
              dataFlow: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: ["sync", "async", "data", "control"],
                  },
                  protocol: { type: "string" },
                  direction: {
                    type: "string",
                    enum: ["one-way", "request-response"],
                  },
                  payload: { type: "string" },
                },
                required: ["kind"],
                additionalProperties: false,
              },
            },
            required: ["from", "to"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "reply", "nodes", "edges"],
      additionalProperties: false,
    },
  },
};

const DESIGN_FIELDS = [
  "database",
  "cache",
  "queue",
  "auth",
  "observability",
  "scale",
  "budget",
  "compliance",
  "integration",
  "availability",
  "techStack",
  "authModel",
  "apiStyle",
  "routingPreference",
  "other",
] as const;
type DesignField = (typeof DESIGN_FIELDS)[number];

const ASK_DESIGN_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "ask_design_card",
    description:
      "当前架构存在一个会实质改变结构的待确认取舍时，向用户抛出一张卡片。",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [...DESIGN_FIELDS],
          description: "这次取舍对应的约束字段",
        },
        title: { type: "string", description: "卡片标题，20 字以内" },
        question: { type: "string", description: "具体问题，80 字以内" },
        intro: {
          type: "string",
          description: "先展示给用户的一两句说明，解释为什么现在要问",
        },
        kind: { type: "string", enum: ["single", "multi"] },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
            },
            required: ["value", "label"],
            additionalProperties: false,
          },
        },
      },
      required: ["field", "title", "question", "intro", "kind", "options"],
      additionalProperties: false,
    },
  },
};

const FINISH_DESIGN_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "finish_design",
    description: "当前架构已经足够，结束设计复核并输出最终说明。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

const DesignReviewSchema = z.object({
  field: z.enum(DESIGN_FIELDS),
  title: z.string().min(1).max(40),
  question: z.string().min(1).max(200),
  intro: z.string().min(1).max(300),
  kind: z.enum(["single", "multi"]),
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .min(2)
    .max(6),
});
type DesignReview = z.infer<typeof DesignReviewSchema>;

const CLASSIFY_INTENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "classify_intent",
    description: "区分用户是在询问 ArchFlow 产品能力，还是在要求设计一个具体系统。",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["meta", "architecture"] },
        reason: { type: "string", description: "一句话理由" },
      },
      required: ["mode", "reason"],
      additionalProperties: false,
    },
  },
};

const IntentSchema = z.object({
  mode: z.enum(["meta", "architecture"]),
  reason: z.string().max(300),
});

/** 只有命中产品/画布相关词汇才做意图分类，避免每条消息多一次 LLM 调用。 */
const META_HINT =
  /(ArchFlow|这个产品|你的能力|你能做什么|画布|节点|数据流|约束卡片|卡片|SSE|导出|资产库|知识库|工作台|为什么不?能|怎么不?能|不支持|还没实现)/i;

/** 架构生成后最多追问的轮次；要覆盖必查清单、详细选型和 LLM 自主追问。 */
const MAX_DESIGN_ROUNDS = 10;

const REQUIRED_CONSTRAINTS: Array<{
  field: string;
  title: string;
  question: string;
  options: Array<{ value: string; label: string; description?: string }>;
}> = [
  {
    field: "teamSize",
    title: "团队规模",
    question: "为了给出合适的架构，团队大概有多少人？",
    options: [
      { value: "1-3", label: "1-3 人", description: "个人或小团队" },
      { value: "4-10", label: "4-10 人", description: "初创团队" },
      { value: "11-50", label: "11-50 人", description: "中型团队" },
      { value: "50+", label: "50+ 人", description: "大型组织" },
    ],
  },
  {
    field: "deployTarget",
    title: "部署方式",
    question: "你计划把系统部署在哪里？",
    options: [
      { value: "public-cloud", label: "公有云", description: "托管服务为主" },
      { value: "private", label: "私有化部署", description: "自有服务器" },
      { value: "hybrid", label: "混合云", description: "核心私有 + 弹性公有" },
    ],
  },
];

/**
 * 画后必查清单：这些约束会直接改变架构，不能只在最终文字里“待确认”。
 * LLM 可以自主追问其他取舍；如果它提前 finish，这里兜底继续问，直到全部确认。
 */
const DESIGN_CHECKLIST: Array<{
  field: DesignField;
  title: string;
  question: string;
  options: Array<{ value: string; label: string; description?: string }>;
}> = [
  {
    field: "scale",
    title: "规模与并发",
    question: "预计用户量和并发播放规模大概是多少？",
    options: [
      { value: "small", label: "1k 用户以内", description: "低并发，单机可承受" },
      { value: "medium", label: "1k - 1w 用户", description: "需要基础缓存与扩容预案" },
      { value: "large", label: "1w - 10w 用户", description: "需要独立缓存与压测" },
      { value: "xlarge", label: "10w+ 用户", description: "需要分层与容量规划" },
      { value: "unknown", label: "暂不确定", description: "先按可演进方案设计" },
    ],
  },
  {
    field: "budget",
    title: "月度云预算",
    question: "可接受的月度云支出上限大概是多少？",
    options: [
      { value: "low", label: "500 元以内", description: "尽量使用免费额度或轻量方案" },
      { value: "medium", label: "500 - 2000 元", description: "可接受少量托管服务" },
      { value: "high", label: "2000 - 10000 元", description: "可引入 CDN、托管数据库等" },
      { value: "unknown", label: "暂不确定", description: "先按低成本方案设计" },
    ],
  },
  {
    field: "compliance",
    title: "版权与合规",
    question: "是否有付费、版权或内容合规要求？",
    options: [
      { value: "none", label: "暂无特殊要求", description: "自有内容或已获授权" },
      { value: "record", label: "需要版权记录", description: "记录来源与授权信息" },
      { value: "review", label: "需要审核流程", description: "上传/播放前需要人工或自动审核" },
      { value: "unknown", label: "暂不确定", description: "先预留审计字段" },
    ],
  },
  {
    field: "integration",
    title: "音源接入方式",
    question: "第三方音源允许服务端代理转发，还是只做元数据转换？",
    options: [
      { value: "proxy", label: "服务端代理音频流", description: "统一鉴权与内容控制" },
      { value: "direct", label: "客户端直连音源", description: "降低带宽成本，依赖第三方" },
      { value: "metadata", label: "只做元数据转换", description: "不代理音频内容" },
      { value: "unknown", label: "暂不确定", description: "先按适配层可替换设计" },
    ],
  },
];

/** 画后第二轮：补齐技术选型，再输出详细设计说明。 */
const DESIGN_DETAIL_STEPS: Array<{
  id: DesignField;
  title: string;
  question: string;
  options: Array<{ value: string; label: string; description?: string }>;
}> = [
  {
    id: "techStack",
    title: "技术栈",
    question: "前后端希望用什么技术栈？",
    options: [
      { value: "next-node", label: "Next.js + Node.js", description: "TypeScript 全栈，部署简单" },
      { value: "react-node", label: "React + Node.js", description: "前后端分离" },
      { value: "vue-node", label: "Vue + Node.js", description: "Vue 生态" },
      { value: "unknown", label: "暂不确定", description: "按团队熟悉度选择" },
    ],
  },
  {
    id: "authModel",
    title: "认证与授权",
    question: "登录认证和权限模型怎么定？",
    options: [
      { value: "jwt-rbac", label: "JWT + RBAC", description: "无状态认证，按角色授权" },
      { value: "session-rbac", label: "Session + RBAC", description: "服务端会话，适合单体" },
      { value: "oauth-oidc", label: "OAuth2 / OIDC", description: "接入第三方身份提供方" },
      { value: "unknown", label: "暂不确定", description: "先预留可替换的认证层" },
    ],
  },
  {
    id: "database",
    title: "数据库选型",
    question: "主数据准备用什么数据库？",
    options: [
      { value: "postgresql", label: "PostgreSQL", description: "事务强，适合结构化数据" },
      { value: "mysql", label: "MySQL", description: "生态成熟，运维熟悉" },
      { value: "mongodb", label: "MongoDB", description: "文档型，结构灵活" },
      { value: "unknown", label: "暂不确定", description: "先按关系型设计" },
    ],
  },
  {
    id: "apiStyle",
    title: "接口风格",
    question: "后端接口希望采用哪种风格？",
    options: [
      { value: "rest", label: "REST", description: "资源化 URL + JSON" },
      { value: "graphql", label: "GraphQL", description: "按需查询，前端灵活" },
      { value: "trpc", label: "tRPC", description: "TypeScript 全栈端到端类型" },
      { value: "unknown", label: "暂不确定", description: "先按 REST 设计" },
    ],
  },
  {
    id: "routingPreference",
    title: "路由组织",
    question: "前后端路由希望怎么组织？",
    options: [
      { value: "domain", label: "按业务领域", description: "如 /auth、/songs、/orders" },
      { value: "page", label: "按页面模块", description: "与前端页面一一对应" },
      { value: "versioned", label: "按版本分层", description: "如 /api/v1/..." },
      { value: "unknown", label: "暂不确定", description: "先按领域 + 版本号" },
    ],
  },
];

const missingConstraints = (
  constraints: Constraints,
): Array<(typeof REQUIRED_CONSTRAINTS)[number]> =>
  REQUIRED_CONSTRAINTS.filter((item) => !constraints[item.field]);

const nextDesignChecklist = (
  constraints: Constraints,
): (typeof DESIGN_CHECKLIST)[number] | null =>
  DESIGN_CHECKLIST.find((item) => !constraints[item.field]) ?? null;

/**
 * 把模型输出收敛成共享 Graph：节点 / 边 id 由后端重写，模型只负责语义。
 * 坐标不入库，布局由前端 Dagre 计算。
 */
const buildGraph = (output: ArchitectureOutputType): ArchitectureGraph => {
  const idMap = new Map<string, string>();

  output.nodes.forEach((node, index) => {
    if (idMap.has(node.id)) {
      throw new Error(`节点 id 重复：${node.id}`);
    }

    idMap.set(node.id, `n${index + 1}`);
  });

  const mapId = (sourceId: string): string => {
    const mapped = idMap.get(sourceId);

    if (!mapped) {
      throw new Error(`边引用了不存在的节点：${sourceId}`);
    }

    return mapped;
  };

  return {
    nodes: output.nodes.map((node) => ({
      id: mapId(node.id),
      type: node.type,
      label: node.label,
      ...(node.description ? { description: node.description } : {}),
      ...(node.table ? { table: node.table } : {}),
    })),
    edges: output.edges.map((edge, index) => ({
      id: `e${index + 1}`,
      source: mapId(edge.from),
      target: mapId(edge.to),
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.dataFlow ? { dataFlow: edge.dataFlow } : {}),
    })),
  };
};

const APPEND_HINT =
  /(旁边|追加|补充|在原有|保留|新增|再加|添加|不要删除|别删|基于当前|在当前画布)/;

/** 追加模式：保留已有节点/边，新图按 id 覆盖同名项并追加新项。 */
const mergeGraph = (
  existing: ArchitectureGraph,
  next: ArchitectureGraph,
): ArchitectureGraph => {
  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  const nextEdgeIds = new Set(next.edges.map((edge) => edge.id));

  return {
    nodes: [
      ...existing.nodes.filter((node) => !nextNodeIds.has(node.id)),
      ...next.nodes,
    ],
    edges: [
      ...existing.edges.filter((edge) => !nextEdgeIds.has(edge.id)),
      ...next.edges,
    ],
  };
};

const fallbackGraph = (constraints: Constraints): ArchitectureGraph => {
  const hasCache = Boolean(constraints.scale || constraints.availability);
  const nodes: GeneratedNode[] = [
    {
      id: "client",
      type: "client",
      label: "Web / App",
      description: "用户入口",
      layer: 0,
    },
    {
      id: "gateway",
      type: "gateway",
      label: "API Gateway",
      description: "鉴权 / 限流",
      layer: 1,
    },
    {
      id: "service",
      type: "service",
      label: "核心服务",
      description: "领域逻辑",
      layer: 2,
    },
    {
      id: "database",
      type: "database",
      label: "PostgreSQL",
      description: "主数据",
      layer: 3,
    },
  ];

  if (hasCache) {
    nodes.push({
      id: "cache",
      type: "cache",
      label: "Redis",
      description: "热点缓存",
      layer: 3,
    });
  }

  return buildGraph({
    title: "基础分层架构",
    reply: "这是一个可演进的分层架构：客户端经网关进入核心服务，主数据落 PostgreSQL。",
    nodes,
    edges: [
      { from: "client", to: "gateway" },
      { from: "gateway", to: "service" },
      { from: "service", to: "database" },
      ...(hasCache ? [{ from: "service", to: "cache" }] : []),
    ],
  });
};

export class AgentEngine {
  private readonly client: OpenAI | null;

  constructor(private readonly config: AgentConfig) {
    this.client = config.apiKey
      ? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
      : null;
  }

  run = async function* (
    this: AgentEngine,
    input: AgentInput,
  ): AsyncGenerator<AgentEvent> {
    const startedAt = Date.now();
    const usage = { inputTokens: 0, outputTokens: 0 };
    const constraints: Constraints = { ...input.constraints };

    if (input.resume) {
      for (const answer of input.resume) {
        constraints[answer.field] = answer.values.join("、");
      }

      yield { type: "constraints", constraints };
    }

    yield { type: "status", stage: "thinking" };

    const intent = await this.classifyIntent(input, usage);

    if (intent === "meta") {
      yield* this.streamMetaAnswer(input);
      yield* this.emitUsage(usage, startedAt);
      yield { type: "done", finishReason: "stop" };
      return;
    }

    const extracted = await this.extractConstraints(input, constraints);
    Object.assign(constraints, extracted);
    yield { type: "constraints", constraints };

    const missing = missingConstraints(constraints);

    if (missing.length > 0) {
      const now = new Date();
      const card: ConstraintCard = {
        id: randomUUID(),
        messageId: input.assistantMessageId,
        kind: "single",
        title:
          missing.length === 1 ? missing[0]!.title : "补齐关键约束",
        options: missing[0]!.options,
        steps: missing.map((item) => ({
          id: item.field,
          title: item.title,
          question: item.question,
          options: item.options,
        })),
        status: "pending",
        answer: null,
        createdAt: now.toISOString(),
        answeredAt: null,
      };
      const interrupt: Interrupt = {
        interruptId: randomUUID(),
        kind: "clarification",
        node: "COLLECT_CONSTRAINTS",
        payload: {
          question:
            missing.length === 1
              ? missing[0]!.question
              : `还需要确认 ${missing.length} 个约束`,
          field: missing[0]!.field,
          card,
        },
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      };

      yield {
        type: "text-delta",
        content:
          missing.length === 1
            ? `为了给出更合适的架构，我需要先确认一个约束：${missing[0]!.question}\n\n`
            : `为了给出更合适的架构，我还需要确认 ${missing.length} 个约束，请在下面的卡片中依次选择。\n\n`,
      };
      yield { type: "constraint-card", card };
      yield { type: "interrupt", interrupt };
      yield* this.emitUsage(usage, startedAt);
      return;
    }

    if (input.citations.length > 0) {
      yield { type: "citation", sources: input.citations };
    }

    yield { type: "status", stage: "drafting_graph" };

    let graph: ArchitectureGraph;
    let output: ArchitectureOutputType | null = null;

    if (!this.client) {
      output = this.mockOutput(input, constraints);
      graph = fallbackGraph(constraints);
    } else {
      const generated = await this.generateArchitecture(
        input,
        constraints,
        usage,
      );
      output = generated.output;
      graph = generated.graph;
    }

    /** 用户要求“在旁边/追加”时，不覆盖已有架构，只合并新增节点和边。 */
    if (input.draftGraph && APPEND_HINT.test(input.userMessage)) {
      graph = mergeGraph(input.draftGraph, graph);
    }

    yield { type: "graph", graph };

    const title =
      output?.title ??
      (input.conversationTitle === "新会话"
        ? input.userMessage.slice(0, 20)
        : input.conversationTitle);

    if (title && title !== input.conversationTitle) {
      yield { type: "title", title };
    }

    /** 图已经画出来后再做设计复核：有高影响取舍就抛新卡片，形成循环。 */
    if (input.designRounds < MAX_DESIGN_ROUNDS) {
      yield { type: "status", stage: "thinking" };
      let review = await this.reviewDesign(
        input,
        constraints,
        graph,
        usage,
      );

      /**
       * LLM 可能提前 finish，把“规模/预算/合规/音源接入”留给最终文字。
       * 这里用必查清单兜底，确保这些约束以卡片形式被确认，而不是只出现在总结里。
       */
      let detailSteps: typeof DESIGN_DETAIL_STEPS | null = null;

      if (!review) {
        const checklist = nextDesignChecklist(constraints);

        if (checklist) {
          review = {
            field: checklist.field,
            title: checklist.title,
            question: checklist.question,
            intro: "当前架构还有一项会影响结构，需要你确认：",
            kind: "single",
            options: checklist.options,
          };
        } else {
          /** 结构约束齐了之后，再补一轮技术选型，避免最终回答只会讲空泛原则。 */
          const missingDetails = DESIGN_DETAIL_STEPS.filter(
            (step) => !constraints[step.id],
          );
          const firstDetail = missingDetails[0];

          if (firstDetail) {
            detailSteps = missingDetails;
            review = {
              field: firstDetail.id,
              title: "详细设计偏好",
              question: "请补齐技术栈、认证、数据库、接口风格和路由组织。",
              intro:
                "架构骨架已经确定，接下来补齐技术选型，才能给出可落地的表结构和接口设计。",
              kind: "single",
              options: firstDetail.options,
            };
          }
        }
      }

      if (review) {
        const now = new Date();
        const card: ConstraintCard = {
          id: randomUUID(),
          messageId: input.assistantMessageId,
          kind: review.kind,
          title: review.title,
          options: review.options,
          ...(detailSteps ? { steps: detailSteps } : {}),
          status: "pending",
          answer: null,
          createdAt: now.toISOString(),
          answeredAt: null,
        };
        const interrupt: Interrupt = {
          interruptId: randomUUID(),
          kind: "clarification",
          node: "REVIEW_ARCHITECTURE",
          payload: {
            question: review.question,
            field: review.field,
            card,
            designRounds: input.designRounds + 1,
          },
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        };

        yield { type: "text-delta", content: `${review.intro}\n\n` };
        yield { type: "constraint-card", card };
        yield { type: "interrupt", interrupt };
        yield* this.emitUsage(usage, startedAt);
        return;
      }
    }

    yield { type: "status", stage: "finalizing" };

    if (this.client) {
      yield* this.streamReply(input, graph, constraints, output?.reply ?? "");
    } else if (output?.reply) {
      yield { type: "text-delta", content: output.reply };
    }

    yield* this.emitUsage(usage, startedAt);
    yield { type: "done", finishReason: "stop" };
  };

  private readonly classifyIntent = async (
    input: AgentInput,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<"meta" | "architecture"> => {
    if (
      !this.client ||
      input.resume ||
      !META_HINT.test(input.userMessage)
    ) {
      return "architecture";
    }

    const completion = await this.client.chat.completions.create(
      {
        model: this.config.model,
        max_tokens: Math.min(this.config.maxTokens, 512),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${INTENT_PROMPT}\n\n## 用户消息\n${input.userMessage}`,
          },
        ],
        tools: [CLASSIFY_INTENT_TOOL],
        tool_choice: "auto",
      },
      { signal: input.signal },
    );

    usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
    usage.outputTokens += completion.usage?.completion_tokens ?? 0;

    const call = completion.choices[0]?.message.tool_calls?.find(
      (item) => item.type === "function" && item.function.name === "classify_intent",
    );

    if (!call || call.type !== "function" || !call.function.arguments) {
      return "architecture";
    }

    try {
      return IntentSchema.parse(JSON.parse(call.function.arguments)).mode;
    } catch {
      return "architecture";
    }
  };

  private readonly streamMetaAnswer = async function* (
    this: AgentEngine,
    input: AgentInput,
  ): AsyncGenerator<AgentEvent> {
    if (!this.client) {
      yield {
        type: "text-delta",
        content:
          "当前画布只支持组件级架构图，数据库表节点和数据流节点图还在规划中；详见架构规划 §13 与待办清单 P2-15/P2-16。",
      };
      return;
    }

    const stream = await this.client.chat.completions.create(
      {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        stream: true,
        messages: [
          { role: "system", content: META_ANSWER_PROMPT },
          {
            role: "user",
            content: `用户问题：${input.userMessage}`,
          },
        ],
      },
      { signal: input.signal },
    );

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;

      if (content) {
        yield { type: "text-delta", content };
      }
    }
  };

  private readonly extractConstraints = async (
    input: AgentInput,
    constraints: Constraints,
  ): Promise<Partial<Constraints>> => {
    if (!this.client) {
      return {};
    }

    const context = buildContext(
      constraints,
      input.citations,
      input.recentMessages,
      input.draftGraph,
    );
    const completion = await this.client.chat.completions.create(
      {
        model: this.config.model,
        max_tokens: Math.min(this.config.maxTokens, 2048),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${CONSTRAINT_TOOL_PROMPT}\n\n${context}\n\n## 当前用户消息\n${input.userMessage}`,
          },
        ],
        tools: [SAVE_CONSTRAINTS_TOOL],
        /** thinking 模型不支持强制 tool_choice，用 auto + 提示词约束。 */
        tool_choice: "auto",
      },
      { signal: input.signal },
    );
    const message = completion.choices[0]?.message;
    const call = message?.tool_calls?.[0];
    const raw =
      call?.type === "function" && call.function.arguments
        ? call.function.arguments
        : message?.content;

    if (!raw) {
      return {};
    }

    try {
      return ExtractedConstraints.parse(JSON.parse(raw));
    } catch {
      /** 提取失败不阻塞主流程，保留已有约束。 */
      return {};
    }
  };

  private readonly generateArchitecture = async (
    input: AgentInput,
    constraints: Constraints,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<{ output: ArchitectureOutputType; graph: ArchitectureGraph }> => {
    const client = this.client;

    if (!client) {
      throw new Error("LLM 未配置");
    }

    const context = buildContext(
      constraints,
      input.citations,
      input.recentMessages,
      input.draftGraph,
    );
    let lastError = "";

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const completion = await client.chat.completions.create(
        {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `${ARCHITECTURE_TOOL_PROMPT}\n\n${context}\n\n${
                attempt > 0
                  ? `上一次输出不合法：${lastError}\n请修正后重新调用工具。`
                  : ""
              }`,
            },
          ],
          tools: [EMIT_ARCHITECTURE_TOOL],
          tool_choice: "auto",
        },
        { signal: input.signal },
      );

      usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
      usage.outputTokens += completion.usage?.completion_tokens ?? 0;

      const message = completion.choices[0]?.message;
      const call = message?.tool_calls?.[0];
      const raw =
        call?.type === "function" && call.function.arguments
          ? call.function.arguments
          : message?.content;

      if (!raw) {
        lastError = "没有调用 emit_architecture";
        continue;
      }

      try {
        const parsed = ArchitectureOutput.parse(JSON.parse(raw));

        return { output: parsed, graph: buildGraph(parsed) };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    console.warn(`[agent] 图生成未通过校验：${lastError}`);

    /**
     * 已有画布时绝不能用一个通用保底图覆盖它；保留原图并说明本次未生效。
     */
    if (input.draftGraph && input.draftGraph.nodes.length > 0) {
      const preserved = input.draftGraph;

      return {
        output: {
          title: input.conversationTitle.slice(0, 50) || "当前架构",
          reply:
            "本次新增内容没有通过结构校验，已保留原有画布。可以补充约束后重试，或明确要求只生成数据库表/数据流。",
          nodes: preserved.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            label: node.label,
            description: node.description,
            table: node.table,
            layer: 0,
          })),
          edges: preserved.edges.map((edge) => ({
            from: edge.source,
            to: edge.target,
            label: edge.label,
            dataFlow: edge.dataFlow,
          })),
        },
        graph: preserved,
      };
    }

    /** 没有旧画布时才使用保底图。 */
    const output: ArchitectureOutputType = {
      title: "基础分层架构",
      reply:
        "当前模型输出未通过校验，先给出一个可用的基础分层架构；你可以继续补充约束，我会再调整。",
      nodes: fallbackGraph(constraints).nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        description: node.description,
        layer: 0,
      })),
      edges: [],
    };

    return { output, graph: fallbackGraph(constraints) };
  };

  private readonly reviewDesign = async (
    input: AgentInput,
    constraints: Constraints,
    graph: ArchitectureGraph,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<DesignReview | null> => {
    const client = this.client;

    if (!client) {
      return null;
    }

    const context = buildContext(
      constraints,
      input.citations,
      input.recentMessages,
      graph,
    );
    const completion = await client.chat.completions.create(
      {
        model: this.config.model,
        max_tokens: Math.min(this.config.maxTokens, 2048),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${DESIGN_REVIEW_PROMPT}\n\n${context}\n\n当前架构节点：${graph.nodes
              .map((node) => `${node.label}（${node.type}）`)
              .join("、")}`,
          },
        ],
        tools: [ASK_DESIGN_TOOL, FINISH_DESIGN_TOOL],
        tool_choice: "auto",
      },
      { signal: input.signal },
    );

    usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
    usage.outputTokens += completion.usage?.completion_tokens ?? 0;

    const call = completion.choices[0]?.message?.tool_calls?.find(
      (item) => item.type === "function" && item.function.name === "ask_design_card",
    );

    if (!call || call.type !== "function" || !call.function.arguments) {
      return null;
    }

    try {
      const review = DesignReviewSchema.parse(
        JSON.parse(call.function.arguments),
      );

      /** 模型偶尔会重复问已经确认的字段，直接收尾。 */
      if (constraints[review.field]) {
        return null;
      }

      return review;
    } catch {
      return null;
    }
  };

  private readonly streamReply = async function* (
    this: AgentEngine,
    input: AgentInput,
    graph: ArchitectureGraph,
    constraints: Constraints,
    fallback: string,
  ): AsyncGenerator<AgentEvent> {
    if (!this.client) {
      if (fallback) {
        yield { type: "text-delta", content: fallback };
      }

      return;
    }

    let emitted = "";

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: buildReplyPrompt(
                graph,
                input.citations,
                constraints,
              ),
            },
          ],
        },
        { signal: input.signal },
      );

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;

        if (content) {
          emitted += content;
          yield { type: "text-delta", content };
        }
      }
    } catch {
      if (input.signal.aborted) {
        return;
      }

      /** 流式失败时退回工具输出里的说明，避免空消息。 */
      if (!emitted && fallback) {
        yield { type: "text-delta", content: fallback };
      }

      return;
    }

    if (!emitted && fallback) {
      yield { type: "text-delta", content: fallback };
    }
  };

  private readonly emitUsage = function* (
    this: AgentEngine,
    usage: { inputTokens: number; outputTokens: number },
    startedAt: number,
  ): Generator<AgentEvent> {
    yield {
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: this.config.model,
      latencyMs: Date.now() - startedAt,
    };
  };

  private readonly mockOutput = (
    input: AgentInput,
    constraints: Constraints,
  ): ArchitectureOutputType => ({
    title: input.userMessage.slice(0, 20) || "基础分层架构",
    reply: `根据当前约束（${JSON.stringify(constraints)}），建议先采用分层单体：客户端经网关进入核心服务，数据落 PostgreSQL${
      constraints.scale ? "，并预留 Redis 缓存" : ""
    }。这个方案部署简单，后续可按领域拆分。`,
    nodes: fallbackGraph(constraints).nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      description: node.description,
      layer: 0,
    })),
    edges: [],
  });
}
