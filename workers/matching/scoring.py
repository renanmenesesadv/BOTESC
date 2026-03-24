"""
Scoring de similaridade para match de clientes.
"""


def name_similarity(name_a: str, name_b: str) -> float:
    """Similaridade simples entre dois nomes (0.0 a 1.0)."""
    if not name_a or not name_b:
        return 0.0
    a = set(name_a.lower().split())
    b = set(name_b.lower().split())
    if not a or not b:
        return 0.0
    intersection = a & b
    return len(intersection) / max(len(a), len(b))


def cpf_match(cpf_a: str, cpf_b: str) -> bool:
    """Match exato de CPF (remove pontuação)."""
    if not cpf_a or not cpf_b:
        return False
    clean_a = cpf_a.replace(".", "").replace("-", "")
    clean_b = cpf_b.replace(".", "").replace("-", "")
    return clean_a == clean_b
