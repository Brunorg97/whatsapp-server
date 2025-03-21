const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

let qrCodeBase64 = ''; // Variável para armazenar o QR Code como imagem

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "lia-crm" }),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

client.on('qr', async (qr) => {
    console.log('⚡ QR CODE GERADO! Acesse /qr no navegador para escanear.');
    qrCodeBase64 = await qrcode.toDataURL(qr); // Converte para imagem Base64
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
});

// Rota para visualizar o QR Code no navegador
app.get('/qr', (req, res) => {
    if (!qrCodeBase64) {
        return res.status(404).send('QR Code ainda não gerado. Aguarde...');
    }
    res.send(`<html><body style="text-align:center;">
                <h2>Escaneie o QR Code para conectar</h2>
                <img src="${qrCodeBase64}" style="width:300px; height:300px;">
              </body></html>`);
});

client.initialize();

app.get('/', (req, res) => {
  res.send('WhatsApp Server is running');
});

app.listen(port, () => {
  console.log(`⚡ Servidor rodando em http://localhost:${port}`);
});
