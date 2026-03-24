# Fluxos Operacionais

## 1. Recebimento de Documento

1. Usuário envia foto ou PDF no Telegram
2. Bot baixa o arquivo
3. IA (Gemini/Claude) classifica e extrai dados
4. Sistema busca cliente por CPF → nome
5. Se novo: cria pasta no Drive + registro na planilha
6. Se existente: usa pasta existente + atualiza dados
7. Upload do arquivo no Drive (numerado)
8. Registro no PostgreSQL
9. Resposta ao usuário com resumo

## 2. Busca de Cliente

1. Usuário envia `/cliente João Silva`
2. Bot busca no PostgreSQL por nome
3. Retorna dados + link do Drive

## 3. (Futuro) Prazos

1. Worker navega no DJEN/PJe via Playwright
2. IA extrai prazos da publicação
3. Bot notifica o advogado
4. Cria evento no Calendar

## 4. (Futuro) Agenda

1. Usuário envia `/agendar 2026-04-01 14:00 Audiência`
2. Worker cria evento no Google Calendar
3. Bot confirma
