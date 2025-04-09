import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  port: process.env.PORT || 3000,
  apiKey: process.env.API_KEY,
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
}; 