import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@arch-flow/shared";
import { apiError } from "../../common/api-error.js";
import { IS_PUBLIC_KEY } from "../../common/decorators.js";
import { getRequest } from "../../common/request-context.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  canActivate = async (context: ExecutionContext): Promise<boolean> => {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = getRequest(context);
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_MISSING,
        "缺少 Access Token",
      );
    }

    const token = header.slice("Bearer ".length).trim();

    if (!token) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_MISSING,
        "缺少 Access Token",
      );
    }

    const { userUuid } = this.tokens.verifyAccessToken(token);
    const user = await this.auth.loadAuthUser(userUuid);

    if (!user) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_INVALID,
        "Access Token 无效",
      );
    }

    request.user = user;
    return true;
  };
}
