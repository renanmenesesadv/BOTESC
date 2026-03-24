"""
Auth — Validação de segurança para todo workflow.

Uso via CLI:
    python auth.py <telegram_id> <comando> [chave_ativacao]

Uso via import:
    from workers.n8n.auth import validar_acesso
    resultado = validar_acesso("123456789", "/documento", usuarios)

Chamado como PRIMEIRO PASSO de todo workflow no n8n.
Se retornar autorizado=false, o workflow deve parar imediatamente.
"""

import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path


# Mapa de permissões por role
PERMISSOES = {
    "admin": {
        "comandos": ["/cliente", "/documento", "/agendar", "/prazo", "/buscar", "/status", "/ajuda", "/start"],
        "recebe_alertas": ["critica", "alta", "media", "baixa", "erro_sistema", "login_nao_autorizado"],
    },
    "advogado": {
        "comandos": ["/cliente", "/documento", "/agendar", "/prazo", "/buscar", "/ajuda", "/start"],
        "recebe_alertas": ["critica", "alta"],
    },
    "estagiario": {
        "comandos": ["/documento", "/prazo", "/ajuda", "/start"],
        "recebe_alertas": [],
    },
}

# Ações que não são comandos mas precisam de permissão
ACOES_ARQUIVO = {
    "enviar_documento": ["admin", "advogado", "estagiario"],
}


def validar_chave_ativacao() -> bool:
    """Verifica se a chave de ativação do sistema está configurada."""
    chave = os.environ.get("SYSTEM_ACTIVATION_KEY", "")
    return len(chave) >= 16


def validar_acesso(
    telegram_id: str,
    comando: str,
    usuarios: list = None,
) -> dict:
    """
    Ponto de entrada principal.
    Valida se o usuário pode executar o comando solicitado.
    """
    agora = datetime.now(timezone.utc).isoformat()

    # 1. Chave de ativação
    if not validar_chave_ativacao():
        return {
            "autorizado": False,
            "motivo": "sistema_desativado",
            "mensagem": "Sistema desativado. Chave de ativação não configurada.",
            "telegram_id": telegram_id,
            "timestamp": agora,
        }

    # 2. Telegram ID válido
    if not telegram_id or not str(telegram_id).strip().isdigit():
        return {
            "autorizado": False,
            "motivo": "id_invalido",
            "mensagem": "Telegram ID inválido.",
            "telegram_id": telegram_id,
            "timestamp": agora,
        }

    telegram_id = str(telegram_id).strip()

    # 3. Busca usuário na lista
    if not usuarios:
        usuarios = carregar_usuarios()

    usuario = None
    for u in usuarios:
        uid = str(u.get("TELEGRAM_ID", u.get("telegram_id", ""))).strip()
        if uid == telegram_id:
            usuario = u
            break

    # 4. Usuário não encontrado
    if not usuario:
        return {
            "autorizado": False,
            "motivo": "nao_autorizado",
            "mensagem": f"Acesso não autorizado.\n\nSeu ID: {telegram_id}\nEntre em contato com o administrador.",
            "telegram_id": telegram_id,
            "alerta_admin": True,
            "timestamp": agora,
        }

    # 5. Usuário inativo
    ativo = usuario.get("ATIVO", usuario.get("ativo", ""))
    if str(ativo).upper() not in ("TRUE", "1", "SIM", "YES"):
        return {
            "autorizado": False,
            "motivo": "usuario_inativo",
            "mensagem": "Seu acesso foi desativado. Entre em contato com o administrador.",
            "telegram_id": telegram_id,
            "usuario": usuario.get("NOME", usuario.get("nome", "")),
            "timestamp": agora,
        }

    # 6. Verifica role e permissão
    role = usuario.get("ROLE", usuario.get("role", "")).lower()
    if role not in PERMISSOES:
        return {
            "autorizado": False,
            "motivo": "role_invalido",
            "mensagem": "Papel de usuário inválido. Contate o administrador.",
            "telegram_id": telegram_id,
            "role": role,
            "timestamp": agora,
        }

    # 7. Verifica comando
    comando_normalizado = comando.lower().strip()

    # Se é envio de arquivo (sem comando explícito)
    if comando_normalizado in ACOES_ARQUIVO:
        roles_permitidos = ACOES_ARQUIVO[comando_normalizado]
        if role not in roles_permitidos:
            return {
                "autorizado": False,
                "motivo": "sem_permissao",
                "mensagem": f"Você não tem permissão para {comando_normalizado}.",
                "telegram_id": telegram_id,
                "usuario": usuario.get("NOME", usuario.get("nome", "")),
                "role": role,
                "comando": comando_normalizado,
                "timestamp": agora,
            }
    else:
        # Extrai comando base (ex: "/prazo urgente" → "/prazo")
        comando_base = comando_normalizado.split()[0] if comando_normalizado else ""
        comandos_permitidos = PERMISSOES[role]["comandos"]

        if comando_base and comando_base not in comandos_permitidos:
            return {
                "autorizado": False,
                "motivo": "sem_permissao",
                "mensagem": f"Comando {comando_base} não disponível para seu perfil.",
                "telegram_id": telegram_id,
                "usuario": usuario.get("NOME", usuario.get("nome", "")),
                "role": role,
                "comando": comando_base,
                "comandos_disponiveis": comandos_permitidos,
                "timestamp": agora,
            }

    # 8. Autorizado
    return {
        "autorizado": True,
        "telegram_id": telegram_id,
        "usuario": {
            "nome": usuario.get("NOME", usuario.get("nome", "")),
            "role": role,
            "alertas": PERMISSOES[role]["recebe_alertas"],
        },
        "comando": comando_normalizado,
        "timestamp": agora,
    }


def carregar_usuarios(caminho: str = None) -> list:
    """
    Carrega lista de usuários de arquivo JSON local.
    Em produção, n8n lê direto do Google Sheets e passa como argumento.
    """
    if caminho and Path(caminho).exists():
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)

    caminho_padrao = Path(__file__).resolve().parent.parent.parent / "data" / "usuarios.json"
    if caminho_padrao.exists():
        with open(caminho_padrao, "r", encoding="utf-8") as f:
            return json.load(f)

    return []


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({
            "autorizado": False,
            "erro": "Uso: python auth.py <telegram_id> <comando>",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    telegram_id = sys.argv[1]
    comando = sys.argv[2]

    resultado = validar_acesso(telegram_id, comando)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
