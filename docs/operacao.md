# Operação do Sistema

## Deploy

```bash
# Na VPS
cd /root/bot-escritorio
docker compose up -d --build
```

## Verificar status

```bash
docker compose ps
docker compose logs --tail=20 bot-api
```

## Reiniciar bot

```bash
docker compose restart bot-api
```

## Atualizar código

```bash
# No Mac, copiar arquivos para VPS
scp -r ./bot-api/src root@168.231.90.28:/root/bot-escritorio/bot-api/
scp .env root@168.231.90.28:/root/bot-escritorio/

# Na VPS, rebuild
cd /root/bot-escritorio
docker compose up -d --build bot-api
```

## Variáveis de ambiente necessárias

| Variável | Descrição |
|----------|-----------|
| TELEGRAM_BOT_TOKEN | Token do BotFather |
| GEMINI_API_KEY | Chave do Google AI Studio |
| ANTHROPIC_API_KEY | Chave da Anthropic (fallback) |
| GOOGLE_CLIENT_ID | OAuth client ID |
| GOOGLE_CLIENT_SECRET | OAuth secret |
| GOOGLE_REFRESH_TOKEN | Gerado via script |
| GOOGLE_DRIVE_ROOT_FOLDER_ID | ID da pasta raiz no Drive |
| GOOGLE_SHEET_ID | ID da planilha Sheets |
| POSTGRES_USER | Usuário do banco |
| POSTGRES_PASSWORD | Senha do banco |
