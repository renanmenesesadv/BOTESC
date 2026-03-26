require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '50mb' }));

const port = process.env.BOT_API_PORT || 3000;

// Database Connection
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.DB_HOST || 'postgres',
  database: process.env.POSTGRES_DB || 'n8n_docs',
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', microservice: 'Bot API running' });
});

// Rotas HTTP (para uso via n8n/webhook)
const telegramRoutes = require('./controllers/telegramController');
app.use('/telegram', telegramRoutes(pool));

app.listen(port, () => {
  console.log(`Bot API listening at http://localhost:${port}`);

  // Inicializar chat com persistência no banco
  const { initChat } = require('./services/chatService');
  initChat(pool);

  // Iniciar polling do Telegram (funciona sem SSL/webhook)
  const { createProcessor } = require('./controllers/telegramController');
  const startPolling = require('./services/telegramPolling');
  const processUpdate = createProcessor(pool);
  startPolling(pool, processUpdate).catch(err => {
    console.error('[FATAL] Polling crashed:', err.message, err.stack);
  });
});
