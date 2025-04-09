// 导入 dotenv 模块，用于加载环境变量
import dotenv from 'dotenv';
// 加载 .env 文件中的环境变量
dotenv.config();

// 导出配置对象
export const config = {
  // Telegram Bot 的 Token，从环境变量中获取
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  
  // 服务器端口号，默认 3000
  port: process.env.PORT || 3000,
  
  // API 密钥，用于接口认证
  apiKey: process.env.API_KEY,
  
  // 速率限制配置
  rateLimit: {
    // 时间窗口：15分钟
    windowMs: 15 * 60 * 1000,
    // 每个 IP 在时间窗口内最多允许的请求数
    max: 100
  }
}; 