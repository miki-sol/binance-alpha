import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { Wallet } from '../entities/wallet.entity';
import { Transaction } from '../entities/transaction.entity';
import { BscTrackerModule } from '../bsctracker/bsctracker.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Transaction]),
    forwardRef(() => BscTrackerModule),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

