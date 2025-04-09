// 导入 axios 模块
import axios from 'axios';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 发送消息的测试函数
async function sendMessage() {
    try {
        // 发送 POST 请求到本地服务器
        const response = await axios.post('http://localhost:3000/send-message', {
            chatId: process.env.CHAT_ID,  // 从环境变量获取聊天 ID
            message: "helloworld！！！的"   // 要发送的消息内容
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.API_KEY  // 从环境变量获取 API 密钥
            }
        });

        // 打印响应结果
        console.log('Response:', response.data);
    } catch (error) {
        // 捕获并打印错误
        console.error('Error:', error.response?.data || error.message);
    }
}

// 执行测试函数
sendMessage(); 