import { z } from "zod";
import { DataFlow, Graph, NodeType, TableSchema } from "@arch-flow/shared";

/** 约束：只保留可结构化复用的字段；未知字段透传，便于后续扩展。 */
export const ConstraintsSchema = z
  .object({
    teamSize: z.string().max(100).optional(),
    deployTarget: z.string().max(100).optional(),
    scale: z.string().max(100).optional(),
    budget: z.string().max(100).optional(),
    techStack: z.string().max(200).optional(),
    dataVolume: z.string().max(100).optional(),
    availability: z.string().max(100).optional(),
    /** 版权 / 付费 / 内容合规要求。 */
    compliance: z.string().max(200).optional(),
    /** 第三方音源接入方式：服务端代理、客户端直连、只做元数据转换。 */
    integration: z.string().max(200).optional(),
    /** 认证与授权模型，如 JWT + RBAC。 */
    authModel: z.string().max(200).optional(),
    /** 数据库选型。 */
    database: z.string().max(100).optional(),
    /** 接口风格：REST / GraphQL / tRPC。 */
    apiStyle: z.string().max(100).optional(),
    /** 前后端路由/页面结构的偏好。 */
    routingPreference: z.string().max(200).optional(),
  })
  .catchall(z.unknown());
export type Constraints = z.infer<typeof ConstraintsSchema>;

/** 模型输出：只给逻辑层级，坐标 / 布局由前端 Dagre 计算。 */
export const GeneratedNode = z.object({
  id: z.string().min(1).max(64),
  type: NodeType,
  label: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  /** type = table 时必填：表名与字段。 */
  table: TableSchema.optional(),
  layer: z.number().int().min(0).max(6),
});
export type GeneratedNode = z.infer<typeof GeneratedNode>;

export const GeneratedEdge = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  label: z.string().max(30).optional(),
  dataFlow: DataFlow.optional(),
});
export type GeneratedEdge = z.infer<typeof GeneratedEdge>;

export const ArchitectureOutput = z.object({
  title: z.string().min(1).max(50),
  reply: z.string().min(1).max(8000),
  nodes: z.array(GeneratedNode).min(3).max(20),
  edges: z.array(GeneratedEdge).max(40),
});
export type ArchitectureOutput = z.infer<typeof ArchitectureOutput>;

/** 对外图契约直接复用 shared 的 Graph（strict，无坐标）。 */
export const ArchitectureGraph = Graph;
export type ArchitectureGraph = z.infer<typeof ArchitectureGraph>;

/** 约束提取工具的返回结构：只输出缺失 / 变化字段。 */
export const ExtractedConstraints = ConstraintsSchema.partial();
