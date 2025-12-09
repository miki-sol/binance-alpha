import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Wallet } from './wallet.entity';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  txHash: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;

  @Column()
  walletId: number;

  @Column()
  tokenAddress: string;

  @Column()
  tokenSymbol: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  amountUsd: number;

  @Column({ type: 'bigint' })
  blockNumber: number;

  @Column({ default: false })
  shortOpened: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

