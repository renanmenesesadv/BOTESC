# Guia de Integração n8n

## Pré-requisitos

1. n8n instalado e rodando (localhost:5678 ou cloud)
2. Python 3.10+ com dependências instaladas (pip install -r requirements.txt)
3. Playwright instalado (playwright install chromium)
4. Credenciais configuradas no n8n:
   - Telegram Bot API
   - Google Drive OAuth2
   - Google Sheets OAuth2
   - Google Calendar OAuth2
   - Header Auth para Anthropic (ANTHROPIC_API_KEY)
   - Header Auth para OpenAI (OPENAI_API_KEY)

## Variáveis de Ambiente no n8n

Configurar em Settings > Variables:

| Variável | Valor |
|---|---|
| ANTHROPIC_API_KEY | sk-ant-... |
| OPENAI_API_KEY | sk-... |
| TELEGRAM_BOT_TOKEN | 123456:ABC... |
| PROJECT_PATH | /caminho/para/automacao-juridica |

## Workflows Necessários

### WF-01: Receber e Classificar Documento
Trigger: Telegram (arquivo recebido)

### WF-02: Cadastrar Cliente
Trigger: Telegram (comando /cliente)

### WF-03: Capturar Prazos DJEN
Trigger: Cron (08h seg-sex)

### WF-04: Agendar Evento
Trigger: Telegram (comando /agendar)

### WF-05: Consultar Prazo
Trigger: Telegram (comando /prazo)
