import type { Citation } from "@arch-flow/shared";
import type { ArchitectureGraph, Constraints } from "../schemas.js";

/**
 * 最终回答提示词：在约束和技术选型都确认后，输出可落地的详细设计说明。
 * 图只负责组件/部署单元，表、接口、路由、运维细节放在文字里。
 */
export const buildReplyPrompt = (
  graph: ArchitectureGraph,
  citations: Citation[],
  constraints: Constraints,
): string => {
  const nodes = graph.nodes
    .map((node) => `${node.label}（${node.type}）`)
    .join("、");
  const constraintText =
    Object.keys(constraints).length > 0
      ? JSON.stringify(constraints, null, 2)
      : "暂无结构化约束";

  return `请用简体中文输出一份“可落地的详细设计说明”，解释这套架构如何满足已收集的约束。

已收集约束：
${constraintText}

架构节点：${nodes}

输出结构（使用纯文本小标题，不要用 Markdown 的 #、代码块或表格）：

【技术栈】
- 前端、后端、数据库、缓存/队列/对象存储分别用什么；说明与团队规模和预算的关系。

【认证与授权】
- 登录方式、Token/会话策略、角色与权限模型；说明哪些接口需要什么权限。

【数据模型与表设计】
- 列出 3-6 张核心表（表名 + 关键字段 + 与其他表的关系），不要写完整 DDL。
- 明确哪些字段用于审计、软删除或版本控制。

【接口与路由】
- 列出 6-12 个核心接口：方法 + 路径 + 用途；按业务领域组织，带 /api/v1 版本前缀。
- 列出前端主要页面路由，以及每个页面依赖的接口。

【部署与运维】
- 部署单元、数据库/缓存/对象存储的托管方式、日志与监控、备份与发布方式。
- 说明 1-3 人团队实际能维护到什么程度。

【权衡与下一步】
- 说明成本、复杂度、可维护性、扩展性上的主要代价。
- 如果还有未确认项，只写纯实现细节；影响结构的必须已经在卡片中确认，不要建议“以后再问”或“后续用卡片补齐”。

写作要求：
- 约束里已有的技术选型必须遵守；没有确认的地方按最保守方案给出草案，并明确标注“假设”。
- 不要编造部署实测、压测或成本数据；不要编造知识库来源。
- 不要逐节点念清单；图和文字各司其职。
- 篇幅以能指导实现为准，通常 6-10 段。

${
  citations.length > 0
    ? `可引用的知识库片段：\n${citations
        .map((citation) => `- [${citation.fileName}] ${citation.snippet}`)
        .join("\n")}`
    : "没有可引用的知识库片段，不要编造来源。"
}`;
};
