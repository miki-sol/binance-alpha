import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { TelegramModule } from "./telegram/telegram.module";
import { BscTrackerModule } from "./bsctracker/bsctracker.module";
import { PriceModule } from "./price/price.module";
import { GateioModule } from "./gateio/gateio.module";

@Module({
  imports: [
    DatabaseModule,
    PriceModule,
    GateioModule,
    TelegramModule,
    BscTrackerModule,
  ],
})
export class AppModule {}
