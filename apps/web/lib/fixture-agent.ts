import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import {
  GRAPH_REFERENCE_QUESTION,
  GRAPH_REFERENCE_READ_ONLY_MESSAGE,
  isCurrentGraphRequest,
  isHistoricalGraphRequest,
} from "@arch-flow/agent";
import {
  AGENT_CLARIFICATION_LIMIT,
  ERROR_CODES,
  GraphInput,
  type AgentIntent,
  type AgentTurnResult,
  type CardOption,
} from "@arch-flow/shared";
import { MockRunError } from "./mock-run-data";
import type { MockRunDriver } from "./mock-run-runtime";

const CHUNK_DELAY_MS = 450;
const GRAPH_REQUEST = /架构|图|画布|\b(?:diagram|graph|architecture)\b/iu;
const GRAPH_READ =
  /^(?:请|帮我|请帮我)?\s*(?:(?:只|仅)(?:想|需要)?\s*)?(?:解释|说明|介绍|怎么看|explain|describe)/i;
const CACHE_ADDITION =
  /^(?:请\s*)?(?:(?:帮我|给我)\s*)?(?:(?:给|为|在)\s*(?<target>.+?)\s*)?(?:添加|增加|加入|加上|接入|加)\s*(?:(?:一个|一层|个)\s*)?(?:Redis\s*)?(?:查询)?缓存(?:节点)?\s*吧?$/iu;
const READ_ONLY =
  /(?:只|仅)(?:想|需要)?(?:解释|说明)|(?:不要|不用|无需|请勿|别)(?:再|去)?(?:修改|改动|编辑|添加|增加|加上?|调整|接入)(?:当前)?(?:架构图|画布|缓存)|\b(?:do not|don't)\s+(?:edit|modify|change|add)\b/iu;
const CREATE_GRAPH =
  /^(?:(?:请\s*)?(?:帮我\s*)?(?:(?:给|为).+?)?(?:生成|画|绘制|设计|规划)|(?:please\s+)?(?:draw|generate|design)\b)/iu;
const GRAPH_EDIT =
  /^(?:请\s*)?(?:帮我\s*)?(?:修改|调整|改动|编辑|改一下|改图|更新)/u;
const PROJECT_SPEC =
  /^(?:请\s*)?(?:帮我\s*)?(?:按照|按|根据|遵循|参照|依照)[^，。！？；,.!?;]{0,48}?(?:规范|标准|文档|资料|知识库)[”」』》"]?\s*[，,:：]?\s*/u;
const GENERIC_SUBJECT =
  /^(?:给|为|帮|请|我|想|要|你|先|一个|一张|个|张|生成|设计|规划|画|绘制|输出|架构|流程|系统|图|方案|一下|吧|呢|[\s，。！？、,.!?])*$/u;
const DOMAINS = [
  "订单服务",
  "库存服务",
  "知识库问答",
  "购物商城",
  "结算中心",
  "支付服务",
  "任务调度",
  "内容管理",
  "用户服务",
];

const OPTIONS: CardOption[] = ["订单服务", "库存服务", "知识库问答"].map(
  (label) => ({
    label,
    value: label,
  }),
);

const pickSubject = (input: string) => {
  const common = DOMAINS.find((domain) => input.includes(domain));
  if (common) return common;
  if (GENERIC_SUBJECT.test(input)) return undefined;
  const label = input
    .replace(
      /^(?:请|帮我|请帮我)?\s*(?:给|为)?\s*(?:设计|生成|规划|画|绘制)?\s*/u,
      "",
    )
    .split(/(?:的)?(?:架构|流程图)|[,.!?，。！？]/u)[0]
    ?.trim();
  return label && !GENERIC_SUBJECT.test(label) ? label.slice(0, 22) : undefined;
};

const makeGraph = (subject: string) =>
  GraphInput.parse({
    nodes: [
      { id: "client", type: "client", label: "客户端" },
      { id: "gateway", type: "gateway", label: "API 网关" },
      { id: "service", type: "service", label: subject },
      { id: "database", type: "database", label: "业务数据库" },
    ],
    edges: [
      { id: "client-gateway", source: "client", target: "gateway" },
      { id: "gateway-service", source: "gateway", target: "service" },
      { id: "service-database", source: "service", target: "database" },
    ],
  });

const describeGraph = (graph: GraphInput, name: string) => {
  const labels = graph.nodes
    .slice(0, 5)
    .map(({ label }) => label)
    .join("、");
  const size = `${name}包含 ${graph.nodes.length} 个组件和 ${graph.edges.length} 条连接。`;
  const parts = [labels ? `${size}主要组件有${labels}。` : size];
  if (graph.edges.length) {
    const nodeLabels = new Map(graph.nodes.map(({ id, label }) => [id, label]));
    const connections = graph.edges
      .slice(0, 4)
      .map(
        ({ source, target }) =>
          `${nodeLabels.get(source)} → ${nodeLabels.get(target)}`,
      );
    parts.push(`\n\n图上的连接包括${connections.join("、")}。`);
  }
  return parts;
};

const serviceTarget = (name: string) =>
  name
    .trim()
    .replace(/(?:链路|路径|流程|接口)?[中里上]$/u, "")
    .replace(/的?(?:查询(?:链路|路径|流程|接口)?|链路|路径|流程|接口)$/u, "")
    .replace(/服务$/u, "");

const editQueryCache = (draft: GraphInput | null, target?: string) => {
  const services = draft?.nodes.filter(({ type }) => type === "service") ?? [];
  const targetName = target && serviceTarget(target);
  const candidates = target
    ? services.filter(
        ({ label }) =>
          label === target ||
          (targetName && serviceTarget(label) === targetName),
      )
    : services;
  const service = candidates.length === 1 ? candidates[0] : undefined;
  if (!draft || !service) {
    throw new MockRunError(
      422,
      ERROR_CODES.GRAPH_INVALID,
      "未能定位需要修改的查询服务。请先生成架构图，或在请求里指定图中的服务名称。",
    );
  }

  const connections = new Set(
    draft.edges
      .filter(({ source }) => source === service.id)
      .map(({ target }) => target),
  );
  const existing = draft.nodes.find(
    ({ id, type }) => type === "cache" && connections.has(id),
  );
  const database = draft.nodes.find(
    ({ id, type }) => type === "database" && connections.has(id),
  );
  const cache = existing ?? {
    id: randomUUID(),
    type: "cache",
    label: "查询缓存",
  };
  let graph: GraphInput | null = null;
  if (!existing) {
    const edited = GraphInput.safeParse({
      ...draft,
      nodes: [...draft.nodes, cache],
      edges: [
        ...draft.edges,
        { id: randomUUID(), source: service.id, target: cache.id },
      ],
    });
    if (!edited.success) {
      throw new MockRunError(
        422,
        ERROR_CODES.GRAPH_INVALID,
        "查询缓存无法写入当前画布，请检查图的结构或大小。",
      );
    }
    graph = edited.data;
  }

  const miss = database ? `未命中时读取${database.label}。` : "";
  return {
    graph,
    parts: [
      existing
        ? `查询链路已连接${cache.label}。`
        : "我在查询链路上补充了缓存节点。",
      `\n\n查询请求到达${service.label}后先访问${cache.label}。命中时直接返回。${miss}`,
    ],
  };
};

export const createFixtureAgent = (): MockRunDriver => ({
  clarificationOptions: ({ decision }) =>
    decision.intents.includes("generate_graph") ? OPTIONS : [],
  execute: async (
    turn,
    { signal, resume, onStage, onTextDelta },
  ): Promise<AgentTurnResult> => {
    const { input, draftGraph, referencedGraph, constraints } = turn;
    const answer = resume?.answer ?? "";
    const request = input.trim();
    const specification = PROJECT_SPEC.exec(request);
    const instruction = specification
      ? request.slice(specification[0].length)
      : request;
    const command =
      instruction.split(/[，。！、；,.!;\n]/u, 1)[0]?.trim() ?? "";
    const readOnly = READ_ONLY.test(request);
    const cacheAddition = readOnly ? null : CACHE_ADDITION.exec(command);
    const editRequested =
      cacheAddition !== null ||
      (!readOnly && Boolean(specification) && GRAPH_EDIT.test(command));
    const createRequested =
      !readOnly && GRAPH_REQUEST.test(command) && CREATE_GRAPH.test(command);
    const resumeGeneration =
      resume?.checkpoint.decision.intents.includes("generate_graph");
    const explain = Boolean(referencedGraph) || GRAPH_READ.test(command);
    const generate =
      !editRequested && !explain && (createRequested || resumeGeneration);
    const subject = generate
      ? answer.slice(0, 22) || pickSubject(input)
      : undefined;
    onStage("thinking");
    await wait(CHUNK_DELAY_MS, undefined, { signal });

    const clarify = (
      question: string,
      intent: AgentIntent,
    ): AgentTurnResult => {
      const attempts = (resume?.checkpoint.attempts ?? 0) + 1;
      if (attempts > AGENT_CLARIFICATION_LIMIT) {
        return {
          status: "succeeded",
          text: question,
          constraints,
          citations: [],
          graph: null,
        };
      }
      return {
        status: "waiting_input",
        text: question,
        constraints,
        checkpoint: {
          attempts,
          question,
          decision: {
            intents: [intent],
            rewrittenInput: input,
            complexity: "simple",
            question,
            constraintUpdates: {},
          },
        },
      };
    };

    const historical =
      resume?.checkpoint.question === GRAPH_REFERENCE_QUESTION ||
      isHistoricalGraphRequest(input) ||
      isHistoricalGraphRequest(answer);
    if (!referencedGraph && historical) {
      return clarify(GRAPH_REFERENCE_QUESTION, "explain_graph");
    }
    if (
      referencedGraph &&
      (editRequested ||
        createRequested ||
        isCurrentGraphRequest(input) ||
        isCurrentGraphRequest(answer))
    ) {
      throw new MockRunError(
        400,
        ERROR_CODES.AGENT_GRAPH_REFERENCE_READ_ONLY,
        GRAPH_REFERENCE_READ_ONLY_MESSAGE,
      );
    }

    if (generate && !subject) {
      return clarify("你想为哪个系统绘制架构图？", "generate_graph");
    }
    if ((editRequested || generate) && specification) {
      onStage("searching_knowledge");
      throw new MockRunError(
        422,
        ERROR_CODES.AGENT_KNOWLEDGE_REQUIRED,
        "查找项目资料时没有找到所需规范。改图和后续解释暂未完成。",
      );
    }

    let graph: GraphInput | null = null;
    let parts: string[];
    const graphForAnswer = referencedGraph?.graph ?? draftGraph;
    if (cacheAddition) {
      onStage("drafting_graph");
      ({ graph, parts } = editQueryCache(
        draftGraph,
        cacheAddition.groups?.target,
      ));
    } else if (generate && subject) {
      onStage("drafting_graph");
      graph = makeGraph(subject);
      parts = [
        `先把${subject}分成接入、业务处理和数据存储三部分。`,
        "\n\n请求从客户端进入 API 网关，鉴权后由业务服务处理。业务服务集中处理规则与状态，持久化结果由数据层负责。",
        "\n\n优先验证请求失败时的重试和重复提交行为。建议给写操作设置幂等键，并为依赖超时配置明确的错误返回。",
      ];
    } else if (explain && graphForAnswer) {
      parts = describeGraph(
        graphForAnswer,
        referencedGraph ? "所选历史图" : "当前画布",
      );
    } else {
      parts = [
        "可以先明确请求入口、业务职责与数据归属，再检查组件之间的依赖。",
        "\n\n可以用一个典型请求串起整个流程：入口校验身份，业务节点处理规则，数据层保存状态。",
        "\n\n逐一检查超时、重复请求与依赖暂时不可用的情况，确定每一步该如何恢复。",
      ];
    }

    for (const part of parts) {
      await wait(CHUNK_DELAY_MS, undefined, { signal });
      await onTextDelta(part);
    }
    await wait(CHUNK_DELAY_MS, undefined, { signal });
    onStage("finalizing");
    return {
      status: "succeeded",
      text: parts.join(""),
      constraints:
        subject && generate
          ? { ...constraints, projectGoal: subject }
          : constraints,
      citations: [],
      graph,
    };
  },
  generateExtras: async ({ userInput, includeTitle }) => ({
    title: includeTitle ? userInput.slice(0, 28) : null,
    suggestedQuestions: ["关键链路有哪些失败场景？", "如何验证这套架构？"],
  }),
});
