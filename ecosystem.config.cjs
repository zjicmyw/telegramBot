/**
 * PM2 配置文件
 * 用于在 Ubuntu 服务器上守护运行 Telegram Bot
 */

module.exports = {
  apps: [{
    // 应用名称
    name: 'telegram-bot',
    
    // 启动脚本路径
    script: './src/server.js',
    
    // 应用实例数（1 个实例即可）
    instances: 1,
    
    // 执行模式：cluster 或 fork
    exec_mode: 'fork',
    
    // 是否启用自动重启
    autorestart: true,
    
    // 监听文件变化自动重启（生产环境建议设为 false）
    watch: false,
    
    // 最大内存限制（超过此限制将重启）
    max_memory_restart: '500M',
    
    // 环境变量文件路径
    env_file: '.env',
    
    // 生产环境配置
    env: {
      NODE_ENV: 'production'
    },
    
    // 开发环境配置
    env_development: {
      NODE_ENV: 'development',
      watch: true
    },
    
    // 日志配置
    // PM2 日志与 winston 日志并存
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    
    // 日志日期格式
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // 合并日志（将 error 和 out 合并到一个文件）
    merge_logs: true,
    
    // 日志轮转配置
    log_type: 'json',
    
    // 最小正常运行时间（毫秒），小于此时间重启不计入重启次数
    min_uptime: '10s',
    
    // 最大重启次数（15分钟内）
    max_restarts: 10,
    
    // 重启间隔（毫秒）
    restart_delay: 4000,
    
    // 不自动重启的错误退出码
    stop_exit_codes: [0],
    
    // 优雅关闭超时时间（毫秒）
    kill_timeout: 5000,
    
    // 等待就绪信号的时间（毫秒）
    listen_timeout: 10000,
    
    // 是否在应用崩溃时发送通知（需要配置 notify）
    // notify: false
  }]
};
