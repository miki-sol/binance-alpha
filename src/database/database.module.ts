import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../entities/wallet.entity';
import { Transaction } from '../entities/transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'bsc_tracker.db',
      entities: [Wallet, Transaction],
      synchronize: true,
      logging: false,
    }),
    TypeOrmModule.forFeature([Wallet, Transaction]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}

