import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BscTrackerService } from './bsctracker.service';
import { WebhookController } from './webhook.controller';
import { Wallet } from '../entities/wallet.entity';
import { Transaction } from '../entities/transaction.entity';
import { PriceModule } from '../price/price.module';
import { GateioModule } from '../gateio/gateio.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Transaction]),
    PriceModule,
    GateioModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [WebhookController],
  providers: [BscTrackerService],
  exports: [BscTrackerService],
})
export class BscTrackerModule {}

