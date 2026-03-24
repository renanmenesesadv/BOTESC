const axios = require('axios');

module.exports = async function startPolling(pool, processUpdate) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const API = `https://api.telegram.org/bot${TOKEN}`;
  let offset = 0;

  // 1. Remover webhook
  try {
    const delRes = await axios.post(`${API}/deleteWebhook`, { drop_pending_updates: false });
    console.log('[POLL] Webhook removido:', JSON.stringify(delRes.data));
  } catch (e) {
    console.log('[POLL] Aviso webhook:', e.message);
  }

  // 2. Verificar bot
  try {
    const meRes = await axios.get(`${API}/getMe`);
    console.log('[POLL] Bot:', meRes.data.result.username);
  } catch (e) {
    console.log('[POLL] ERRO getMe:', e.message);
    return;
  }

  // 3. Aguardar antes de iniciar
  console.log('[POLL] Aguardando 3s antes de iniciar polling...');
  await new Promise(r => setTimeout(r, 3000));
  console.log('[POLL] Iniciando loop de polling...');

  // 4. Loop de polling
  let loopCount = 0;
  while (true) {
    loopCount++;
    try {
      const url = `${API}/getUpdates?offset=${offset}&timeout=10&allowed_updates=${encodeURIComponent(JSON.stringify(['message','callback_query']))}`;

      if (loopCount <= 3 || loopCount % 10 === 0) {
        console.log(`[POLL] Loop #${loopCount} - chamando getUpdates (offset=${offset})...`);
      }

      const res = await axios.get(url, { timeout: 15000 });

      if (!res.data.ok) {
        console.log('[POLL] Resposta não-ok:', JSON.stringify(res.data));
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const updates = res.data.result;

      if (updates && updates.length > 0) {
        console.log(`[POLL] *** RECEBIDO ${updates.length} update(s)! ***`);
        for (const update of updates) {
          offset = update.update_id + 1;
          console.log(`[POLL] Update ${update.update_id}:`, JSON.stringify(update).substring(0, 200));
          try {
            await processUpdate(update);
            console.log(`[POLL] Update ${update.update_id} processado OK`);
          } catch (err) {
            console.error(`[POLL] ERRO processando:`, err.message, err.stack);
          }
        }
      } else if (loopCount <= 3) {
        console.log(`[POLL] Loop #${loopCount} - sem updates (normal, aguardando mensagens...)`);
      }

    } catch (err) {
      const status = err.response?.status;
      if (status === 409) {
        console.log('[POLL] Conflito 409 - outro processo usando getUpdates. Aguardando 10s...');
        await new Promise(r => setTimeout(r, 10000));
      } else if (err.code === 'ECONNABORTED') {
        // Timeout normal, ignorar
      } else {
        console.error('[POLL] ERRO:', err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
};
