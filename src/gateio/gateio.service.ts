import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import * as crypto from "crypto";

@Injectable()
export class GateioService {
  private readonly logger = new Logger(GateioService.name);
  private readonly apiUrl = "https://api.gateio.ws/api/v4";
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.apiUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private generateSignature(
    method: string,
    url: string,
    queryString: string,
    payload: string = ""
  ): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message =
      method +
      "\n" +
      url +
      "\n" +
      queryString +
      "\n" +
      crypto.createHash("sha512").update(payload).digest("hex") +
      "\n" +
      timestamp;
    const signature = crypto
      .createHmac("sha512", process.env.GATEIO_SECRET_KEY || "")
      .update(message)
      .digest("hex");
    return signature;
  }

  private async makeAuthenticatedRequest(
    method: string,
    endpoint: string,
    params: any = {},
    data: any = null
  ) {
    const queryString =
      Object.keys(params).length > 0
        ? new URLSearchParams(params).toString()
        : "";
    const url = endpoint + (queryString ? "?" + queryString : "");
    const payload = data ? JSON.stringify(data) : "";
    const signature = this.generateSignature(method, url, queryString, payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    try {
      const response = await this.axiosInstance.request({
        method: method as any,
        url: endpoint,
        params: params,
        data: data,
        headers: {
          KEY: process.env.GATEIO_API_KEY || "",
          Timestamp: timestamp,
          SIGN: signature,
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error(
        `Gate.io API error:`,
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async getTradingPairs(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.apiUrl}/spot/currency_pairs`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching trading pairs:`, error.message);
      return [];
    }
  }

  async findTradingPair(tokenSymbol: string): Promise<string | null> {
    try {
      const pairs = await this.getTradingPairs();
      const symbolUpper = tokenSymbol.toUpperCase();

      const pair = pairs.find((p: any) => {
        const base = p.base.toUpperCase();
        const quote = p.quote.toUpperCase();
        return (
          (base === symbolUpper && quote === "USDT") ||
          (base === symbolUpper && quote === "USD")
        );
      });

      if (pair) {
        return pair.id;
      }

      this.logger.warn(`Trading pair not found for ${tokenSymbol}`);
      return null;
    } catch (error) {
      this.logger.error(`Error finding trading pair:`, error.message);
      return null;
    }
  }

  async openShortPosition(tradingPair: string, amount: number): Promise<any> {
    try {
      const orderData = {
        currency_pair: tradingPair,
        side: "sell",
        amount: amount.toString(),
        type: "market",
      };

      const result = await this.makeAuthenticatedRequest(
        "POST",
        "/spot/orders",
        {},
        orderData
      );
      this.logger.log(`Short position opened: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`Error opening short position:`, error.message);
      throw error;
    }
  }

  async getAccountBalance(): Promise<any> {
    try {
      const result = await this.makeAuthenticatedRequest(
        "GET",
        "/spot/accounts"
      );
      return result;
    } catch (error) {
      this.logger.error(`Error getting account balance:`, error.message);
      throw error;
    }
  }
}
