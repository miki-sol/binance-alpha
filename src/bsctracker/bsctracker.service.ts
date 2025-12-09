import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ethers } from "ethers";
import Moralis from "moralis";
import { Wallet } from "../entities/wallet.entity";
import { Transaction } from "../entities/transaction.entity";
import { PriceService } from "../price/price.service";
import { GateioService } from "../gateio/gateio.service";
import { TelegramService } from "../telegram/telegram.service";

@Injectable()
export class BscTrackerService implements OnModuleInit {
  private readonly logger = new Logger(BscTrackerService.name);
  private readonly chain = "0x38"; // BSC (BNB Smart Chain) in hex format
  private readonly webhookUrl: string;

  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    private priceService: PriceService,
    private gateioService: GateioService,
    @Inject(forwardRef(() => TelegramService))
    private telegramService: TelegramService
  ) {
    // Webhook URL must be publicly accessible (use ngrok for development)
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
    if (!webhookBaseUrl) {
      this.logger.warn(
        "WEBHOOK_BASE_URL is not set! Moralis needs a publicly accessible URL. " +
        "For development, use ngrok: ngrok http 3000, then set WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok.io"
      );
    }
    const baseUrl = webhookBaseUrl || `http://localhost:3000`;
    // Remove trailing slash if present to avoid double slashes
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    this.webhookUrl = `${cleanBaseUrl}/webhook/moralis`;
    this.logger.log(`Webhook URL configured: ${this.webhookUrl}`);
  }

  async onModuleInit() {
    this.logger.log("BSC Tracker Service initialized");

    // Wait for Moralis to be initialized
    let retries = 0;
    while (!Moralis.Core.isStarted && retries < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries++;
    }

    if (!Moralis.Core.isStarted) {
      this.logger.error(
        "Moralis is not initialized! Please check MORALIS_API_KEY in .env"
      );
      return;
    }

    // Wait for app to fully start listening on port
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create streams for existing wallets
    await this.initializeStreams();
  }

  private async initializeStreams() {
    const activeWallets = await this.walletRepository.find({
      where: { isActive: true },
    });

    for (const wallet of activeWallets) {
      if (!wallet.streamId) {
        try {
          await this.createStreamForWallet(wallet);
        } catch (error) {
          this.logger.error(
            `Error creating stream for wallet ${wallet.address}:`,
            error.message
          );
        }
      }
    }
  }

  async createStreamForWallet(wallet: Wallet): Promise<void> {
    try {
      if (!process.env.WEBHOOK_BASE_URL) {
        throw new Error(
          "WEBHOOK_BASE_URL is not set! Moralis requires a publicly accessible URL. " +
          "For development, run: ngrok http 3000, then set WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok.io"
        );
      }

      this.logger.log(`Creating stream for wallet ${wallet.address}`);

      // ERC20 Transfer ABI
      const ERC20TransferABI = [
        {
          anonymous: false,
          inputs: [
            {
              indexed: true,
              name: "from",
              type: "address",
            },
            {
              indexed: true,
              name: "to",
              type: "address",
            },
            {
              indexed: false,
              name: "value",
              type: "uint256",
            },
          ],
          name: "Transfer",
          type: "event",
        },
      ];

      const topic = "Transfer(address,address,uint256)";

      // Step 1: Create stream with basic parameters
      const stream = {
        chains: [this.chain],
        description: `Token transfers for wallet ${wallet.address}`,
        tag: `wallet_${wallet.id}`,
        webhookUrl: this.webhookUrl,
        includeNativeTxs: false,
        includeContractLogs: true,
        includeInternalTxs: false,
        abi: ERC20TransferABI,
        topic0: [topic],
      };

      this.logger.log(`Attempting to create stream with webhook URL: ${this.webhookUrl}`);
      
      const newStream = await Moralis.Streams.add(stream);
      const streamId = newStream.toJSON().id;

      this.logger.log(`Stream created with ID: ${streamId}, waiting for test webhook...`);

      // Wait a bit for test webhook to arrive
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 2: Add wallet address to stream
      await Moralis.Streams.addAddress({
        id: streamId,
        address: wallet.address,
      });

      // Save stream ID to wallet
      wallet.streamId = streamId;
      await this.walletRepository.save(wallet);

      this.logger.log(
        `Stream created successfully for wallet ${wallet.address}, streamId: ${streamId}`
      );
    } catch (error) {
      const errorMessage = error.message || String(error);
      
      // Check error type and provide specific guidance
      if (errorMessage.includes("status code 502") || errorMessage.includes("Bad Gateway")) {
        this.logger.error(
          `\n⚠️  502 BAD GATEWAY - Tunnel cannot reach your application!\n` +
          `This means Cloudflare Tunnel/ngrok cannot connect to your NestJS app.\n\n` +
          `Check:\n` +
          `1. Is your app running? Check: curl http://localhost:3001/webhook/moralis\n` +
          `2. Is tunnel pointing to correct port? Should be: cloudflared tunnel --url http://localhost:3001\n` +
          `3. Check if PORT in .env matches tunnel port\n\n` +
          `Current webhook URL: ${this.webhookUrl}\n`
        );
      } else if (errorMessage.includes("status code 400") && errorMessage.includes("ngrok-free.app")) {
        this.logger.error(
          `\n⚠️  NGROK WARNING PAGE ISSUE DETECTED!\n` +
          `ngrok-free.app shows a warning page that blocks Moralis webhooks.\n` +
          `Solutions:\n` +
          `1. Use Cloudflare Tunnel (free, recommended): cloudflared tunnel --url http://localhost:3001\n` +
          `2. Use ngrok with fixed domain (paid): ngrok http 3001 --domain=your-domain.ngrok.io\n` +
          `3. Deploy to a public server with HTTPS\n\n` +
          `Current webhook URL: ${this.webhookUrl}\n`
        );
      }
      
      this.logger.error(
        `Error creating stream for wallet ${wallet.address}:`,
        errorMessage
      );
      throw error;
    }
  }

  async deleteStreamForWallet(wallet: Wallet): Promise<void> {
    try {
      if (!wallet.streamId) {
        return;
      }

      this.logger.log(`Deleting stream ${wallet.streamId} for wallet ${wallet.address}`);

      await Moralis.Streams.delete({
        id: wallet.streamId,
      });

      wallet.streamId = null;
      await this.walletRepository.save(wallet);

      this.logger.log(`Stream deleted successfully for wallet ${wallet.address}`);
    } catch (error) {
      this.logger.error(
        `Error deleting stream for wallet ${wallet.address}:`,
        error.message
      );
    }
  }

  async handleWebhookEvent(body: any): Promise<void> {
    try {
      this.logger.debug(`Received webhook event, confirmed: ${body?.confirmed}, streamId: ${body?.streamId}`);

      // Handle test webhook (mandatory - must return 200)
      if (body?.tag && body?.streamId && (!body?.erc20Transfers || body.erc20Transfers.length === 0) && (!body?.logs || body.logs.length === 0)) {
        this.logger.log(`Received test webhook for stream ${body.streamId}`);
        return;
      }

      // Only process confirmed events to avoid duplicates
      if (!body?.confirmed) {
        this.logger.debug(`Skipping unconfirmed webhook event`);
        return;
      }

      // Process ERC20 transfers
      const erc20Transfers = body?.erc20Transfers || [];
      const blockNumber = body?.block?.number || body?.blockNumber;
      for (const transfer of erc20Transfers) {
        // Add block number from webhook body if not present in transfer
        if (!transfer.block && blockNumber) {
          transfer.block = { number: blockNumber };
        }
        await this.processERC20Transfer(transfer);
      }

      // Process contract logs (Transfer events from topic0)
      const logs = body?.logs || [];
      for (const log of logs) {
        // Transfer event signature: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
        if (log.topic0 === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
          await this.processTransferLog(log);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing webhook event:`, error.message);
      throw error;
    }
  }

  private async processERC20Transfer(transfer: any): Promise<void> {
    try {
      // Moralis uses 'to', other APIs might use 'toAddress'
      const toAddress = (transfer.to || transfer.toAddress || "").toLowerCase();
      if (!toAddress) {
        this.logger.warn(`No 'to' address found in transfer: ${JSON.stringify(transfer)}`);
        return;
      }

      this.logger.log(`Processing ERC20 transfer to ${toAddress}`);

      const wallet = await this.walletRepository.findOne({
        where: { address: toAddress },
      });

      if (!wallet) {
        this.logger.warn(`No wallet found in database for address ${toAddress}`);
        // Log all wallets for debugging
        const allWallets = await this.walletRepository.find();
        this.logger.debug(`Registered wallets: ${allWallets.map(w => w.address).join(', ')}`);
        return;
      }

      if (!wallet.isActive) {
        this.logger.warn(`Wallet ${toAddress} is not active`);
        return;
      }

      this.logger.log(`Found active wallet ${toAddress} for chatId ${wallet.chatId}`);

      const txHash = transfer.transactionHash || transfer.hash;
      if (!txHash) {
        this.logger.debug(`No transaction hash found in transfer`);
        return;
      }

      // Check if transaction already processed
      const existingTx = await this.transactionRepository.findOne({
        where: { txHash },
      });

      if (existingTx) {
        this.logger.debug(`Transaction ${txHash} already processed`);
        return;
      }

      await this.handleTokenTransfer(transfer, wallet);
    } catch (error) {
      this.logger.error(`Error processing ERC20 transfer:`, error.message);
    }
  }

  private async processTransferLog(log: any): Promise<void> {
    try {
      // Extract 'to' address from topic2 (indexed parameter in Transfer event)
      const toAddressHex = log.topic2;
      if (!toAddressHex) {
        return;
      }

      // Remove '0x' prefix and get last 40 characters (address is 20 bytes = 40 hex chars)
      const toAddress = "0x" + toAddressHex.slice(-40).toLowerCase();

      const wallet = await this.walletRepository.findOne({
        where: { address: toAddress.toLowerCase() },
      });

      if (!wallet || !wallet.isActive) {
        return;
      }

      const txHash = log.transactionHash || log.hash;
      if (!txHash) {
        return;
      }

      // Check if transaction already processed
      const existingTx = await this.transactionRepository.findOne({
        where: { txHash },
      });

      if (existingTx) {
        return;
      }

      // Extract value from data (last 64 characters = 32 bytes = uint256)
      const valueHex = log.data;
      const value = valueHex ? "0x" + valueHex.slice(-64) : "0x0";

      // Create transfer object compatible with handleTokenTransfer
      const transfer = {
        transactionHash: txHash,
        toAddress: toAddress,
        tokenAddress: log.address?.toLowerCase(),
        value: value,
        blockNumber: log.blockNumber,
      };

      await this.handleTokenTransfer(transfer, wallet);
    } catch (error) {
      this.logger.error(`Error processing transfer log:`, error.message);
    }
  }

  private async handleTokenTransfer(tx: any, wallet: Wallet) {
    try {
      const txHash = tx.transactionHash || tx.hash;
      if (!txHash) {
        return;
      }

      // Moralis uses 'contract', other APIs might use 'tokenAddress' or 'address'
      const tokenAddressRaw = tx.contract || tx.tokenAddress || tx.address || "";
      const tokenAddress = (typeof tokenAddressRaw === "string" ? tokenAddressRaw : String(tokenAddressRaw)).toLowerCase();
      const tokenSymbol = tx.tokenSymbol || tx.symbol || "UNKNOWN";
      const decimalsRaw = tx.tokenDecimals || tx.decimals || "18";
      const decimals = typeof decimalsRaw === "string" ? parseInt(decimalsRaw) : decimalsRaw;
      const valueRaw = tx.value || tx.amount || "0";
      // Moralis provides block number in nested 'block' object or directly
      const blockNumberRaw = tx.block?.number || tx.blockNumber || tx.block || "0";
      const blockNumber = typeof blockNumberRaw === "string" ? parseInt(blockNumberRaw) : blockNumberRaw;

      // Convert hex value to BigNumber if needed
      let valueBigInt: bigint;
      if (typeof valueRaw === "string") {
        if (valueRaw.startsWith("0x")) {
          valueBigInt = BigInt(valueRaw);
        } else {
          valueBigInt = BigInt(valueRaw);
        }
      } else if (typeof valueRaw === "bigint") {
        valueBigInt = valueRaw;
      } else {
        valueBigInt = BigInt(valueRaw.toString());
      }

      const amountFormatted = ethers.formatUnits(valueBigInt, decimals);
      const tokenPrice = await this.priceService.getTokenPriceInUsd(tokenAddress);
      const amountUsd = parseFloat(amountFormatted) * tokenPrice;

      const transaction = this.transactionRepository.create({
        txHash,
        wallet,
        walletId: wallet.id,
        tokenAddress,
        tokenSymbol,
        amount: amountFormatted,
        amountUsd,
        blockNumber,
        shortOpened: false,
      });

      await this.transactionRepository.save(transaction);

      this.logger.log(
        `Token transfer detected: ${amountFormatted} ${tokenSymbol} ($${amountUsd.toFixed(2)}) to ${wallet.address}`
      );

      const message =
        `🔔 Обнаружен новый перевод токенов!\n\n` +
        `Токен: ${tokenSymbol}\n` +
        `Количество: ${amountFormatted}\n` +
        `Стоимость: $${amountUsd.toFixed(2)}\n` +
        `Транзакция: ${txHash}\n` +
        `Блок: ${blockNumber}`;

      await this.telegramService.sendNotification(wallet.chatId, message);

      if (amountUsd >= wallet.thresholdUsd) {
        await this.openShortPosition(transaction, wallet);
        const shortMessage =
          `📉 Шорт позиция открыта для ${tokenSymbol}!\n` +
          `Сумма: $${amountUsd.toFixed(2)}`;
        await this.telegramService.sendNotification(wallet.chatId, shortMessage);
      }
    } catch (error) {
      this.logger.error(`Error handling token transfer:`, error.message);
    }
  }

  private async openShortPosition(transaction: Transaction, wallet: Wallet) {
    try {
      if (transaction.shortOpened) {
        return;
      }

      this.logger.log(
        `Opening short position for ${transaction.tokenSymbol} ($${transaction.amountUsd})`
      );

      const tradingPair = await this.gateioService.findTradingPair(
        transaction.tokenSymbol
      );

      if (!tradingPair) {
        this.logger.warn(
          `Trading pair not found for ${transaction.tokenSymbol}`
        );
        return;
      }

      const shortAmount = transaction.amountUsd / 100;
      await this.gateioService.openShortPosition(tradingPair, shortAmount);

      transaction.shortOpened = true;
      await this.transactionRepository.save(transaction);

      this.logger.log(
        `Short position opened successfully for ${transaction.tokenSymbol}`
      );
    } catch (error) {
      this.logger.error(`Error opening short position:`, error.message);
    }
  }
}
