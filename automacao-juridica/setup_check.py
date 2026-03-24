"""
Setup Check — Verifica se todas as dependências e configurações estão prontas.

Uso:
    python setup_check.py

Executa uma checklist completa e mostra o que falta configurar.
"""

import json
import os
import sys
import shutil
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent

CHECKS = {
    "passed": [],
    "failed": [],
    "warnings": [],
}


def check(nome: str, condicao: bool, erro: str = "", aviso: bool = False):
    """Registra resultado de uma verificação."""
    if condicao:
        CHECKS["passed"].append(nome)
    elif aviso:
        CHECKS["warnings"].append(f"{nome}: {erro}")
    else:
        CHECKS["failed"].append(f"{nome}: {erro}")


def verificar_python():
    """Verifica versão do Python."""
    v = sys.version_info
    check(
        "Python 3.10+",
        v.major == 3 and v.minor >= 10,
        f"Versão atual: {v.major}.{v.minor}. Precisa 3.10+"
    )


def verificar_dependencias():
    """Verifica se pacotes Python estão instalados."""
    pacotes = {
        "pytesseract": "pip install pytesseract",
        "PIL": "pip install Pillow",
        "pdf2image": "pip install pdf2image",
        "anthropic": "pip install anthropic",
        "openai": "pip install openai",
        "playwright": "pip install playwright",
        "dotenv": "pip install python-dotenv",
    }

    for pacote, install in pacotes.items():
        try:
            __import__(pacote)
            check(f"Pacote: {pacote}", True)
        except ImportError:
            check(f"Pacote: {pacote}", False, f"Instale com: {install}")


def verificar_tesseract():
    """Verifica se Tesseract OCR está instalado."""
    tesseract = shutil.which("tesseract")
    check(
        "Tesseract OCR",
        tesseract is not None,
        "Instale: brew install tesseract tesseract-lang"
    )


def verificar_poppler():
    """Verifica se Poppler está instalado (para pdf2image)."""
    pdftoppm = shutil.which("pdftoppm")
    check(
        "Poppler (PDF support)",
        pdftoppm is not None,
        "Instale: brew install poppler"
    )


def verificar_estrutura():
    """Verifica se todos os diretórios existem."""
    dirs = [
        "workers/ocr",
        "workers/browser",
        "workers/n8n",
        "prompts",
        "data/logs",
        "data/temp",
        "config",
    ]
    for d in dirs:
        caminho = BASE_DIR / d
        check(f"Diretório: {d}", caminho.exists(), f"Crie: mkdir -p {d}")


def verificar_arquivos():
    """Verifica se todos os arquivos do projeto existem."""
    arquivos = {
        "config/settings.json": "Configuração do sistema",
        "config/clients_schema.json": "Schema de clientes",
        "config/process_schema.json": "Schema de processos",
        "config/drive_structure.json": "Estrutura do Drive",
        "config/sheets_structure.json": "Estrutura do Sheets",
        "config/security.json": "Modelo de segurança",
        "workers/ocr/reader.py": "OCR pytesseract",
        "workers/ocr/vision_fallback.py": "GPT Vision fallback",
        "workers/n8n/classify.py": "Classificador Claude",
        "workers/n8n/client_match.py": "Match de clientes",
        "workers/n8n/extract_deadline.py": "Extrator de prazos",
        "workers/n8n/auth.py": "Autenticação",
        "workers/browser/djen.py": "Browser automation DJEN",
        "prompts/classify_document.txt": "Prompt classificação",
        "prompts/extract_deadline.txt": "Prompt extração prazos",
        "data/clientes.json": "Base de clientes (dev)",
        "data/usuarios.json": "Base de usuários (dev)",
        "requirements.txt": "Dependências Python",
        ".env.example": "Template de variáveis",
        ".gitignore": "Git ignore",
    }

    for arquivo, desc in arquivos.items():
        caminho = BASE_DIR / arquivo
        check(f"Arquivo: {arquivo}", caminho.exists(), f"Faltando: {desc}")


def verificar_env():
    """Verifica variáveis de ambiente."""
    variaveis = {
        "SYSTEM_ACTIVATION_KEY": "Chave de ativação (gere com: python -c \"import uuid; print(uuid.uuid4())\")",
        "TELEGRAM_BOT_TOKEN": "Token do bot (obtenha com @BotFather no Telegram)",
        "ANTHROPIC_API_KEY": "API key do Claude (console.anthropic.com)",
        "OPENAI_API_KEY": "API key da OpenAI (platform.openai.com)",
    }

    # Tenta carregar .env se existir
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        check("Arquivo .env", True)
        with open(env_path) as f:
            for linha in f:
                linha = linha.strip()
                if "=" in linha and not linha.startswith("#"):
                    chave, valor = linha.split("=", 1)
                    if valor.strip():
                        os.environ.setdefault(chave.strip(), valor.strip())
    else:
        check("Arquivo .env", False, "Copie: cp .env.example .env e preencha")

    for var, desc in variaveis.items():
        valor = os.environ.get(var, "")
        check(f"Env: {var}", bool(valor), desc)


def verificar_google():
    """Verifica credenciais do Google."""
    cred_path = os.environ.get("GOOGLE_CREDENTIALS_PATH", "config/google_credentials.json")
    caminho = BASE_DIR / cred_path if not os.path.isabs(cred_path) else Path(cred_path)
    check(
        "Google Credentials",
        caminho.exists(),
        "Baixe de Google Cloud Console > APIs > Credentials > OAuth2 > Download JSON",
        aviso=True
    )


def verificar_n8n():
    """Verifica se n8n está acessível."""
    n8n = shutil.which("n8n")
    check(
        "n8n instalado",
        n8n is not None,
        "Instale: npm install -g n8n",
        aviso=True
    )


def relatorio():
    """Gera relatório final."""
    total = len(CHECKS["passed"]) + len(CHECKS["failed"]) + len(CHECKS["warnings"])

    print("\n" + "=" * 60)
    print("  VERIFICAÇÃO DE SETUP — AUTOMAÇÃO JURÍDICA")
    print("=" * 60)

    if CHECKS["passed"]:
        print(f"\n✅ PASSOU ({len(CHECKS['passed'])})")
        for item in CHECKS["passed"]:
            print(f"   ✅ {item}")

    if CHECKS["warnings"]:
        print(f"\n⚠️  AVISOS ({len(CHECKS['warnings'])})")
        for item in CHECKS["warnings"]:
            print(f"   ⚠️  {item}")

    if CHECKS["failed"]:
        print(f"\n❌ FALTANDO ({len(CHECKS['failed'])})")
        for item in CHECKS["failed"]:
            print(f"   ❌ {item}")

    print("\n" + "-" * 60)
    print(f"  Total: {len(CHECKS['passed'])}/{total} verificações passaram")

    if not CHECKS["failed"]:
        print("  🎉 Sistema pronto para uso!")
    else:
        print(f"  ⚠️  Resolva os {len(CHECKS['failed'])} item(ns) acima antes de começar")

    print("=" * 60 + "\n")

    return len(CHECKS["failed"]) == 0


if __name__ == "__main__":
    verificar_python()
    verificar_dependencias()
    verificar_tesseract()
    verificar_poppler()
    verificar_estrutura()
    verificar_arquivos()
    verificar_env()
    verificar_google()
    verificar_n8n()

    sucesso = relatorio()
    sys.exit(0 if sucesso else 1)
