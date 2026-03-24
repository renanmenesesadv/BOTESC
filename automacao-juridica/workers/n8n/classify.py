"""
Classificador de Documentos — Envia texto extraído para Claude Haiku.

Uso via CLI:
    python classify.py "texto extraído do documento aqui"
    python classify.py --arquivo /caminho/do/texto.txt

Uso via import:
    from workers.n8n.classify import classificar_documento
    resultado = classificar_documento("texto do documento...")

Retorna JSON estruturado para consumo pelo n8n.
"""

import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path

try:
    import anthropic
except ImportError:
    print(json.dumps({
        "sucesso": False,
        "erro": "Anthropic não instalado. Execute: pip install anthropic",
    }))
    sys.exit(1)


MODELO = "claude-haiku-4-5-20251001"
MAX_TOKENS = 1024
TEMPERATURA = 0.0

CAMINHO_PROMPT = Path(__file__).resolve().parent.parent.parent / "prompts" / "classify_document.txt"


def carregar_prompt(texto_extraido: str) -> str:
    """Carrega o prompt template e insere o texto extraído."""
    if not CAMINHO_PROMPT.exists():
        raise FileNotFoundError(f"Prompt não encontrado: {CAMINHO_PROMPT}")

    template = CAMINHO_PROMPT.read_text(encoding="utf-8")
    return template.replace("{{texto_extraido}}", texto_extraido)


def validar_resposta(dados: dict) -> dict:
    """Valida e normaliza a resposta do Claude."""
    campos_obrigatorios = [
        "tipo_documento", "nome_cliente", "cpf",
        "categoria_pasta", "confianca"
    ]

    for campo in campos_obrigatorios:
        if campo not in dados:
            dados[campo] = "" if campo != "confianca" else 0.0

    # Normaliza confiança para float entre 0 e 1
    try:
        dados["confianca"] = max(0.0, min(1.0, float(dados["confianca"])))
    except (ValueError, TypeError):
        dados["confianca"] = 0.0

    # Valida tipo_documento
    tipos_validos = {
        "peticao_inicial", "contestacao", "sentenca", "acordao",
        "procuracao", "contrato", "laudo_medico", "comprovante",
        "certidao", "oficio", "notificacao", "outro"
    }
    if dados["tipo_documento"] not in tipos_validos:
        dados["tipo_documento"] = "outro"
        dados["categoria_pasta"] = "00 - Entrada"

    # Valida categoria_pasta
    pastas_validas = {
        "00 - Entrada", "01 - Protocolo", "02 - Medicos",
        "03 - Processual", "04 - Contratos"
    }
    if dados["categoria_pasta"] not in pastas_validas:
        dados["categoria_pasta"] = "00 - Entrada"

    return dados


def classificar_documento(texto_extraido: str) -> dict:
    """
    Ponto de entrada principal.
    Envia texto para Claude Haiku e retorna classificação.
    """
    agora = datetime.now(timezone.utc).isoformat()

    if not texto_extraido or not texto_extraido.strip():
        return {
            "sucesso": False,
            "erro": "Texto extraído está vazio",
            "timestamp": agora,
        }

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "sucesso": False,
            "erro": "ANTHROPIC_API_KEY não configurada nas variáveis de ambiente",
            "timestamp": agora,
        }

    try:
        prompt_completo = carregar_prompt(texto_extraido)
        client = anthropic.Anthropic(api_key=api_key)

        resposta = client.messages.create(
            model=MODELO,
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURA,
            messages=[
                {"role": "user", "content": prompt_completo}
            ]
        )

        texto_resposta = resposta.content[0].text.strip()

        # Extrai JSON da resposta (remove markdown se houver)
        if "```json" in texto_resposta:
            texto_resposta = texto_resposta.split("```json")[1].split("```")[0].strip()
        elif "```" in texto_resposta:
            texto_resposta = texto_resposta.split("```")[1].split("```")[0].strip()

        dados = json.loads(texto_resposta)
        dados = validar_resposta(dados)

        tokens_entrada = resposta.usage.input_tokens
        tokens_saida = resposta.usage.output_tokens

        return {
            "sucesso": True,
            "classificacao": dados,
            "modelo": MODELO,
            "tokens": {
                "entrada": tokens_entrada,
                "saida": tokens_saida,
                "total": tokens_entrada + tokens_saida,
            },
            "timestamp": agora,
        }

    except json.JSONDecodeError as e:
        return {
            "sucesso": False,
            "erro": f"Claude não retornou JSON válido: {str(e)}",
            "resposta_bruta": texto_resposta if 'texto_resposta' in dir() else "",
            "timestamp": agora,
        }

    except Exception as e:
        return {
            "sucesso": False,
            "erro": str(e),
            "timestamp": agora,
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "sucesso": False,
            "erro": "Uso: python classify.py \"texto do documento\" OU python classify.py --arquivo caminho.txt",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    if sys.argv[1] == "--arquivo" and len(sys.argv) >= 3:
        caminho = Path(sys.argv[2])
        if not caminho.exists():
            print(json.dumps({
                "sucesso": False,
                "erro": f"Arquivo não encontrado: {sys.argv[2]}",
            }, ensure_ascii=False, indent=2))
            sys.exit(1)
        texto = caminho.read_text(encoding="utf-8")
    else:
        texto = sys.argv[1]

    resultado = classificar_documento(texto)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
