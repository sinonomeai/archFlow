import { Module } from "@nestjs/common";
import { ProjectModule } from "../project/project.module.js";
import { AssetController } from "./asset.controller.js";
import { AssetService } from "./asset.service.js";

@Module({
  imports: [ProjectModule],
  controllers: [AssetController],
  providers: [AssetService],
  exports: [AssetService],
})
export class AssetModule {}
