import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from "@nestjs/common";
import { Telegraf } from "telegraf";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Wallet } from "../entities/wallet.entity";
import { Transaction } from "../entities/transaction.entity";
import { BscTrackerService } from "../bsctracker/bsctracker.service";

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;
  private notificationCallbacks: Map<number, (message: string) => void> =
    new Map();

  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @Inject(forwardRef(() => BscTrackerService))
    private bscTrackerService: BscTrackerService
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is not set");
    }
    this.bot = new Telegraf(token);
  }

  async onModuleInit() {
    this.setupCommands();
    await this.bot.launch();
    this.logger.log("Telegram bot started");
  }

  private setupCommands() {
    this.bot.start((ctx) => {
      ctx.reply(
        "Добро пожаловать в BSC Token Tracker Bot!\n\n" +
          "Доступные команды:\n" +
          "/add_wallet <address> - Добавить кошелек для отслеживания\n" +
          "/set_threshold <amount> - Установить пороговую сумму в USD\n" +
          "/list_wallets - Показать список отслеживаемых кошельков\n" +
          "/remove_wallet <address> - Удалить кошелек из отслеживания\n" +
          "/transactions - Показать последние транзакции\n" +
          "/help - Показать справку по командам"
      );
    });

    this.bot.command("add_wallet", async (ctx) => {
      const address = ctx.message.text.split(" ")[1];
      if (!address) {
        ctx.reply("Пожалуйста, укажите адрес кошелька: /add_wallet <address>");
        return;
      }

      if (!this.isValidAddress(address)) {
        ctx.reply("Неверный формат адреса кошелька");
        return;
      }

      try {
        const existingWallet = await this.walletRepository.findOne({
          where: { address: address.toLowerCase() },
        });

        if (existingWallet) {
          ctx.reply(`Кошелек ${address} уже отслеживается`);
          return;
        }

        const wallet = this.walletRepository.create({
          address: address.toLowerCase(),
          chatId: ctx.chat.id,
          thresholdUsd: 1000,
          isActive: true,
        });

        await this.walletRepository.save(wallet);
        
        // Create stream for the wallet
        try {
          await this.bscTrackerService.createStreamForWallet(wallet);
        } catch (error) {
          this.logger.error(`Error creating stream:`, error.message);
        }
        
        ctx.reply(
          `Кошелек ${address} успешно добавлен! Порог по умолчанию: $1000 USD`
        );
      } catch (error) {
        this.logger.error(`Error adding wallet:`, error.message);
        ctx.reply("Ошибка при добавлении кошелька. Попробуйте еще раз.");
      }
    });

    this.bot.command("set_threshold", async (ctx) => {
      const amount = parseFloat(ctx.message.text.split(" ")[1]);
      if (isNaN(amount) || amount <= 0) {
        ctx.reply(
          "Пожалуйста, укажите корректную пороговую сумму: /set_threshold <amount>"
        );
        return;
      }

      try {
        const wallets = await this.walletRepository.find({
          where: { chatId: ctx.chat.id },
        });

        if (wallets.length === 0) {
          ctx.reply(
            "Кошельки не найдены. Сначала добавьте кошелек: /add_wallet <address>"
          );
          return;
        }

        for (const wallet of wallets) {
          wallet.thresholdUsd = amount;
          await this.walletRepository.save(wallet);
        }

        ctx.reply(
          `Порог установлен на $${amount} USD для всех ваших кошельков`
        );
      } catch (error) {
        this.logger.error(`Error setting threshold:`, error.message);
        ctx.reply("Ошибка при установке порога. Попробуйте еще раз.");
      }
    });

    this.bot.command("list_wallets", async (ctx) => {
      try {
        const wallets = await this.walletRepository.find({
          where: { chatId: ctx.chat.id },
        });

        if (wallets.length === 0) {
          ctx.reply(
            "Нет отслеживаемых кошельков. Добавьте кошелек: /add_wallet <address>"
          );
          return;
        }

        let message = "Отслеживаемые кошельки:\n\n";
        wallets.forEach((wallet, index) => {
          message += `${index + 1}. ${wallet.address}\n`;
          message += `   Порог: $${wallet.thresholdUsd} USD\n`;
          message += `   Статус: ${
            wallet.isActive ? "Активен" : "Неактивен"
          }\n\n`;
        });

        ctx.reply(message);
      } catch (error) {
        this.logger.error(`Error listing wallets:`, error.message);
        ctx.reply("Ошибка при получении списка кошельков. Попробуйте еще раз.");
      }
    });

    this.bot.command("remove_wallet", async (ctx) => {
      const address = ctx.message.text.split(" ")[1];
      if (!address) {
        ctx.reply(
          "Пожалуйста, укажите адрес кошелька: /remove_wallet <address>"
        );
        return;
      }

      try {
        const wallet = await this.walletRepository.findOne({
          where: { address: address.toLowerCase(), chatId: ctx.chat.id },
        });

        if (!wallet) {
          ctx.reply(`Кошелек ${address} не найден`);
          return;
        }

        // Delete stream before removing wallet
        try {
          await this.bscTrackerService.deleteStreamForWallet(wallet);
        } catch (error) {
          this.logger.error(`Error deleting stream:`, error.message);
        }
        
        await this.walletRepository.remove(wallet);
        ctx.reply(`Кошелек ${address} успешно удален`);
      } catch (error) {
        this.logger.error(`Error removing wallet:`, error.message);
        ctx.reply("Ошибка при удалении кошелька. Попробуйте еще раз.");
      }
    });

    this.bot.command("transactions", async (ctx) => {
      try {
        const wallets = await this.walletRepository.find({
          where: { chatId: ctx.chat.id },
        });

        if (wallets.length === 0) {
          ctx.reply(
            "Нет отслеживаемых кошельков. Добавьте кошелек: /add_wallet <address>"
          );
          return;
        }

        const walletIds = wallets.map((w) => w.id);
        const transactions = await this.transactionRepository.find({
          where: walletIds.map((id) => ({ walletId: id })),
          order: { createdAt: "DESC" },
          take: 10,
        });

        if (transactions.length === 0) {
          ctx.reply("Транзакции не найдены");
          return;
        }

        let message = "Последние транзакции:\n\n";
        transactions.forEach((tx, index) => {
          message += `${index + 1}. ${tx.tokenSymbol}\n`;
          message += `   Количество: ${tx.amount}\n`;
          message += `   Стоимость: $${tx.amountUsd.toFixed(2)}\n`;
          message += `   Шорт: ${tx.shortOpened ? "Да" : "Нет"}\n`;
          message += `   ${tx.txHash.substring(0, 10)}...\n\n`;
        });

        ctx.reply(message);
      } catch (error) {
        this.logger.error(`Error fetching transactions:`, error.message);
        ctx.reply("Ошибка при получении транзакций. Попробуйте еще раз.");
      }
    });

    this.bot.command("help", (ctx) => {
      ctx.reply(
        "Доступные команды:\n\n" +
          "/add_wallet <address> - Добавить кошелек для отслеживания\n" +
          "/set_threshold <amount> - Установить пороговую сумму в USD\n" +
          "/list_wallets - Показать список отслеживаемых кошельков\n" +
          "/remove_wallet <address> - Удалить кошелек из отслеживания\n" +
          "/transactions - Показать последние транзакции\n" +
          "/recreate_streams - Пересоздать все стримы с текущим WEBHOOK_BASE_URL\n" +
          "/help - Показать справку по командам"
      );
    });

    this.bot.command("recreate_streams", async (ctx) => {
      try {
        ctx.reply("Пересоздание стримов...");
        
        const wallets = await this.walletRepository.find({
          where: { chatId: ctx.chat.id, isActive: true },
        });

        if (wallets.length === 0) {
          ctx.reply("У вас нет активных кошельков для пересоздания стримов");
          return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const wallet of wallets) {
          try {
            // Delete old stream if exists
            if (wallet.streamId) {
              await this.bscTrackerService.deleteStreamForWallet(wallet);
            }
            // Create new stream
            await this.bscTrackerService.createStreamForWallet(wallet);
            successCount++;
          } catch (error) {
            this.logger.error(`Error recreating stream for ${wallet.address}:`, error.message);
            errorCount++;
          }
        }

        ctx.reply(
          `Пересоздание стримов завершено.\n` +
          `Успешно: ${successCount}\n` +
          `Ошибок: ${errorCount}`
        );
      } catch (error) {
        this.logger.error(`Error recreating streams:`, error.message);
        ctx.reply("Ошибка при пересоздании стримов. Проверьте логи.");
      }
    });

    this.bot.on("text", (ctx) => {
      ctx.reply(
        "Неизвестная команда. Используйте /help для просмотра доступных команд."
      );
    });
  }

  async sendNotification(chatId: number, message: string) {
    try {
      await this.bot.telegram.sendMessage(chatId, message);
    } catch (error) {
      this.logger.error(
        `Error sending notification to ${chatId}:`,
        error.message
      );
    }
  }

  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  async onModuleDestroy() {
    await this.bot.stop();
  }
}
