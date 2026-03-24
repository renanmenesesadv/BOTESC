# Deploy na Hostinger — Guia Completo

## Plano Recomendado

**Hostinger VPS KVM 2** (ou superior):
- 2 vCPU
- 8 GB RAM
- 100 GB SSD
- Ubuntu 22.04
- Acesso root SSH

> Planos compartilhados NÃO servem. Precisa de VPS para rodar n8n + Python + Playwright.

---

## PASSO 1 — Comprar e acessar VPS

1. Acesse: https://www.hostinger.com.br/servidor-vps
2. Escolha plano KVM 2 ou superior
3. Sistema operacional: **Ubuntu 22.04**
4. Após ativação, vá em: hPanel > VPS > Gerenciar
5. Anote:
   - IP do servidor
   - Senha root (ou configure SSH key)

### Acessar via SSH

```bash
ssh root@SEU_IP_AQUI
```

---

## PASSO 2 — Configurar servidor

### 2.1 Atualizar sistema

```bash
apt update && apt upgrade -y
```

### 2.2 Criar usuário (não usar root no dia a dia)

```bash
adduser botjuridico
usermod -aG sudo botjuridico
su - botjuridico
```

### 2.3 Instalar Python 3.11

```bash
sudo apt install -y software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev
```

### 2.4 Instalar Tesseract OCR

```bash
sudo apt install -y tesseract-ocr tesseract-ocr-por
```

### 2.5 Instalar Poppler (PDF)

```bash
sudo apt install -y poppler-utils
```

### 2.6 Instalar Node.js 20 (para n8n)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2.7 Instalar PM2 (gerenciador de processos)

```bash
sudo npm install -g pm2
```

### 2.8 Instalar n8n

```bash
sudo npm install -g n8n
```

### 2.9 Instalar Git

```bash
sudo apt install -y git
```

### 2.10 Instalar dependências do Playwright

```bash
sudo apt install -y libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2 libxshmfence1
```

---

## PASSO 3 — Clonar projeto

```bash
su - botjuridico
cd ~
git clone https://github.com/SEU_USUARIO/BOTESC.git
cd BOTESC/automacao-juridica
```

### 3.1 Criar ambiente virtual

```bash
python3.11 -m venv .venv
source .venv/bin/activate
```

### 3.2 Instalar dependências

```bash
pip install -r requirements.txt
playwright install chromium
```

### 3.3 Configurar .env

```bash
cp .env.example .env
nano .env
```

Preencha todas as variáveis. Gere a chave de ativação:

```bash
python3.11 -c "import uuid; print(uuid.uuid4())"
```

---

## PASSO 4 — Configurar n8n como serviço 24/7

### 4.1 Variáveis de ambiente do n8n

```bash
nano ~/.n8n_env
```

Conteúdo:

```bash
export N8N_PORT=5678
export N8N_PROTOCOL=http
export N8N_HOST=0.0.0.0
export WEBHOOK_URL=http://SEU_IP:5678/
export N8N_BASIC_AUTH_ACTIVE=true
export N8N_BASIC_AUTH_USER=admin
export N8N_BASIC_AUTH_PASSWORD=SUA_SENHA_FORTE_AQUI
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-proj-...
export SYSTEM_ACTIVATION_KEY=sua-uuid-aqui
export PROJECT_PATH=/home/botjuridico/BOTESC/automacao-juridica
```

### 4.2 Iniciar n8n com PM2

```bash
source ~/.n8n_env
pm2 start n8n --name "n8n-juridico" -- start
pm2 save
pm2 startup
```

> PM2 reinicia o n8n automaticamente se ele cair ou se o servidor reiniciar.

### 4.3 Verificar se está rodando

```bash
pm2 status
pm2 logs n8n-juridico
```

Acesse: `http://SEU_IP:5678`

---

## PASSO 5 — Configurar firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 5678/tcp  # n8n
sudo ufw enable
```

---

## PASSO 6 — Configurar domínio + HTTPS (opcional mas recomendado)

### 6.1 Instalar Nginx

```bash
sudo apt install -y nginx
```

### 6.2 Configurar proxy reverso

```bash
sudo nano /etc/nginx/sites-available/n8n
```

Conteúdo:

```nginx
server {
    listen 80;
    server_name n8n.seudominio.com.br;

    location / {
        proxy_pass http://localhost:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 6.3 Instalar SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d n8n.seudominio.com.br
```

Depois atualize WEBHOOK_URL no `.n8n_env`:
```
export WEBHOOK_URL=https://n8n.seudominio.com.br/
```

Reinicie:
```bash
pm2 restart n8n-juridico
```

---

## PASSO 7 — Configurar Telegram Webhook

Após n8n estar rodando com URL pública, configure o webhook do Telegram:

No n8n, ao ativar o workflow com Telegram Trigger, ele registra o webhook automaticamente.

Se precisar registrar manualmente:

```bash
curl -X POST "https://api.telegram.org/botSEU_TOKEN/setWebhook" \
  -d "url=https://n8n.seudominio.com.br/webhook/telegram"
```

---

## PASSO 8 — Monitoramento

### 8.1 Ver logs do n8n

```bash
pm2 logs n8n-juridico
pm2 logs n8n-juridico --lines 100
```

### 8.2 Monitorar recursos

```bash
pm2 monit
htop
```

### 8.3 Configurar alerta se cair

```bash
pm2 install pm2-slack
# ou configure webhook no PM2 para alertar via Telegram
```

### 8.4 Backup automático

Adicione ao crontab:

```bash
crontab -e
```

```cron
# Backup diário às 23h
0 23 * * * cd /home/botjuridico/BOTESC && git add -A && git commit -m "backup $(date +\%Y-\%m-\%d)" && git push origin main 2>/dev/null
```

---

## PASSO 9 — Atualizar o sistema

Quando fizer mudanças no código:

```bash
ssh botjuridico@SEU_IP
cd ~/BOTESC
git pull origin main
cd automacao-juridica
source .venv/bin/activate
pip install -r requirements.txt
pm2 restart n8n-juridico
```

---

## Arquitetura na Hostinger

```
┌─────────────────────────────────────────────────┐
│            Hostinger VPS (Ubuntu 22.04)          │
│                                                  │
│  ┌──────────────┐     ┌──────────────────────┐  │
│  │    Nginx      │────▶│   n8n (PM2)          │  │
│  │  :80 / :443   │     │   :5678              │  │
│  └──────────────┘     │                      │  │
│                        │  ┌────────────────┐  │  │
│                        │  │ Telegram       │  │  │
│                        │  │ Webhook        │  │  │
│                        │  └────────────────┘  │  │
│                        │          │           │  │
│                        │          ▼           │  │
│                        │  ┌────────────────┐  │  │
│                        │  │ Execute Cmd    │  │  │
│                        │  │ Python scripts │  │  │
│                        │  └────────────────┘  │  │
│                        └──────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  /home/botjuridico/BOTESC/               │   │
│  │    automacao-juridica/                    │   │
│  │      workers/  prompts/  config/  data/   │   │
│  │      .venv/                               │   │
│  └──────────────────────────────────────────┘   │
│                        │                         │
│                        ▼                         │
│              Google APIs (Drive/Sheets/Calendar)  │
│              Anthropic API (Claude)               │
│              OpenAI API (GPT Vision)              │
└─────────────────────────────────────────────────┘
```

---

## Custos Estimados (mensal)

| Item | Custo |
|---|---|
| Hostinger VPS KVM 2 | ~R$ 50-80/mês |
| Anthropic (Claude Haiku) | ~R$ 5-20/mês (uso moderado) |
| OpenAI (GPT Vision) | ~R$ 5-15/mês (só fallback) |
| Google APIs | Grátis (dentro dos limites) |
| Telegram Bot | Grátis |
| Domínio (opcional) | ~R$ 40/ano |
| **Total estimado** | **~R$ 60-120/mês** |
