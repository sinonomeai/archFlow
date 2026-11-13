import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  AssetDetailQuery,
  AssetInput,
  AssetUpdateInput,
  PaginationQuery,
  type AssetDetail,
  type AssetMeta,
  type Page,
} from "@arch-flow/shared";
import { RawResponse } from "../../common/decorators.js";
import type { AuthUser } from "../../common/request-context.js";
import { CurrentUser } from "../../common/request-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AssetService } from "./asset.service.js";

@Controller("projects/:projectId/assets")
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(AssetInput)) input: AssetInput,
  ): Promise<AssetMeta> {
    return this.assets.create(user, projectId, input);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(PaginationQuery)) query: PaginationQuery,
  ): Promise<Page<AssetMeta>> {
    return this.assets.list(user, projectId, query.limit, query.cursor);
  }

  @Get(":assetId")
  async get(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
    @Query(new ZodValidationPipe(AssetDetailQuery)) query: AssetDetailQuery,
  ): Promise<AssetDetail> {
    return this.assets.get(user, projectId, assetId, query.includeGraph);
  }

  @Patch(":assetId")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
    @Body(new ZodValidationPipe(AssetUpdateInput)) input: AssetUpdateInput,
  ): Promise<AssetDetail> {
    return this.assets.update(user, projectId, assetId, input);
  }

  @Delete(":assetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RawResponse()
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
  ): Promise<void> {
    await this.assets.remove(user, projectId, assetId);
  }
}
