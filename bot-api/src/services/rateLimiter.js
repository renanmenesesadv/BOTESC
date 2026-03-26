// Rate limiter simples por usuário
const limits = new Map();
const MAX_REQUESTS = 30;   // máximo por janela
const WINDOW_MS = 60000;   // janela de 1 minuto

function checkLimit(userId) {
  const now = Date.now();
  let entry = limits.get(userId);

  if (!entry || now - entry.start > WINDOW_MS) {
    entry = { start: now, count: 0 };
    limits.set(userId, entry);
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    return false; // bloqueado
  }
  return true; // permitido
}

function getRemainingTime(userId) {
  const entry = limits.get(userId);
  if (!entry) return 0;
  const remaining = WINDOW_MS - (Date.now() - entry.start);
  return Math.max(0, Math.ceil(remaining / 1000));
}

module.exports = { checkLimit, getRemainingTime };
