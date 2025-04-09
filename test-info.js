// 导入 axios 模块
import axios from 'axios';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// API 配置
const config = {
    baseURL: 'http://localhost:3000',
    headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.API_KEY
    }
};

// 获取聊天信息的测试函数
async function getChatInfo() {
    try {
        console.log('正在获取聊天信息...');
        const response = await axios.get('/chat-info', {
            ...config,
            params: {
                chatId: process.env.CHAT_ID  // 从环境变量获取聊天 ID
            }
        });
        console.log('聊天信息:', response.data);
    } catch (error) {
        console.error('获取聊天信息失败:', error.response?.data || error.message);
    }
}

// 获取更新信息的测试函数
async function getUpdates() {
    try {
        console.log('正在获取更新信息...');
        const response = await axios.get('/updates', {
            ...config
        });
        console.log('更新信息:', response.data);
    } catch (error) {
        console.error('获取更新信息失败:', error.response?.data || error.message);
    }
}

// 直接调用 Telegram API 获取更新
async function getTelegramUpdates() {
    try {
        console.log('正在直接从 Telegram API 获取更新...');
        const response = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
        console.log('Telegram 更新信息:');
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('获取 Telegram 更新失败:', error.response?.data || error.message);
    }
}

// 执行所有测试函数
async function runTests() {
    console.log('=== 开始测试 ===');
    
    console.log('\n1. 测试获取聊天信息');
    await getChatInfo();
    
    console.log('\n2. 测试获取本地更新信息');
    await getUpdates();
    
    console.log('\n3. 测试直接获取 Telegram 更新信息');
    await getTelegramUpdates();
    
    console.log('\n=== 测试完成 ===');
}

// 运行测试
runTests(); 