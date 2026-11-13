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
  CreateProjectInput,
  PaginationQuery,
  UpdateProjectInput,
  type Page,
  type Project,
  type ProjectNode,
} from "@arch-flow/shared";
import { RawResponse } from "../../common/decorators.js";
import type { AuthUser } from "../../common/request-context.js";
import { CurrentUser } from "../../common/request-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ProjectService } from "./project.service.js";

@Controller("projects")
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(PaginationQuery)) query: PaginationQuery,
  ): Promise<Page<ProjectNode>> {
    return this.projects.list(user, query.limit, query.cursor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateProjectInput)) input: CreateProjectInput,
  ): Promise<Project> {
    return this.projects.create(user, input);
  }

  @Get(":projectId")
  async get(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
  ): Promise<Project> {
    return this.projects.get(user, projectId);
  }

  @Patch(":projectId")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(UpdateProjectInput)) input: UpdateProjectInput,
  ): Promise<Project> {
    return this.projects.update(user, projectId, input);
  }

  @Delete(":projectId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RawResponse()
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
  ): Promise<void> {
    await this.projects.remove(user, projectId);
  }
}
