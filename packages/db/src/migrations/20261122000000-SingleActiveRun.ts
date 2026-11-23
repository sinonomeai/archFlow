import type { MigrationInterface, QueryRunner } from "typeorm";

export class SingleActiveRun20261122000000 implements MigrationInterface {
  name = "SingleActiveRun20261122000000";

  up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_runs_conversation_active" ON "runs" ("conversation_id")
        WHERE "status" IN ('queued', 'running', 'waiting_input');
    `);
  };

  down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query('DROP INDEX "UQ_runs_conversation_active"');
  };
}
