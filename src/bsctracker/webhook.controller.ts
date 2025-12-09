import { Controller, Post, Body, Logger, HttpCode, HttpStatus, Req, Res, RawBodyRequest } from "@nestjs/common";
import { Request, Response } from "express";
import { BscTrackerService } from "./bsctracker.service";

@Controller("webhook")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly bscTrackerService: BscTrackerService) {}

  @Post("moralis")
  async handleMoralisWebhook(
    @Body() body: any,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response
  ) {
    // Always return 200 immediately - Moralis requires 200 for test webhook
    this.logger.log(`🔔 Webhook received from Moralis`);
    this.logger.log(`Webhook body keys: ${Object.keys(body || {}).join(', ')}`);
    this.logger.log(`ERC20 transfers count: ${body?.erc20Transfers?.length || 0}`);
    this.logger.log(`Confirmed: ${body?.confirmed}, StreamId: ${body?.streamId}`);
    if (body?.erc20Transfers?.length > 0) {
      const transfer = body.erc20Transfers[0];
      this.logger.log(`First transfer - to: ${transfer.to}, from: ${transfer.from}, value: ${transfer.value}, token: ${transfer.tokenSymbol}`);
    }
    
    // Process webhook asynchronously (don't block response)
    setImmediate(async () => {
      try {
        await this.bscTrackerService.handleWebhookEvent(body);
      } catch (error) {
        this.logger.error(`Error processing webhook:`, error.message);
        this.logger.error(`Error stack:`, error.stack);
      }
    });

    // Return 200 immediately
    return res.status(200).json({ status: "ok" });
  }
}

