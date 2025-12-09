import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  address: string;

  @Column({ type: 'bigint' })
  chatId: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  thresholdUsd: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  streamId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

