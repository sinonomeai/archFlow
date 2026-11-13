import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 画布布局：每个会话一行，存节点坐标和独立版本号。
 * 语义图仍存 conversations.current_draft_graph；这里只存视图布局。
 */
@Entity({ name: "conversation_canvas_layouts" })
export class ConversationCanvasLayoutEntity {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "conversation_id", type: "bigint", unique: true })
  conversationId!: string;

  @Column({ name: "layout_data", type: "jsonb", default: () => `'{"nodes":{}}'` })
  layoutData!: Record<string, unknown>;

  /** 独立乐观锁版本号；不占用 conversations.draft_version。 */
  @Column({ type: "int", default: 0 })
  version!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
