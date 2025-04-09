import fetch from 'node-fetch';

async function sendMessage() {
    try {
        const response = await fetch('http://localhost:3000/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'my-secret-api-key-money-88'
            },
            body: JSON.stringify({
                chatId: "6142261537",
                message: "helloworld"
            })
        });

        const data = await response.json();
        console.log('Response:', data);
    } catch (error) {
        console.error('Error:', error);
    }
}

sendMessage(); 