# Guia de Implantação — Automação Jurídica

## FASE 1: Telegram Bot
## FASE 2: APIs e Credenciais
## FASE 3: Google Workspace
## FASE 4: Servidor Python
## FASE 5: n8n
## FASE 6: Workflows
## FASE 7: Teste completo

Detalhes em cada seção abaixo.

---

## FASE 1 — CRIAR BOT NO TELEGRAM

### 1.1 Abrir @BotFather

1. Abra o Telegram
2. Pesquise: `@BotFather`
3. Clique em START

### 1.2 Criar o bot

Envie os comandos na ordem:

```
/newbot
```

BotFather pergunta: **"Alright, a new bot. How are we going to call it?"**

Responda:
```
Jurídico Bot
```

BotFather pergunta: **"Good. Now let's choose a username..."**

Responda (deve terminar em "bot"):
```
escritorio_juridico_bot
```

BotFather responde com o **TOKEN**. Exemplo:
```
7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**COPIE E GUARDE ESSE TOKEN.**

### 1.3 Configurar comandos do bot

Envie para o @BotFather:

```
/setcommands
```

Selecione seu bot, depois envie:

```
start - Iniciar o bot
cliente - Cadastrar novo cliente
documento - Enviar documento para classificar
agendar - Agendar evento no calendário
prazo - Consultar prazos pendentes
buscar - Buscar cliente ou processo
status - Resumo do dia
ajuda - Ver comandos detalhados
```

### 1.4 Configurar descrição

```
/setdescription
```

Envie:
```
Assistente de automação jurídica. Classificação de documentos, controle de prazos e organização de processos.
```

### 1.5 Configurar foto do bot (opcional)

```
/setuserpic
```

Envie uma imagem (ícone de balança da justiça, por exemplo).

### 1.6 Descobrir seu Telegram ID

1. Pesquise: `@userinfobot` no Telegram
2. Envie /start
3. Ele responde com seu ID numérico (ex: 123456789)
4. **Anote esse número** — é seu admin ID

### 1.7 Descobrir IDs dos outros usuários

Cada pessoa que vai usar o bot deve:
1. Abrir @userinfobot
2. Enviar /start
3. Enviar o ID para você

---

## FASE 2 — OBTER APIs E CREDENCIAIS

### 2.1 Anthropic (Claude)

1. Acesse: https://console.anthropic.com/
2. Crie uma conta (se não tiver)
3. Vá em: API Keys
4. Clique: Create Key
5. Nome: "automacao-juridica"
6. Copie a chave: `sk-ant-api03-...`

### 2.2 OpenAI (GPT Vision)

1. Acesse: https://platform.openai.com/
2. Crie uma conta (se não tiver)
3. Vá em: API Keys
4. Clique: Create new secret key
5. Nome: "automacao-juridica"
6. Copie a chave: `sk-proj-...`

### 2.3 Google Cloud (Drive + Sheets + Calendar)

#### 2.3.1 Criar projeto

1. Acesse: https://console.cloud.google.com/
2. Clique: "Select a project" (topo da página)
3. Clique: "NEW PROJECT"
4. Nome: "automacao-juridica"
5. Clique: CREATE

#### 2.3.2 Ativar APIs

No painel do projeto, vá em "APIs & Services" > "Enable APIs":

Ative estas 3 APIs (pesquise uma por uma):
- Google Drive API
- Google Sheets API
- Google Calendar API

#### 2.3.3 Criar credenciais OAuth2

1. Vá em: "APIs & Services" > "Credentials"
2. Clique: "CREATE CREDENTIALS" > "OAuth client ID"
3. Se pedir "Configure consent screen":
   - User Type: External (ou Internal se for Google Workspace)
   - App name: "Automação Jurídica"
   - Email: seu email
   - Salve
4. Volte em Credentials > Create OAuth client ID
5. Application type: "Desktop app"
6. Nome: "n8n-juridico"
7. Clique: CREATE
8. Baixe o JSON (botão de download)
9. Salve como: `config/google_credentials.json`

---

## FASE 3 — CONFIGURAR GOOGLE WORKSPACE

### 3.1 Criar estrutura no Google Drive

1. Abra o Google Drive
2. Crie a pasta raiz: `ESCRITÓRIO JURÍDICO`
3. Dentro dela, crie:

```
📁 ESCRITÓRIO JURÍDICO
├── 📁 00 - SISTEMA
│   ├── 📁 Templates
│   ├── 📁 Backups
│   └── 📁 Logs
├── 📁 01 - CLIENTES ATIVOS
├── 📁 02 - CLIENTES INATIVOS
└── 📁 03 - CLIENTES ARQUIVADOS
```

4. Copie o ID da pasta "ESCRITÓRIO JURÍDICO":
   - Abra a pasta
   - A URL será: `https://drive.google.com/drive/folders/XXXXXXXXXXXXX`
   - O ID é o `XXXXXXXXXXXXX` no final

### 3.2 Criar planilha no Google Sheets

1. Acesse: https://sheets.google.com
2. Crie uma nova planilha
3. Nome: `AUTOMAÇÃO JURÍDICA — BASE`
4. Renomeie a primeira aba para: `CLIENTES`
5. Crie mais 4 abas (clique no "+" no rodapé):
   - `PRAZOS`
   - `DOCUMENTOS`
   - `LOGS`
   - `USUARIOS`

### 3.3 Configurar cabeçalhos — aba CLIENTES

Na linha 1, escreva (uma coluna por célula):

```
ID | NOME | CPF | RG | TELEFONE | EMAIL | ENDERECO | PASTA_DRIVE_ID | PROCESSOS | STATUS | DATA_CADASTRO | CADASTRADO_POR | OBSERVACOES
```

### 3.4 Configurar cabeçalhos — aba PRAZOS

```
ID | DATA_PUBLICACAO | DATA_LIMITE | PROCESSO | CLIENTE_ID | CLIENTE | TIPO_ATO | ACAO | PRAZO_DIAS | URGENCIA | STATUS | EVENTO_CALENDAR_ID | ORIGEM | CRIADO_EM | DETALHES
```

### 3.5 Configurar cabeçalhos — aba DOCUMENTOS

```
ID | DATA | CLIENTE_ID | CLIENTE | CPF | TIPO | PASTA | CONFIANCA | METODO_OCR | MATCH | ARQUIVO | DRIVE_FILE_ID | PROCESSO | ENVIADO_POR | RESUMO
```

### 3.6 Configurar cabeçalhos — aba LOGS

```
TIMESTAMP | ACAO | USUARIO | RESULTADO | DETALHES | IP_ORIGEM | DURACAO_MS
```

### 3.7 Configurar cabeçalhos — aba USUARIOS

```
TELEGRAM_ID | NOME | ROLE | ATIVO | DATA_CADASTRO | ULTIMO_ACESSO
```

### 3.8 Cadastrar primeiro usuário (você)

Na aba USUARIOS, preencha a linha 2:

```
SEU_TELEGRAM_ID | Seu Nome | admin | TRUE | 24/03/2026 |
```

### 3.9 Copiar ID da planilha

A URL será: `https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXX/edit`
O ID é o `XXXXXXXXXXXXX`.

### 3.10 Formatação condicional — aba PRAZOS (opcional mas recomendado)

1. Selecione a coluna URGENCIA (J)
2. Formatar > Formatação condicional
3. Adicione regras:
   - Texto é "critica" → fundo vermelho, texto branco
   - Texto é "alta" → fundo laranja, texto branco
   - Texto é "media" → fundo amarelo, texto preto
   - Texto é "baixa" → fundo verde, texto branco

---

## FASE 4 — INSTALAR SERVIDOR PYTHON

### 4.1 Instalar Python (se não tiver)

macOS:
```bash
brew install python@3.11
```

### 4.2 Instalar Tesseract OCR

macOS:
```bash
brew install tesseract tesseract-lang
```

### 4.3 Instalar Poppler (para PDF)

macOS:
```bash
brew install poppler
```

### 4.4 Criar ambiente virtual

```bash
cd /caminho/para/automacao-juridica
python3 -m venv .venv
source .venv/bin/activate
```

### 4.5 Instalar dependências Python

```bash
pip install -r requirements.txt
```

### 4.6 Instalar Playwright

```bash
playwright install chromium
```

### 4.7 Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com seus dados reais.

### 4.8 Gerar chave de ativação

```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

Copie o resultado para SYSTEM_ACTIVATION_KEY no `.env`.

### 4.9 Testar OCR

```bash
source .venv/bin/activate
python workers/ocr/reader.py /caminho/para/um/pdf/teste.pdf
```

Deve retornar JSON com o texto extraído.

---

## FASE 5 — INSTALAR E CONFIGURAR n8n

### 5.1 Instalar n8n

```bash
npm install -g n8n
```

Ou via Docker:
```bash
docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n n8nio/n8n
```

### 5.2 Iniciar n8n

```bash
n8n start
```

Acesse: http://localhost:5678

### 5.3 Criar conta admin no n8n

Na primeira vez, crie email e senha.

### 5.4 Configurar credenciais no n8n

Vá em: Settings > Credentials

#### Telegram API:
1. Add Credential > Telegram API
2. Access Token: cole o token do BotFather
3. Save

#### Google OAuth2:
1. Add Credential > Google OAuth2 API
2. Client ID: do google_credentials.json
3. Client Secret: do google_credentials.json
4. Clique "Connect" e autorize com sua conta Google
5. Save

(Use a mesma credencial Google para Drive, Sheets e Calendar)

### 5.5 Configurar variáveis no n8n

Vá em: Settings > Variables

Adicione:

| Variable        | Value                                |
|-----------------|--------------------------------------|
| PROJECT_PATH    | /caminho/completo/automacao-juridica |
| DRIVE_ROOT_ID   | ID da pasta raiz do Drive            |
| SHEETS_ID       | ID da planilha                       |
| ADMIN_CHAT_ID   | Seu Telegram ID                      |

### 5.6 Configurar variáveis de ambiente do n8n

No terminal onde roda o n8n, exporte:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-proj-..."
export SYSTEM_ACTIVATION_KEY="sua-uuid-aqui"
```

Ou adicione ao arquivo de inicialização do n8n.

---

## FASE 6 — MONTAR WORKFLOWS NO n8n

### WORKFLOW 1: Receber e Classificar Documento

Crie um novo workflow no n8n. Adicione os nodes na ordem:

#### Node 1: Telegram Trigger
- Type: Telegram Trigger
- Credential: sua credencial Telegram
- Updates: Message
- Additional Fields > Filter: Document, Photo

#### Node 2: Validar Usuário (Execute Command)
- Command:
```
cd {{ $env.PROJECT_PATH }} && source .venv/bin/activate && python workers/n8n/auth.py "{{ $json.message.from.id }}" "enviar_documento"
```

#### Node 3: IF — Autorizado?
- Condition: `{{ JSON.parse($('Validar Usuário').first().json.stdout).autorizado }}` equals `true`
- True → continua
- False → Node "Bloquear"

#### Node 4: Bloquear (Telegram Send Message)
- Chat ID: `{{ $json.message.chat.id }}`
- Text: `{{ JSON.parse($('Validar Usuário').first().json.stdout).mensagem }}`
- (conecte aqui o fim do fluxo falso)

#### Node 5: Telegram — Aviso "Processando"
- Operation: Send Message
- Chat ID: `{{ $json.message.chat.id }}`
- Text: `🔄 Documento recebido! Processando...`

#### Node 6: Telegram — Download File
- Operation: Get File
- File ID: `{{ $json.message.document ? $json.message.document.file_id : $json.message.photo[$json.message.photo.length - 1].file_id }}`

#### Node 7: Write Binary File
- File Name: `{{ $env.PROJECT_PATH }}/data/temp/{{ $json.message.document ? $json.message.document.file_name : 'foto_' + Date.now() + '.jpg' }}`

#### Node 8: OCR (Execute Command)
- Command:
```
cd {{ $env.PROJECT_PATH }} && source .venv/bin/activate && python workers/ocr/reader.py "data/temp/{{ $json.fileName }}"
```

#### Node 9: IF — Precisa Fallback?
- Condition: `{{ JSON.parse($json.stdout).precisa_fallback }}` equals `true`

#### Node 10 (rota true): GPT Vision (Execute Command)
- Command:
```
cd {{ $env.PROJECT_PATH }} && source .venv/bin/activate && python workers/ocr/vision_fallback.py "data/temp/{{ $json.fileName }}"
```

#### Node 11: Merge
- Mode: Choose Branch
- (recebe OCR direto pela rota false e GPT Vision pela rota true)

#### Node 12: Classificar (Execute Command)
- Command:
```
cd {{ $env.PROJECT_PATH }} && source .venv/bin/activate && python workers/n8n/classify.py "{{ JSON.parse($json.stdout).texto.substring(0, 3000) }}"
```

#### Node 13: Match Cliente (Execute Command)
- Command:
```
cd {{ $env.PROJECT_PATH }} && source .venv/bin/activate && python workers/n8n/client_match.py '{{ JSON.stringify({nome_cliente: JSON.parse($json.stdout).classificacao.nome_cliente, cpf: JSON.parse($json.stdout).classificacao.cpf, numero_processo: JSON.parse($json.stdout).classificacao.numero_processo || ""}) }}'
```

#### Node 14: Switch — Match Result
- Value: `{{ JSON.parse($json.stdout).match }}`
- Rules:
  - "forte" → Output 0
  - "provavel" → Output 1
  - "ambiguo" → Output 2
  - "nao_encontrado" → Output 3

#### Node 15 (Output 0): Google Drive Upload
- Operation: Upload
- Folder: pasta do cliente + categoria
- File Name: tipo_documento + nome + data

#### Node 16: Google Sheets Append (DOCUMENTOS)
- Sheet: DOCUMENTOS
- Colunas mapeadas conforme sheets_structure.json

#### Node 17: Telegram — Resposta OK
- Text: `✅ Documento classificado!\n\n📄 Tipo: ...\n👤 Cliente: ...\n📁 Pasta: ...`

#### Node 18: Google Sheets Append (LOGS)
- Sheet: LOGS
- Sempre executado (conecte todas as rotas aqui)

---

### WORKFLOW 2: Cadastrar Cliente

#### Node 1: Telegram Trigger
- Filter: mensagens de texto

#### Node 2: IF — Começa com /cliente?
- Condition: text starts with "/cliente"

#### Node 3: Telegram Send Message
- Text: pede dados (nome, CPF, tel, email)

#### Node 4: Telegram Trigger (2º)
- Espera próxima mensagem

#### Node 5: Code Node — Parsear dados
```javascript
const texto = $input.first().json.message.text;
const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

const cliente = {
  id: 'cli-' + Date.now(),
  nome_completo: linhas[0] || '',
  cpf: linhas[1] || '',
  telefone: linhas[2] || '',
  email: linhas[3] || '',
  status: 'ativo',
  data_cadastro: new Date().toISOString(),
  cadastrado_por: $input.first().json.message.from.id.toString(),
  chat_id: $input.first().json.message.chat.id
};

const cpfLimpo = cliente.cpf.replace(/[^0-9]/g, '');
cliente.cpf_valido = cpfLimpo.length === 11;

return [{json: cliente}];
```

#### Node 6: IF — CPF válido?

#### Node 7: Google Drive — Criar pasta
- Nome: `{{ $json.nome_completo }} - {{ $json.cpf }}`
- Parent: ID da pasta "01 - CLIENTES ATIVOS"

#### Node 8: Code Node — Gerar subpastas
```javascript
const pastas = [
  '00 - Entrada',
  '01 - Protocolo',
  '02 - Medicos',
  '03 - Processual',
  '04 - Contratos'
];

return pastas.map(p => ({
  json: {
    nome_pasta: p,
    parent_id: $input.first().json.id
  }
}));
```

#### Node 9: Loop — Google Drive Create Folder (para cada subpasta)

#### Node 10: Google Sheets Append (CLIENTES)

#### Node 11: Telegram — Confirmar cadastro

---

### WORKFLOW 3: Capturar Prazos DJEN

#### Node 1: Schedule Trigger
- Cron: `0 8 * * 1-5` (08h, seg-sex)

#### Node 2: Execute Command — Playwright
```
cd {{ $env.PROJECT_PATH }} && source .venv/bin/activate && python workers/browser/djen.py
```

#### Node 3: IF — Tem publicações?

#### Node 4: Split In Batches (1 por vez)

#### Node 5: Execute Command — Extract Deadline

#### Node 6: IF — Tem prazos?

#### Node 7: Split In Batches — Loop prazos

#### Node 8: Execute Command — Client Match

#### Node 9: Switch — Match result

#### Node 10: Google Sheets (PRAZOS)

#### Node 11: Google Calendar — Criar evento

#### Node 12: Telegram — Alerta

#### Node 13: Google Sheets (LOGS)

---

### WORKFLOW 4: Agendar Evento

(Mesmo padrão do WF-02: trigger → pedir dados → parsear → Calendar → Sheets → confirmar)

### WORKFLOW 5: Consultar Prazos

(Trigger → extrair filtro → Sheets lookup → formatar → enviar)

---

## FASE 7 — TESTE COMPLETO

### Teste 1: Bot responde?
1. Abra seu bot no Telegram
2. Envie /start
3. Deve responder com menu de comandos

### Teste 2: Segurança funciona?
1. Peça a alguém NÃO cadastrado enviar /start
2. Deve receber "Acesso não autorizado"

### Teste 3: Cadastro de cliente
1. Envie /cliente
2. Siga as instruções
3. Verifique: pasta criada no Drive? Linha no Sheets?

### Teste 4: Classificação de documento
1. Envie um PDF de teste (laudo médico, petição, etc)
2. Verifique: OCR extraiu texto? Claude classificou? Drive recebeu?

### Teste 5: Consulta de prazo
1. Envie /prazo
2. Deve listar prazos pendentes (se houver)

### Teste 6: DJEN (manual)
1. Execute: python workers/browser/djen.py
2. Faça login manualmente
3. Verifique se extraiu publicações
