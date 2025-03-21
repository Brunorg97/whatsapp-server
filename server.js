
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "lia-crm" }),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

client.on('qr', qr => {
    console.log('⚡ QR CODE GERADO! Escaneie com seu WhatsApp:');
    console.log(qr); // Adiciona o código bruto
    qrcode.generate(qr, { small: true }); // Renderiza o QR no terminal

});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
});

client.initialize();

app.get('/', (req, res) => {
  res.send('WhatsApp Server is running');
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
