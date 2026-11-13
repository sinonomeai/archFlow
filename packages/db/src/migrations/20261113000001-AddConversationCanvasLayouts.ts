import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * P2-15：画布布局与语义图分离。
 * 每个会话一行，存节点坐标和独立版本号；删除会话时级联删除。
 */
export class AddConversationCanvasLayouts20261113000001
  implements MigrationInterface
{
  name = "AddConversationCanvasLayouts20261113000001";

  up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      CREATE TABLE "conversation_canvas_layouts" (
        "id" BIGSERIAL NOT NULL,
        "conversation_id" BIGINT NOT NULL,
        "layout_data" JSONB NOT NULL DEFAULT '{"nodes":{}}'::jsonb,
        "version" INT NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_canvas_layouts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conversation_canvas_layouts_conversation" UNIQUE ("conversation_id"),
        CONSTRAINT "FK_conversation_canvas_layouts_conversation"
          FOREIGN KEY ("conversation_id")
          REFERENCES "conversations" ("id") ON DELETE CASCADE
      );
    `);
  };

  down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_canvas_layouts";`);
  };
}
