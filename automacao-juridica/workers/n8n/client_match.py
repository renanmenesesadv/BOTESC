"""
Client Match Engine — Cruza dados extraídos com base de clientes.

Uso via CLI:
    python client_match.py '{"nome_cliente":"Maria da Silva","cpf":"123.456.789-00","numero_processo":""}'

Uso via import:
    from workers.n8n.client_match import encontrar_cliente
    resultado = encontrar_cliente(dados_extraidos, lista_clientes)

Estratégia de match (por prioridade):
    1. CPF exato          → forte (1.0)
    2. Nº processo exato  → forte (0.95)
    3. Nome exato         → forte (0.9)
    4. Nome parcial       → provavel (0.5-0.8)
    5. Nenhum match       → nao_encontrado (0.0)

Retorna JSON estruturado para consumo pelo n8n.
"""

import json
import sys
import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


# --- Utilitários de normalização ---

def normalizar_texto(texto: str) -> str:
    """Remove acentos, converte para minúsculo, remove caracteres especiais."""
    if not texto:
        return ""
    # Remove acentos
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    # Minúsculo e limpa
    texto = texto.lower().strip()
    texto = re.sub(r"[^a-z0-9\s]", "", texto)
    texto = re.sub(r"\s+", " ", texto)
    return texto


def normalizar_cpf(cpf: str) -> str:
    """Extrai apenas dígitos do CPF."""
    if not cpf:
        return ""
    return re.sub(r"[^0-9]", "", cpf)


def normalizar_processo(numero: str) -> str:
    """Extrai apenas dígitos do número de processo."""
    if not numero:
        return ""
    return re.sub(r"[^0-9]", "", numero)


# --- Algoritmos de comparação ---

def match_cpf(cpf_documento: str, cpf_cliente: str) -> float:
    """Compara CPFs. Retorna 1.0 se iguais, 0.0 se diferentes."""
    a = normalizar_cpf(cpf_documento)
    b = normalizar_cpf(cpf_cliente)
    if not a or not b:
        return 0.0
    if len(a) != 11 or len(b) != 11:
        return 0.0
    return 1.0 if a == b else 0.0


def match_processo(proc_documento: str, processos_cliente: list) -> float:
    """Compara número de processo com lista de processos do cliente."""
    proc_norm = normalizar_processo(proc_documento)
    if not proc_norm:
        return 0.0
    for proc in processos_cliente:
        if normalizar_processo(proc) == proc_norm:
            return 0.95
    return 0.0


def match_nome(nome_documento: str, nome_cliente: str) -> float:
    """
    Compara nomes com múltiplas estratégias.
    Retorna score de 0.0 a 0.9.
    """
    nome_doc = normalizar_texto(nome_documento)
    nome_cli = normalizar_texto(nome_cliente)

    if not nome_doc or not nome_cli:
        return 0.0

    # Match exato
    if nome_doc == nome_cli:
        return 0.9

    partes_doc = set(nome_doc.split())
    partes_cli = set(nome_cli.split())

    # Remove palavras muito curtas (de, da, do, dos, das, e)
    stopwords = {"de", "da", "do", "dos", "das", "e", "a", "o"}
    partes_doc = partes_doc - stopwords
    partes_cli = partes_cli - stopwords

    if not partes_doc or not partes_cli:
        return 0.0

    # Palavras em comum
    comuns = partes_doc & partes_cli
    if not comuns:
        return 0.0

    # Score baseado em proporção de palavras em comum
    total = max(len(partes_doc), len(partes_cli))
    proporcao = len(comuns) / total

    # Primeiro e último nome batem = bonus
    lista_doc = nome_doc.split()
    lista_cli = nome_cli.split()

    primeiro_bate = lista_doc[0] == lista_cli[0]
    ultimo_bate = lista_doc[-1] == lista_cli[-1]

    bonus = 0.0
    if primeiro_bate and ultimo_bate:
        bonus = 0.15
    elif primeiro_bate or ultimo_bate:
        bonus = 0.05

    score = min(0.85, (proporcao * 0.7) + bonus)

    return round(score, 2)


# --- Engine principal ---

def calcular_match(dados_extraidos: dict, cliente: dict) -> dict:
    """
    Calcula score de match entre dados extraídos e um cliente.
    Retorna o melhor score e o método que gerou o match.
    """
    scores = {}

    # 1. CPF (maior prioridade)
    score_cpf = match_cpf(
        dados_extraidos.get("cpf", ""),
        cliente.get("cpf", "")
    )
    if score_cpf > 0:
        scores["cpf"] = score_cpf

    # 2. Número de processo
    score_proc = match_processo(
        dados_extraidos.get("numero_processo", ""),
        cliente.get("processos", [])
    )
    if score_proc > 0:
        scores["processo"] = score_proc

    # 3. Nome
    score_nome = match_nome(
        dados_extraidos.get("nome_cliente", ""),
        cliente.get("nome_completo", "")
    )
    if score_nome > 0:
        scores["nome"] = score_nome

    if not scores:
        return {
            "score": 0.0,
            "metodo": "nenhum",
            "detalhes": scores,
        }

    melhor_metodo = max(scores, key=scores.get)
    melhor_score = scores[melhor_metodo]

    return {
        "score": melhor_score,
        "metodo": melhor_metodo,
        "detalhes": scores,
    }


def classificar_match(score: float) -> str:
    """Converte score numérico em classificação textual."""
    if score >= 0.9:
        return "forte"
    elif score >= 0.6:
        return "provavel"
    elif score >= 0.4:
        return "ambiguo"
    else:
        return "nao_encontrado"


def encontrar_cliente(dados_extraidos: dict, clientes: list) -> dict:
    """
    Ponto de entrada principal.
    Compara dados extraídos com todos os clientes e retorna o melhor match.
    """
    agora = datetime.now(timezone.utc).isoformat()

    if not dados_extraidos:
        return {
            "sucesso": False,
            "erro": "Dados extraídos estão vazios",
            "timestamp": agora,
        }

    if not clientes:
        return {
            "sucesso": True,
            "match": "nao_encontrado",
            "score": 0.0,
            "cliente": None,
            "todos_matches": [],
            "timestamp": agora,
        }

    resultados = []

    for cliente in clientes:
        resultado = calcular_match(dados_extraidos, cliente)
        if resultado["score"] > 0:
            resultados.append({
                "cliente_id": cliente.get("id", ""),
                "nome": cliente.get("nome_completo", ""),
                "cpf": cliente.get("cpf", ""),
                "score": resultado["score"],
                "metodo": resultado["metodo"],
                "detalhes": resultado["detalhes"],
            })

    # Ordena por score decrescente
    resultados.sort(key=lambda x: x["score"], reverse=True)

    if not resultados:
        return {
            "sucesso": True,
            "match": "nao_encontrado",
            "score": 0.0,
            "cliente": None,
            "todos_matches": [],
            "timestamp": agora,
        }

    melhor = resultados[0]
    classificacao = classificar_match(melhor["score"])

    # Detecta ambiguidade: dois matches com scores próximos
    if len(resultados) >= 2:
        diferenca = melhor["score"] - resultados[1]["score"]
        if diferenca < 0.15 and melhor["score"] < 0.9:
            classificacao = "ambiguo"

    return {
        "sucesso": True,
        "match": classificacao,
        "score": melhor["score"],
        "metodo": melhor["metodo"],
        "cliente": {
            "id": melhor["cliente_id"],
            "nome": melhor["nome"],
            "cpf": melhor["cpf"],
        },
        "todos_matches": resultados[:5],
        "total_candidatos": len(resultados),
        "timestamp": agora,
    }


def carregar_clientes(caminho: str = None) -> list:
    """
    Carrega lista de clientes de um arquivo JSON.
    Em produção, n8n passa os clientes diretamente do Google Sheets.
    """
    if caminho and Path(caminho).exists():
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)

    # Caminho padrão para desenvolvimento
    caminho_padrao = Path(__file__).resolve().parent.parent.parent / "data" / "clientes.json"
    if caminho_padrao.exists():
        with open(caminho_padrao, "r", encoding="utf-8") as f:
            return json.load(f)

    return []


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "sucesso": False,
            "erro": "Uso: python client_match.py '{\"nome_cliente\":\"...\",\"cpf\":\"...\",\"numero_processo\":\"...\"}'",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    try:
        dados = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print(json.dumps({
            "sucesso": False,
            "erro": "JSON inválido no argumento",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    # Carrega clientes (arquivo local ou passado como segundo argumento)
    caminho_clientes = sys.argv[2] if len(sys.argv) >= 3 else None
    clientes = carregar_clientes(caminho_clientes)

    resultado = encontrar_cliente(dados, clientes)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
