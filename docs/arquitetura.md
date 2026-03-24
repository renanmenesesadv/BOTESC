# Arquitetura do Sistema

## Visão Geral

Sistema de automação jurídica com bot Telegram, classificação por IA e organização no Google Drive/Sheets.

## Camadas

### Camada 1 — Código (`bot/` e `workers/`)
- `bot/` — Interface Telegram (handlers, keyboards, middlewares)
- `workers/` — Scripts técnicos (IA, OCR, browser, Google APIs, matching)

### Camada 2 — Workflows (`n8n/`)
- Workflows exportados como JSON, versionados no Git
- Editáveis pelo Claude no Cursor, importáveis no n8n

### Camada 3 — Deploy
- Docker Compose na VPS Hostinger
- PostgreSQL + Bot API + n8n

## Fluxo Principal (Documento)

```
Telegram (foto/PDF)
    ↓
Bot recebe via polling
    ↓
Worker IA classifica (Gemini → Claude fallback)
    ↓
Worker matching identifica cliente (novo/existente)
    ↓
Worker Drive cria pasta e faz upload
    ↓
Worker Sheets registra dados
    ↓
Bot responde com resumo + link
```

## Regra de Atualização

| O que mudar | Onde mexer |
|---|---|
| Interface do usuário | `bot/` |
| Script técnico | `workers/` |
| Lógica da IA | `prompts/` |
| Regra de negócio | `config/` |
| Automação/orquestração | `n8n/` |
