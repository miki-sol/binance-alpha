import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { ethers } from "ethers";

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private readonly coinGeckoApiUrl = "https://api.coingecko.com/api/v3";
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/"
    );
  }

  async getTokenPriceInUsd(tokenAddress: string): Promise<number> {
    try {
      const response = await axios.get(
        `${this.coinGeckoApiUrl}/simple/token_price/binance-smart-chain`,
        {
          params: {
            contract_addresses: tokenAddress.toLowerCase(),
            vs_currencies: "usd",
          },
        }
      );

      const price = response.data[tokenAddress.toLowerCase()]?.usd;
      if (!price) {
        this.logger.warn(`Price not found for token ${tokenAddress}`);
        return 0;
      }

      return price;
    } catch (error) {
      this.logger.error(
        `Error fetching price for token ${tokenAddress}:`,
        error.message
      );
      return 0;
    }
  }

  async getTokenSymbol(tokenAddress: string): Promise<string> {
    try {
      const erc20Abi = [
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
      ];
      const contract = new ethers.Contract(
        tokenAddress,
        erc20Abi,
        this.provider
      );
      const symbol = await contract.symbol();
      return symbol;
    } catch (error) {
      this.logger.error(
        `Error fetching symbol for token ${tokenAddress}:`,
        error.message
      );
      return "UNKNOWN";
    }
  }
}
