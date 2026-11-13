import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type CreateProjectInput,
  type FileBrief,
  type Page,
  type Project,
  type ProjectNode,
  type UpdateProjectInput,
} from "@arch-flow/shared";
import {
  AssetEntity,
  ConversationEntity,
  KnowledgeFileEntity,
  ProjectEntity,
} from "@arch-flow/db";
import type { SelectQueryBuilder } from "typeorm";
import { apiError } from "../../common/api-error.js";
import type { AuthUser } from "../../common/request-context.js";
import { DatabaseService } from "../../database/database.service.js";
import { decodeCursor, encodeCursor } from "../../common/pagination.js";

const NESTED_LIMIT = 20;

const toProject = (project: ProjectEntity): Project => ({
  id: project.uuid,
  name: project.projectName,
  description: project.description,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString(),
});

@Injectable()
export class ProjectService {
  constructor(private readonly database: DatabaseService) {}

  private readonly repository = () =>
    this.database.dataSource.getRepository(ProjectEntity);

  list = async (
    user: AuthUser,
    limit: number,
    cursor?: string,
  ): Promise<Page<ProjectNode>> => {
    const query = this.repository()
      .createQueryBuilder("project")
      .where("project.userId = :userId", { userId: user.internalId })
      .orderBy("project.updatedAt", "DESC")
      .addOrderBy("project.id", "DESC")
      .take(limit + 1);

    this.applyCursor(query, cursor);

    const records = await query.getMany();
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const items = await Promise.all(page.map((project) => this.toNode(project)));
    const last = page.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
      hasMore,
    };
  };

  create = async (
    user: AuthUser,
    input: CreateProjectInput,
  ): Promise<Project> => {
    const project = this.repository().create({
      userId: user.internalId,
      projectName: input.name,
      description: input.description ?? null,
    });

    await this.repository().save(project);

    return toProject(project);
  };

  get = async (user: AuthUser, projectUuid: string): Promise<Project> =>
    toProject(await this.requireEntity(user, projectUuid));

  update = async (
    user: AuthUser,
    projectUuid: string,
    input: UpdateProjectInput,
  ): Promise<Project> => {
    const project = await this.requireEntity(user, projectUuid);

    if (input.name !== undefined) {
      project.projectName = input.name;
    }

    if (input.description !== undefined) {
      project.description = input.description;
    }

    await this.repository().save(project);

    return toProject(project);
  };

  remove = async (user: AuthUser, projectUuid: string): Promise<void> => {
    const project = await this.requireEntity(user, projectUuid);
    await this.repository().remove(project);
  };

  /** 供其他模块校验项目归属；返回内部实体（含 id）。 */
  requireEntity = async (
    user: AuthUser,
    projectUuid: string,
  ): Promise<ProjectEntity> => {
    const project = await this.repository().findOneBy({
      uuid: projectUuid,
      userId: user.internalId,
    });

    if (!project) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.PROJECT_NOT_FOUND,
        "项目不存在",
      );
    }

    return project;
  };

  /** 按内部 id 校验归属；供会话 / 文件 / 资产模块使用。 */
  requireById = async (
    user: AuthUser,
    projectId: string,
  ): Promise<ProjectEntity> => {
    const project = await this.repository().findOneBy({
      id: projectId,
      userId: user.internalId,
    });

    if (!project) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.PROJECT_NOT_FOUND,
        "项目不存在",
      );
    }

    return project;
  };

  private readonly toNode = async (
    project: ProjectEntity,
  ): Promise<ProjectNode> => {
    const [files, assets, conversations] = await Promise.all([
      this.database.dataSource.getRepository(KnowledgeFileEntity).find({
        where: { projectId: project.id },
        order: { createdAt: "DESC" },
        take: NESTED_LIMIT,
      }),
      this.database.dataSource.getRepository(AssetEntity).find({
        where: { projectId: project.id },
        order: { updatedAt: "DESC" },
        take: NESTED_LIMIT,
      }),
      this.database.dataSource.getRepository(ConversationEntity).find({
        where: { projectId: project.id },
        order: { updatedAt: "DESC" },
        take: NESTED_LIMIT,
      }),
    ]);

    const fileBriefs: FileBrief[] = files.map((file) => ({
      id: file.uuid,
      fileName: file.fileName,
      fileType: file.fileType as FileBrief["fileType"],
      status: file.status as FileBrief["status"],
      createdAt: file.createdAt.toISOString(),
    }));

    return {
      ...toProject(project),
      lastActiveConversationId: conversations[0]?.uuid ?? null,
      files: fileBriefs,
      assets: assets.map((asset) => ({
        id: asset.uuid,
        name: asset.name,
        createdAt: asset.createdAt.toISOString(),
      })),
      conversations: conversations.map((conversation) => ({
        id: conversation.uuid,
        title: conversation.title,
        updatedAt: conversation.updatedAt.toISOString(),
      })),
    };
  };

  private readonly applyCursor = (
    query: SelectQueryBuilder<ProjectEntity>,
    cursor?: string,
  ): void => {
    if (!cursor) {
      return;
    }

    const decoded = decodeCursor(cursor);

    if (!decoded) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_FAILED,
        "分页游标不合法",
      );
    }

    query.andWhere(
      "(project.updatedAt, project.id) < (:cursorUpdatedAt, :cursorId)",
      {
        cursorUpdatedAt: decoded.updatedAt,
        cursorId: decoded.id,
      },
    );
  };
}
