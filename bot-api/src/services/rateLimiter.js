/**
 * Rate Limiter — controla requisições por minuto e documentos por hora.
 * Lê limites de config/security_rules.json.
 */
const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../../../config/security_rules.json');
let rules = { rate_limit: { max_requests_per_minute: 10, max_documents_per_hour: 50 } };
try {
  rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
} catch (e) {
  console.warn('[rateLimiter] Não foi possível carregar security_rules.json, usando padrões.');
}

const MAX_REQ_PER_MIN = rules.rate_limit?.max_requests_per_minute || 10;
const MAX_DOCS_PER_HOUR = rules.rate_limit?.max_documents_per_hour || 50;

// Map<chatId, { requests: [{ts}], documents: [{ts}] }>
const trackers = new Map();

function getTracker(chatId) {
  if (!trackers.has(chatId)) {
    trackers.set(chatId, { requests: [], documents: [] });
  }
  return trackers.get(chatId);
}

function cleanOld(arr, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  while (arr.length > 0 && arr[0] < cutoff) {
    arr.shift();
  }
}

/**
 * Verifica se o chat pode enviar mais uma requisição (texto/comando).
 * @returns {{ allowed: boolean, retryAfterSec?: number }}
 */
function checkRequestLimit(chatId) {
  const tracker = getTracker(chatId);
  cleanOld(tracker.requests, 60_000); // janela de 1 minuto

  if (tracker.requests.length >= MAX_REQ_PER_MIN) {
    const oldest = tracker.requests[0];
    const retryAfter = Math.ceil((oldest + 60_000 - Date.now()) / 1000);
    return { allowed: false, retryAfterSec: retryAfter };
  }

  tracker.requests.push(Date.now());
  return { allowed: true };
}

/**
 * Verifica se o chat pode enviar mais um documento.
 * @returns {{ allowed: boolean, retryAfterSec?: number, count: number }}
 */
function checkDocumentLimit(chatId) {
  const tracker = getTracker(chatId);
  cleanOld(tracker.documents, 3_600_000); // janela de 1 hora

  if (tracker.documents.length >= MAX_DOCS_PER_HOUR) {
    const oldest = tracker.documents[0];
    const retryAfter = Math.ceil((oldest + 3_600_000 - Date.now()) / 1000 / 60);
    return { allowed: false, retryAfterMin: retryAfter, count: tracker.documents.length };
  }

  tracker.documents.push(Date.now());
  return { allowed: true, count: tracker.documents.length };
}

/**
 * Retorna stats do rate limiter para um chat.
 */
function getStats(chatId) {
  const tracker = getTracker(chatId);
  cleanOld(tracker.requests, 60_000);
  cleanOld(tracker.documents, 3_600_000);
  return {
    requests_last_minute: tracker.requests.length,
    max_requests_per_minute: MAX_REQ_PER_MIN,
    documents_last_hour: tracker.documents.length,
    max_documents_per_hour: MAX_DOCS_PER_HOUR,
  };
}

module.exports = { checkRequestLimit, checkDocumentLimit, getStats };
