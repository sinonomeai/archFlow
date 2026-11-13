import {
  Controller,
  Get,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ERROR_CODES, type HealthResult } from "@arch-flow/shared";
import { apiError } from "../../common/api-error.js";
import { Public, RawResponse } from "../../common/decorators.js";
import { DatabaseService } from "../../database/database.service.js";
import { RedisService } from "../../infra/redis.service.js";

@Injectable()
export class SystemService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  health = (): HealthResult => ({ status: "ok" });

  ready = async (): Promise<HealthResult> => {
    try {
      await this.database.dataSource.query("SELECT 1");
      await this.redis.client.ping();
    } catch {
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "依赖未就绪",
      );
    }

    return { status: "ok" };
  };
}

@Controller()
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Public()
  @RawResponse()
  @Get("health")
  health(): HealthResult {
    return this.system.health();
  }

  @Public()
  @RawResponse()
  @Get("ready")
  ready(): Promise<HealthResult> {
    return this.system.ready();
  }
}
