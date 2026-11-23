import {
  AGENT_CLARIFICATION_LIMIT,
  AgentExtras,
  AgentExtrasInput,
  AgentPlan,
  AgentResume,
  AgentTaskResult,
  AgentTurn,
  Citation,
  ERROR_CODES,
  type AgentConstraintKey,
  type AgentDecision,
  type AgentTask,
  type AgentTurnResult,
  type Graph,
} from "@arch-flow/shared";
import { z } from "zod";
import {
  GRAPH_REFERENCE_QUESTION,
  GRAPH_REFERENCE_READ_ONLY_MESSAGE,
  isCurrentGraphRequest,
  isHistoricalGraphRequest,
} from "./graph-reference.js";
import {
  AgentExecutionError,
  type AgentExecutionOptions,
  type CreateAgentEngineOptions,
} from "./ports.js";
import { createIntentRouter, parseAgentDecision } from "./router.js";
import { applyGraphPatch, mergeConstraints, validateGraph } from "./state.js";

const NO_EVIDENCE =
  "当前项目没有检索到可引用的资料。你可以上传并解析相关文档后再试。";
const EXPLANATION_PENDING = "依赖新版的解释未完成。";
const MIN_EXPLANATION_RETRY_BUDGET_MS = 1_000;
const EVIDENCE_BASIS_PREFIX =
  /(?:^|[，,。；;？！?!\n])\s*(?:(?:请|帮我|先|再|然后)\s*){0,3}((?:按照?|根据|基于|依据|遵循|参照)\s*)/gu;
const SOURCE_AND_GRAPH_WRITE =
  /^(?:《[^》\n]{1,32}》|[^，,。；;？！?!\n]{0,26}?(?:规范|标准|文档|资料|知识库|附件)[」”"]?)\s*[，,]?\s*(?:先\s*)?(?:(?:给|为|对)[^，,。；;？！?!\n]{1,24}?)?(?:修改|改图|调整|更新|添加|增加|接入|删除|替换|加|生成|创建|绘制|重画|画)[^，,。；;？！?!\n]*/u;
const CONSTRAINT_LABELS: Record<AgentConstraintKey, string> = {
  projectGoal: "项目目标",
  usersAndScale: "用户与规模",
  teamAndBudget: "团队与预算",
  technology: "技术选型",
  deployment: "部署方式",
  requirements: "项目需求",
};

const usesCanvas = (intent: AgentTask["intent"]) =>
  intent === "edit_graph" || intent === "explain_graph";

const writesCanvas = (intent: AgentTask["intent"]) =>
  intent === "edit_graph" || intent === "generate_graph";

const activeGraph = (turn: AgentTurn) =>
  turn.referencedGraph?.graph ?? turn.draftGraph;

const getExplicitGraphEvidenceQuery = (input: string): string | undefined => {
  for (const prefix of input.matchAll(EVIDENCE_BASIS_PREFIX)) {
    const sourceAndWrite = SOURCE_AND_GRAPH_WRITE.exec(
      input.slice(prefix.index + prefix[0].length),
    );
    if (sourceAndWrite) return `${prefix[1]}${sourceAndWrite[0]}`.trim();
  }
  return undefined;
};

const needsCandidateExplanation = (input: string): boolean =>
  /(?:修改|改图|调整|更新|添加|加上|删除|替换|生成)[^。？！]{0,80}(?:然后|再|接着|随后|最后)\s*(?:解释|说明|讲解|讲讲|说说)|(?:解释|说明|讲解)[^，。；]{0,18}(?:改[完好后]|修改后|更新后|生成后)|\b(?:then explain|explain (?:the )?(?:updated|modified|new))\b/iu.test(
    input,
  ) ||
  /(?:并|再|然后|接着|随后|最后|[，,])\s*(?:解释|说明|讲解|讲讲|说说)[^，,。；;？！?!\n]{0,12}新(?:版|方案|架构|流程|画布|图)/u.test(
    input,
  );

const asksToExplainInitialGraph = (input: string): boolean =>
  /(?:先|首先)\s*(?:解释|说明|讲解|讲讲|说说)(?:一下)?\s*(?:当前|现有|原有|修改前)[^，,。；;？！?!\n]{0,12}(?:架构|画布|图|方案|流程)/u.test(
    input,
  ) ||
  /\bfirst\s+(?:explain|describe)\s+(?:the\s+)?(?:current|existing|original)\b/iu.test(
    input,
  );

const isTaskTimeout = (error: unknown): boolean =>
  (error instanceof AgentExecutionError &&
    error.code === ERROR_CODES.AGENT_TASK_TIMEOUT) ||
  (error instanceof DOMException && error.name === "TimeoutError");

const clarify = (
  turn: AgentTurn,
  decision: AgentDecision,
  conflictKey?: AgentConstraintKey,
) => {
  if (conflictKey) {
    const current = turn.constraints[conflictKey];
    const next = decision.constraintUpdates[conflictKey];
    return `已记录的${CONSTRAINT_LABELS[conflictKey]}是「${current?.slice(0, 140)}」，这次提到「${next?.slice(0, 140)}」。请确认采用哪一项。`;
  }
  if (decision.question) return decision.question;
  if (decision.intents.length === 0)
    return "你希望我生成、修改、解释架构图，还是回答一个项目问题？";
  if (
    decision.intents.includes("generate_graph") &&
    !turn.constraints.projectGoal
  ) {
    return "这张架构图要描述什么项目？请告诉我它的目标或主要功能。";
  }
  if (
    !activeGraph(turn)?.nodes.length &&
    decision.intents.some(usesCanvas) &&
    !decision.intents.includes("generate_graph")
  ) {
    return "当前画布是空的。你可以打开已有架构图，或告诉我想先生成什么系统的架构图。";
  }
  return null;
};

const validatePlan = (
  output: unknown,
  turn: AgentTurn,
  decision: AgentDecision,
  latestInput: string,
): AgentTask[] => {
  const error = new AgentExecutionError(
    "AGENT_INVALID_PLAN",
    "暂时无法安排这个任务，请补充目标或尝试拆分请求。",
  );
  const plan = AgentPlan.safeParse(output);
  if (!plan.success) throw error;

  const requested = new Set(decision.intents);
  const covered = new Set<AgentTask["intent"]>();
  const combinesWriteAndExplanation =
    decision.intents.some(writesCanvas) && requested.has("explain_graph");
  const explainCandidate =
    combinesWriteAndExplanation &&
    [turn.input, latestInput, decision.rewrittenInput].some(
      needsCandidateExplanation,
    );
  const explainInitial =
    combinesWriteAndExplanation &&
    [turn.input, latestInput].some(asksToExplainInitialGraph);
  let hasGraph = Boolean(activeGraph(turn)?.nodes.length);
  let hasGeneration = false;
  let hasGraphWrite = false;
  let explainedInitial = false;
  let explainedAfterLastWrite = false;

  for (const { intent } of plan.data.tasks) {
    if (intent !== "query_knowledge" && !requested.has(intent)) throw error;
    if (usesCanvas(intent) && !hasGraph) throw error;
    if (intent === "generate_graph") {
      if (hasGeneration || covered.has("edit_graph")) throw error;
      hasGraph = true;
      hasGeneration = true;
    }
    if (writesCanvas(intent)) {
      hasGraphWrite = true;
      explainedAfterLastWrite = false;
    }
    if (intent === "explain_graph") {
      if (hasGraphWrite) {
        explainedAfterLastWrite = true;
      } else {
        if (explainCandidate && !explainInitial) throw error;
        explainedInitial = true;
      }
    }
    covered.add(intent);
  }
  if (explainInitial && !explainedInitial) throw error;
  if (explainCandidate && !explainedAfterLastWrite) throw error;
  if (decision.intents.some((intent) => !covered.has(intent))) throw error;
  return plan.data.tasks;
};

const taskGraph = (
  intent: AgentTask["intent"],
  output: AgentTaskResult,
  current: Graph | null,
) => {
  if (
    intent === "generate_graph" &&
    output.graph?.nodes.length &&
    !output.patch
  )
    return validateGraph(output.graph);
  if (intent === "edit_graph" && current && output.patch && !output.graph)
    return applyGraphPatch(current, output.patch);
  if (
    intent !== "generate_graph" &&
    intent !== "edit_graph" &&
    !output.graph &&
    !output.patch
  )
    return null;
  throw new AgentExecutionError(
    "GRAPH_INVALID",
    "模型返回了不符合任务要求的图，草稿未更新。",
  );
};

export const createAgentEngine = (options: CreateAgentEngineOptions) => {
  const { model, searchKnowledge, onRoute } = options;
  const route = createIntentRouter(options);

  const execute = async (
    input: AgentTurn,
    {
      resume,
      signal,
      deadlineAt,
      onStage,
      onTextDelta,
    }: AgentExecutionOptions = {},
  ): Promise<AgentTurnResult> => {
    const turn = AgentTurn.parse(input);
    const continuation = resume && AgentResume.parse(resume);
    signal?.throwIfAborted();
    onStage?.("thinking");

    const chosenReference = turn.referencedGraph;
    const latestInput = continuation?.answer ?? turn.input;
    if (
      chosenReference &&
      (isCurrentGraphRequest(turn.input) || isCurrentGraphRequest(latestInput))
    )
      throw new AgentExecutionError(
        ERROR_CODES.AGENT_GRAPH_REFERENCE_READ_ONLY,
        GRAPH_REFERENCE_READ_ONLY_MESSAGE,
      );

    const needsReference =
      !chosenReference &&
      (continuation?.checkpoint.question === GRAPH_REFERENCE_QUESTION ||
        isHistoricalGraphRequest(turn.input) ||
        isHistoricalGraphRequest(latestInput));
    let source: Awaited<ReturnType<typeof route>>["source"] | "resume";
    let decision: AgentDecision;
    let confirmedKey: AgentConstraintKey | undefined;
    if (needsReference) {
      source = continuation ? "resume" : "rule";
      decision = continuation?.checkpoint.decision ?? {
        intents: [],
        rewrittenInput: turn.input,
        complexity: "simple",
        question: GRAPH_REFERENCE_QUESTION,
        constraintUpdates: {},
      };
    } else if (continuation) {
      source = "resume";
      const { checkpoint } = continuation;
      const resolved = parseAgentDecision(
        await model.resolveClarification({ turn, ...continuation }, signal),
      );
      decision = {
        ...resolved,
        knowledgeDependentIntents:
          resolved.knowledgeDependentIntents ??
          checkpoint.decision.knowledgeDependentIntents,
      };
      const key = checkpoint.conflictKey;
      if (key) {
        const choice = resolved.constraintUpdates[key];
        if (choice !== undefined && resolved.question === null)
          confirmedKey = key;
        // Keep the original proposal pending until the answer resolves this conflict.
        const constraintUpdates = {
          ...checkpoint.decision.constraintUpdates,
          ...resolved.constraintUpdates,
        };
        const pending = checkpoint.decision.constraintUpdates[key];
        if (!confirmedKey && pending !== undefined)
          constraintUpdates[key] = pending;
        decision = { ...decision, constraintUpdates };
      }
    } else {
      ({ source, decision } = await route(turn, signal));
    }
    signal?.throwIfAborted();

    if (chosenReference) {
      if (decision.intents.some(writesCanvas))
        throw new AgentExecutionError(
          ERROR_CODES.AGENT_GRAPH_REFERENCE_READ_ONLY,
          GRAPH_REFERENCE_READ_ONLY_MESSAGE,
        );
      const bindToReference = (intents: AgentDecision["intents"]) => [
        ...new Set(
          intents.map((intent) =>
            intent === "general_chat" ? "explain_graph" : intent,
          ),
        ),
      ];
      decision = {
        ...decision,
        intents: bindToReference(decision.intents),
        question:
          decision.question === GRAPH_REFERENCE_QUESTION
            ? null
            : decision.question,
        knowledgeDependentIntents:
          decision.knowledgeDependentIntents &&
          bindToReference(decision.knowledgeDependentIntents),
      };
    }

    const { constraints, conflictKey } = mergeConstraints(
      turn.constraints,
      decision.constraintUpdates,
      confirmedKey,
    );
    const context = { ...turn, constraints };
    const question = needsReference
      ? GRAPH_REFERENCE_QUESTION
      : clarify(context, decision, conflictKey);

    if (question) {
      onRoute?.({ source, strategy: "clarify", intents: decision.intents });
      const attempts = (continuation?.checkpoint.attempts ?? 0) + 1;
      if (attempts > AGENT_CLARIFICATION_LIMIT) {
        return {
          status: "succeeded",
          text: `还需要更多信息才能继续。${question}`,
          constraints,
          citations: [],
          graph: null,
        };
      }
      return {
        status: "waiting_input",
        checkpoint: { decision, question, attempts, conflictKey },
        constraints,
        text: question,
      };
    }

    const [singleIntent] = decision.intents;
    const direct =
      singleIntent &&
      decision.intents.length === 1 &&
      decision.complexity === "simple";
    onRoute?.({
      source,
      strategy: direct ? "direct" : "planned",
      intents: decision.intents,
    });
    const tasks: AgentTask[] = direct
      ? [
          {
            intent: singleIntent,
            instruction: decision.rewrittenInput,
            requiresKnowledge: singleIntent === "query_knowledge",
          },
        ]
      : validatePlan(
          await model.plan({ turn: context, decision }, signal),
          context,
          decision,
          latestInput,
        );

    const explicitGraphEvidenceQuery =
      (continuation && getExplicitGraphEvidenceQuery(continuation.answer)) ??
      getExplicitGraphEvidenceQuery(turn.input);
    let graph: Graph | null = null;
    let workingGraph = context.draftGraph;
    let explanationRetried = false;
    const evidenceByQuery = new Map<string, Citation[]>();
    const priorResults: string[] = [];
    const citations = new Map<string, Citation>();
    const appendResult = async (text: string, streamed = "") => {
      signal?.throwIfAborted();
      const separator = priorResults.length && !streamed ? "\n\n" : "";
      priorResults.push(text);
      if (!text.startsWith(streamed)) {
        await onTextDelta?.(priorResults.join("\n\n"), true);
      } else if (text.length > streamed.length) {
        await onTextDelta?.(separator + text.slice(streamed.length));
      }
    };

    for (const [index, task] of tasks.entries()) {
      signal?.throwIfAborted();
      // Downstream tasks must not mistake the old draft for the requested new graph.
      if (task.intent === "generate_graph") workingGraph = null;
      const isLookup = task.intent === "query_knowledge";
      const writesGraph = writesCanvas(task.intent);
      const explanationPending =
        writesGraph &&
        tasks.slice(index + 1).some(({ intent }) => intent === "explain_graph");
      const requiredGraphQuery = writesGraph
        ? explicitGraphEvidenceQuery
        : undefined;
      const requiresKnowledge =
        task.requiresKnowledge ||
        decision.knowledgeDependentIntents?.includes(task.intent) ||
        requiredGraphQuery !== undefined;
      let evidence: Citation[] = [];
      if (isLookup || requiresKnowledge) {
        const query = requiredGraphQuery ?? task.instruction;
        const cached = evidenceByQuery.get(query);
        if (cached) {
          evidence = cached;
        } else {
          onStage?.("searching_knowledge");
          const sources =
            (await searchKnowledge?.(
              {
                projectId: turn.projectId,
                attachments: turn.attachments,
                query,
              },
              signal,
            )) ?? [];
          evidence = z.array(Citation).parse(sources);
          evidenceByQuery.set(query, evidence);
        }
      }
      if ((isLookup || requiresKnowledge) && evidence.length === 0) {
        if (!isLookup) {
          const blocked = writesGraph
            ? "架构图操作未执行，草稿未更新。"
            : "需要资料的任务未执行。";
          throw new AgentExecutionError(
            ERROR_CODES.AGENT_KNOWLEDGE_REQUIRED,
            `${blocked}${explanationPending ? EXPLANATION_PENDING : ""}${NO_EVIDENCE}`,
          );
        }
        if (!priorResults.includes(NO_EVIDENCE))
          await appendResult(NO_EVIDENCE);
        continue;
      }

      const taskTurn = { ...context, draftGraph: workingGraph };
      if (usesCanvas(task.intent) && !activeGraph(taskTurn)?.nodes.length)
        throw new AgentExecutionError(
          ERROR_CODES.GRAPH_INVALID,
          "本轮没有可供解释的有效架构图，草稿未更新。请检查节点后重试。",
        );
      if (writesGraph) onStage?.("drafting_graph");
      let published = "";
      let sinkFailed = false;
      const performTask = async () => {
        let received = "";
        const separator = priorResults.length ? "\n\n" : "";
        const emit =
          onTextDelta && !writesGraph
            ? async (delta: string) => {
                signal?.throwIfAborted();
                received += delta;
                if (published.startsWith(received)) return;
                try {
                  if (received.startsWith(published)) {
                    await onTextDelta(
                      (published ? "" : separator) +
                        received.slice(published.length),
                    );
                  } else {
                    await onTextDelta(
                      priorResults.join("\n\n") + separator + received,
                      true,
                    );
                  }
                  published = received;
                } catch (error) {
                  sinkFailed = true;
                  throw error;
                }
              }
            : undefined;
        const output = AgentTaskResult.safeParse(
          await model.executeTask(
            {
              turn: taskTurn,
              decision,
              task,
              evidence,
              priorResults: [...priorResults],
            },
            signal,
            emit,
          ),
        );
        signal?.throwIfAborted();
        if (!output.success)
          throw new AgentExecutionError(
            "AGENT_INVALID_RESULT",
            "模型返回的任务结果无法读取。",
          );
        return {
          text: output.data.text,
          nextGraph: taskGraph(task.intent, output.data, workingGraph),
        };
      };

      let result: Awaited<ReturnType<typeof performTask>>;
      for (;;) {
        try {
          result = await performTask();
          break;
        } catch (error) {
          signal?.throwIfAborted();
          if (sinkFailed) throw error;
          if (explanationPending) {
            const code =
              error instanceof AgentExecutionError
                ? error.code
                : ERROR_CODES.SERVICE_UNAVAILABLE;
            const failure = task.intent === "edit_graph" ? "修改" : "生成";
            throw new AgentExecutionError(
              code,
              `架构图${failure}失败，草稿未更新。${EXPLANATION_PENDING}请检查要求后重试。`,
              { cause: error },
            );
          }
          if (task.intent !== "explain_graph" || !isTaskTimeout(error))
            throw error;
          const hasRetryTime =
            deadlineAt === undefined ||
            deadlineAt - Date.now() >= MIN_EXPLANATION_RETRY_BUDGET_MS;
          if (!graph || explanationRetried || !hasRetryTime)
            throw new AgentExecutionError(
              ERROR_CODES.AGENT_TASK_TIMEOUT,
              "架构图解释超时，草稿未更新。请重试。",
              { cause: error },
            );
          explanationRetried = true;
        }
      }
      const { nextGraph, text } = result;
      if (nextGraph) {
        workingGraph = nextGraph;
        graph = nextGraph;
      }
      for (const citation of evidence)
        citations.set(
          JSON.stringify([citation.fileId, citation.snippet]),
          citation,
        );
      await appendResult(text, published);
    }

    signal?.throwIfAborted();
    onStage?.("finalizing");
    return {
      status: "succeeded",
      text: priorResults.join("\n\n"),
      constraints,
      citations: [...citations.values()],
      graph,
    };
  };

  const generateExtras = async (
    input: AgentExtrasInput,
    signal?: AbortSignal,
  ) => {
    const request = AgentExtrasInput.parse(input);
    const result = AgentExtras.parse(
      await model.generateExtras(request, signal),
    );
    return {
      title: request.includeTitle ? result.title : null,
      suggestedQuestions: [...new Set(result.suggestedQuestions)],
    };
  };

  return { execute, generateExtras };
};
