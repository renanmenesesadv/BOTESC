"""
Extrator de Prazos — Envia publicação do DJEN para Claude Haiku extrair prazos.

Uso via CLI:
    python extract_deadline.py "texto da publicação" "2026-03-24"
    python extract_deadline.py --arquivo /caminho/publicacao.txt --data "2026-03-24"

Uso via import:
    from workers.n8n.extract_deadline import extrair_prazos
    resultado = extrair_prazos("texto da publicação...", "2026-03-24")

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
MAX_TOKENS = 2048
TEMPERATURA = 0.0

CAMINHO_PROMPT = Path(__file__).resolve().parent.parent.parent / "prompts" / "extract_deadline.txt"


def carregar_prompt(texto_publicacao: str, data_publicacao: str) -> str:
    """Carrega o prompt template e insere os dados."""
    if not CAMINHO_PROMPT.exists():
        raise FileNotFoundError(f"Prompt não encontrado: {CAMINHO_PROMPT}")

    template = CAMINHO_PROMPT.read_text(encoding="utf-8")
    template = template.replace("{{texto_publicacao}}", texto_publicacao)
    template = template.replace("{{data_publicacao}}", data_publicacao)
    return template


def validar_prazo(prazo: dict) -> dict:
    """Valida e normaliza um prazo individual."""
    campos_string = [
        "numero_processo", "parte_autora", "parte_re",
        "advogado_mencionado", "tipo_ato", "descricao_ato",
        "data_publicacao", "data_limite", "acao_necessaria",
        "urgencia", "fundamentacao", "observacoes",
    ]
    for campo in campos_string:
        if campo not in prazo:
            prazo[campo] = ""

    # Normaliza prazo_dias
    try:
        prazo["prazo_dias"] = max(0, int(prazo.get("prazo_dias", 0)))
    except (ValueError, TypeError):
        prazo["prazo_dias"] = 0

    # Valida tipo_ato
    tipos_validos = {
        "intimacao", "citacao", "sentenca", "despacho",
        "decisao_interlocutoria", "acordao", "audiencia",
        "pericia", "cumprimento", "outro",
    }
    if prazo["tipo_ato"] not in tipos_validos:
        prazo["tipo_ato"] = "outro"

    # Valida urgência
    urgencias_validas = {"critica", "alta", "media", "baixa"}
    if prazo["urgencia"] not in urgencias_validas:
        # Calcula urgência pelo prazo_dias se não veio
        dias = prazo["prazo_dias"]
        if dias <= 3:
            prazo["urgencia"] = "critica"
        elif dias <= 7:
            prazo["urgencia"] = "alta"
        elif dias <= 15:
            prazo["urgencia"] = "media"
        else:
            prazo["urgencia"] = "baixa"

    return prazo


def extrair_prazos(texto_publicacao: str, data_publicacao: str = None) -> dict:
    """
    Ponto de entrada principal.
    Envia publicação para Claude Haiku e retorna prazos extraídos.
    """
    agora = datetime.now(timezone.utc).isoformat()

    if not data_publicacao:
        data_publicacao = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if not texto_publicacao or not texto_publicacao.strip():
        return {
            "sucesso": False,
            "erro": "Texto da publicação está vazio",
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
        prompt_completo = carregar_prompt(texto_publicacao, data_publicacao)
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

        # Extrai JSON da resposta
        if "```json" in texto_resposta:
            texto_resposta = texto_resposta.split("```json")[1].split("```")[0].strip()
        elif "```" in texto_resposta:
            texto_resposta = texto_resposta.split("```")[1].split("```")[0].strip()

        dados = json.loads(texto_resposta)

        # Valida cada prazo
        prazos_validados = []
        for prazo in dados.get("prazos", []):
            prazos_validados.append(validar_prazo(prazo))

        tokens_entrada = resposta.usage.input_tokens
        tokens_saida = resposta.usage.output_tokens

        return {
            "sucesso": True,
            "total_prazos": len(prazos_validados),
            "prazos": prazos_validados,
            "tem_urgente": any(
                p["urgencia"] in ("critica", "alta") for p in prazos_validados
            ),
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
    import argparse

    parser = argparse.ArgumentParser(description="Extrai prazos de publicações judiciais")
    parser.add_argument("texto", nargs="?", help="Texto da publicação")
    parser.add_argument("data", nargs="?", help="Data da publicação (YYYY-MM-DD)")
    parser.add_argument("--arquivo", type=str, help="Caminho para arquivo com texto da publicação")
    args = parser.parse_args()

    if args.arquivo:
        caminho = Path(args.arquivo)
        if not caminho.exists():
            print(json.dumps({
                "sucesso": False,
                "erro": f"Arquivo não encontrado: {args.arquivo}",
            }, ensure_ascii=False, indent=2))
            sys.exit(1)
        texto = caminho.read_text(encoding="utf-8")
    elif args.texto:
        texto = args.texto
    else:
        print(json.dumps({
            "sucesso": False,
            "erro": "Uso: python extract_deadline.py \"texto\" \"data\" OU --arquivo caminho.txt --data YYYY-MM-DD",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    resultado = extrair_prazos(texto, args.data)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
