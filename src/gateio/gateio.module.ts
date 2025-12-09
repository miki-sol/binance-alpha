import { Module } from "@nestjs/common";
import { GateioService } from "./gateio.service";

@Module({
  providers: [GateioService],
  exports: [GateioService],
})
export class GateioModule {}
