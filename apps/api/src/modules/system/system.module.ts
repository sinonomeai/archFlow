import { Module } from "@nestjs/common";
import { SystemController, SystemService } from "./system.controller.js";

@Module({
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
