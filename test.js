// 导入 fetch 模块，用于发送 HTTP 请求
import fetch from 'node-fetch';

// 发送消息的测试函数
async function sendMessage() {
    try {
        // 发送 POST 请求到本地服务器
        const response = await fetch('http://localhost:3000/send-message', {
            method: 'POST',
            // 设置请求头
            headers: {
                'Content-Type': 'application/json',  // 指定内容类型为 JSON
                'X-API-Key': 'my-secret-api-key-money-88'  // 设置 API 密钥
            },
            // 设置请求体
            body: JSON.stringify({
                chatId: "6142261537",  // 目标聊天 ID
                message: "helloworld"   // 要发送的消息内容
            })
        });

        // 解析响应数据
        const data = await response.json();
        // 打印响应结果
        console.log('Response:', data);
    } catch (error) {
        // 捕获并打印错误
        console.error('Error:', error);
    }
}

// 执行测试函数
sendMessage(); 