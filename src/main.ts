import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import Moralis from 'moralis';

dotenv.config();

async function bootstrap() {
  // Initialize Moralis before creating the app
  const moralisApiKey = process.env.MORALIS_API_KEY;
  if (!moralisApiKey) {
    console.error('MORALIS_API_KEY is not set! Please set it in your .env file');
    process.exit(1);
  }

  try {
    if (!Moralis.Core.isStarted) {
      await Moralis.start({
        apiKey: moralisApiKey,
      });
      console.log('Moralis initialized successfully');
    }
  } catch (error) {
    console.error('Failed to initialize Moralis:', error.message);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body for webhook signature verification if needed
  });
  
  // Enable CORS for webhooks
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false,
  });
  
  // Port from environment (Render sets PORT automatically)
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`BSC Token Tracker application started on port ${port}`);
  
  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || `http://localhost:${port}`;
  console.log(`Webhook endpoint: ${webhookBaseUrl}/webhook/moralis`);
}

bootstrap();

