# 🚀 Guia Passo a Passo: Como colocar seu Bot na Hostinger (24/7)

Como você não é programador, eu preparei este guia com o passo a passo exato (copiar e colar) para tirar o bot do seu computador e colocá-lo no seu servidor VPS da Hostinger, onde ele vai rodar **24 horas por dia, 7 dias por semana**.

---

## Passo 1: Preparar os arquivos

Antes de enviarmos os arquivos para a VPS, você precisa garantir que o arquivo `.env` está preenchido com suas chaves reais:

1. Abra o arquivo `.env` que está na pasta `BOTESC`.
2. Onde diz `TELEGRAM_BOT_TOKEN=SEU_TOKEN_DO_BOTFATHER_AQUI`, cole o token que o BotFather do Telegram te deu.
3. Onde diz `GEMINI_API_KEY=SUA_CHAVE_GEMINI_AQUI`, cole a sua chave do Google AI Studio.
4. Onde diz `WEBHOOK_URL=https://SEU_DOMINIO_OU_IP:5678/`, coloque o IP da sua VPS (Exemplo: `https://192.168.1.100:5678/`). Se você ainda não tem um domínio HTTPS, pode usar o túnel do n8n para testes iniciais, mas é recomendado configurar SSL depois.
5. Salve o arquivo.

---

## Passo 2: Enviar a pasta para a Hostinger

Você tem todos esses arquivos no seu Mac. Mas eles precisam ir para a VPS. A forma mais fácil para quem não é programador é usar o **Gerenciador de Arquivos do painel da Hostinger**:

1. Acesse o painel da sua Hostinger e vá até o seu painel da **VPS**.
2. Clique no **Gerenciador de Arquivos (File Manager)** ou acesse via SFTP (usando um programa como o **FileZilla** ou **Cyberduck** no Mac).
3. Dentro do seu servidor (geralmente na pasta `/root/` ou `/home/`), crie uma nova pasta chamada `bot-escritorio`.
4. Arraste e solte **todo o conteúdo** da sua pasta local `BOTESC` (os arquivos `docker-compose.yml`, `.env`, pasta `postgres`, `bot-api`, etc) para dentro dessa pasta `bot-escritorio` na VPS.
   - *Nota: Garanta que o arquivo `.env` foi enviado (as vezes o Mac oculta arquivos que começam com ponto).*

---

## Passo 3: Ligar o Bot na VPS

Agora vamos dar o comando mágico para o servidor ligar tudo e nunca mais desligar.

1. No painel da Hostinger, na página da sua VPS, procure a opção **Terminal no Navegador** (Browser Terminal) ou conecte-se via SSH pelo terminal do seu Mac digitando: 
   `ssh root@IP_DA_SUA_VPS` e digitando sua senha.
2. Uma vez na tela preta do servidor, digite o comando para entrar na pasta que você criou:
   ```bash
   cd bot-escritorio
   ```
3. Agora, digite o comando mestre para instalar e ligar toda a arquitetura:
   ```bash
   docker compose up -d --build
   ```
   *(Ele vai baixar o banco de dados, o n8n e construir a IA do seu microserviço. Pode demorar uns 5 minutinhos na primeira vez).*

4. Para verificar se está tudo rodando perfeitamente:
   ```bash
   docker compose ps
   ```
   *Você verá `bot-api`, `n8n` e `postgres` com o status `Up`.*

---

## Passo 4: Configurar o n8n e o Gatilho do Telegram

Com tudo rodando no servidor, o seu PC já não precisa mais ficar ligado!

1. Abra o navegador no seu computador e acesse o painel do seu n8n na nuvem:
   `http://IP_DA_SUA_VPS:5678`
2. Crie sua conta de administrador no n8n.
3. Vá no menu esquerdo em **Workflows** e clique em **Add Workflow**.
4. No canto superior direito, clique em **Import from File** e selecione aquele arquivo que está no seu computador: `BOTESC/n8n/workflows/orquestrador_telegram.json`.
5. O n8n vai desenhar os dois nós na tela. 
6. Dê um duplo clique no nó **Telegram Trigger**.
7. Ali dentro, clique para criar uma **Credential**, selecione **Telegram API** e cole o Token do seu Bot.
8. Feche a janela e ative a chavinha verde **"Active"** no topo da tela do n8n.

**🎉 PRONTO!** 

Seu bot está vivo, operando 24 horas por dia na Hostinger. 
Você pode desligar o seu computador. Qualquer hora que alguém enviar um PDF ou mensagem no seu Bot do Telegram, a VPS vai receber a mensagem pelo Webhook, mandar pro microserviço processar pelo Gemini e responder automaticamente no Telegram.
