import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type Asset,
  type AssetDetail,
  type AssetInput,
  type AssetMeta,
  type AssetUpdateInput,
  type Graph,
  type Page,
} from "@arch-flow/shared";
import { AssetEntity } from "@arch-flow/db";
import { apiError } from "../../common/api-error.js";
import {
  decodeCursor,
  encodeCursor,
} from "../../common/pagination.js";
import type { AuthUser } from "../../common/request-context.js";
import { DatabaseService } from "../../database/database.service.js";
import { ProjectService } from "../project/project.service.js";

const toMeta = (asset: AssetEntity): AssetMeta => ({
  id: asset.uuid,
  name: asset.name,
  createdAt: asset.createdAt.toISOString(),
  updatedAt: asset.updatedAt.toISOString(),
});

const toAsset = (asset: AssetEntity): Asset => ({
  ...toMeta(asset),
  graph: asset.graphData as Graph,
});

@Injectable()
export class AssetService {
  constructor(
    private readonly database: DatabaseService,
    private readonly projects: ProjectService,
  ) {}

  private readonly repository = () =>
    this.database.dataSource.getRepository(AssetEntity);

  create = async (
    user: AuthUser,
    projectUuid: string,
    input: AssetInput,
  ): Promise<AssetMeta> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    const asset = this.repository().create({
      projectId: project.id,
      name: input.name,
      graphData: input.graph,
    });

    await this.repository().save(asset);

    return toMeta(asset);
  };

  list = async (
    user: AuthUser,
    projectUuid: string,
    limit: number,
    cursor?: string,
  ): Promise<Page<AssetMeta>> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    const builder = this.repository()
      .createQueryBuilder("asset")
      .where("asset.projectId = :projectId", { projectId: project.id })
      .orderBy("asset.updatedAt", "DESC")
      .addOrderBy("asset.id", "DESC")
      .take(limit + 1);

    if (cursor) {
      const decoded = decodeCursor(cursor);

      if (!decoded) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_FAILED,
          "分页游标不合法",
        );
      }

      builder.andWhere(
        "(asset.updatedAt, asset.id) < (:updatedAt, :id)",
        { updatedAt: decoded.updatedAt, id: decoded.id },
      );
    }

    const rows = await builder.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map(toMeta),
      nextCursor:
        hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
      hasMore,
    };
  };

  get = async (
    user: AuthUser,
    projectUuid: string,
    assetUuid: string,
    includeGraph: boolean,
  ): Promise<AssetDetail> => {
    const asset = await this.requireEntity(user, projectUuid, assetUuid);

    return includeGraph ? toAsset(asset) : toMeta(asset);
  };

  update = async (
    user: AuthUser,
    projectUuid: string,
    assetUuid: string,
    input: AssetUpdateInput,
  ): Promise<AssetDetail> => {
    const asset = await this.requireEntity(user, projectUuid, assetUuid);

    if (input.name !== undefined) {
      asset.name = input.name;
    }

    if (input.graph !== undefined) {
      asset.graphData = input.graph;
    }

    await this.repository().save(asset);

    return toAsset(asset);
  };

  remove = async (
    user: AuthUser,
    projectUuid: string,
    assetUuid: string,
  ): Promise<void> => {
    const asset = await this.requireEntity(user, projectUuid, assetUuid);
    await this.repository().remove(asset);
  };

  private readonly requireEntity = async (
    user: AuthUser,
    projectUuid: string,
    assetUuid: string,
  ): Promise<AssetEntity> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    const asset = await this.repository().findOneBy({
      uuid: assetUuid,
      projectId: project.id,
    });

    if (!asset) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.ASSET_NOT_FOUND,
        "资产不存在",
      );
    }

    return asset;
  };
}
