import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { JwtAuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
