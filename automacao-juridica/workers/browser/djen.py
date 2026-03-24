"""
DJEN Browser Automation — Captura publicações do Diário da Justiça Eletrônico.

Uso via CLI:
    python djen.py                          # Abre navegador, aguarda login manual
    python djen.py --buscar "Maria Silva"   # Busca por nome após login
    python djen.py --sessao /caminho/sessao # Reutiliza sessão salva

Uso via import:
    from workers.browser.djen import capturar_publicacoes
    resultado = capturar_publicacoes(termo_busca="Maria Silva")

Fluxo:
    1. Abre navegador (visível para login manual)
    2. Acessa DJEN
    3. Aguarda login manual OU carrega sessão salva
    4. Busca publicações
    5. Extrai conteúdo
    6. Retorna JSON estruturado

Retorna JSON para consumo pelo n8n → Claude extrai prazos.
"""

import json
import sys
import os
import re
import asyncio
from datetime import datetime, timezone
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except ImportError:
    print(json.dumps({
        "sucesso": False,
        "erro": "Playwright não instalado. Execute: pip install playwright && playwright install chromium",
        "publicacoes": [],
    }))
    sys.exit(1)


URL_DJEN = "https://www.jfce.jus.br/djen/"
DIRETORIO_SESSAO = Path(__file__).resolve().parent.parent.parent / "data" / "browser_session"
TIMEOUT_LOGIN = 120000  # 2 minutos para login manual
TIMEOUT_PAGINA = 30000  # 30 segundos para carregar página


async def iniciar_navegador(caminho_sessao: str = None):
    """Inicia navegador com ou sem sessão salva."""
    pw = await async_playwright().start()

    diretorio = caminho_sessao or str(DIRETORIO_SESSAO)

    browser = await pw.chromium.launch_persistent_context(
        user_data_dir=diretorio,
        headless=False,
        viewport={"width": 1280, "height": 900},
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    )

    return pw, browser


async def aguardar_login(page) -> bool:
    """
    Aguarda o usuário fazer login manualmente.
    Detecta login verificando mudança na página.
    """
    print(json.dumps({
        "status": "aguardando_login",
        "mensagem": "Faça login manualmente no navegador. Aguardando até 2 minutos...",
    }, ensure_ascii=False), flush=True)

    try:
        # Aguarda elemento que só aparece após login
        # ou mudança que indica autenticação
        await page.wait_for_function(
            """() => {
                const body = document.body.innerText;
                return body.includes('Sair')
                    || body.includes('Logout')
                    || body.includes('Pesquisar')
                    || body.includes('Consulta');
            }""",
            timeout=TIMEOUT_LOGIN,
        )
        return True
    except Exception:
        return False


async def acessar_djen(page):
    """Navega para a página do DJEN."""
    await page.goto(URL_DJEN, wait_until="domcontentloaded", timeout=TIMEOUT_PAGINA)
    await page.wait_for_timeout(2000)


async def buscar_publicacoes(page, termo: str = None) -> list:
    """
    Busca publicações no DJEN.
    Se termo for fornecido, filtra por ele.
    Caso contrário, captura publicações do dia.
    """
    publicacoes = []

    # Tenta buscar campo de pesquisa
    if termo:
        try:
            campo_busca = await page.query_selector(
                'input[type="text"], input[type="search"], input[name*="pesq"], input[name*="busca"]'
            )
            if campo_busca:
                await campo_busca.fill(termo)
                await page.keyboard.press("Enter")
                await page.wait_for_timeout(3000)
        except Exception:
            pass

    # Captura conteúdo da página
    try:
        conteudo = await page.content()
        texto = await page.inner_text("body")

        # Extrai blocos de publicação
        # Padrão: cada publicação geralmente tem número de processo e conteúdo
        blocos = extrair_blocos_publicacao(texto)

        for i, bloco in enumerate(blocos):
            publicacao = {
                "indice": i + 1,
                "texto": bloco["texto"],
                "numero_processo": bloco.get("numero_processo", ""),
                "data_publicacao": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
            publicacoes.append(publicacao)

    except Exception as e:
        publicacoes.append({
            "indice": 0,
            "texto": texto if 'texto' in dir() else "",
            "numero_processo": "",
            "data_publicacao": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "erro": str(e),
        })

    return publicacoes


def extrair_blocos_publicacao(texto: str) -> list:
    """
    Divide o texto da página em blocos individuais de publicação.
    Cada bloco contém uma intimação/publicação.
    """
    blocos = []

    # Padrão CNJ: 0000000-00.0000.0.00.0000
    padrao_cnj = r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}"

    # Tenta dividir por número de processo
    partes = re.split(f"({padrao_cnj})", texto)

    if len(partes) > 1:
        # Reagrupa: número + conteúdo
        i = 1
        while i < len(partes):
            numero = partes[i].strip()
            conteudo = partes[i + 1].strip() if i + 1 < len(partes) else ""

            # Limpa conteúdo: pega até próximo padrão ou até 2000 chars
            conteudo_limpo = conteudo[:2000].strip()

            if numero and conteudo_limpo:
                blocos.append({
                    "numero_processo": numero,
                    "texto": f"{numero}\n{conteudo_limpo}",
                })
            i += 2
    else:
        # Sem número CNJ encontrado — divide por parágrafos grandes
        paragrafos = texto.split("\n\n")
        bloco_atual = []

        for p in paragrafos:
            p = p.strip()
            if not p or len(p) < 20:
                continue

            bloco_atual.append(p)

            # Agrupa em blocos de até 1500 chars
            texto_atual = "\n".join(bloco_atual)
            if len(texto_atual) > 1500:
                # Procura número CNJ no bloco
                match_cnj = re.search(padrao_cnj, texto_atual)
                blocos.append({
                    "numero_processo": match_cnj.group() if match_cnj else "",
                    "texto": texto_atual,
                })
                bloco_atual = []

        # Último bloco
        if bloco_atual:
            texto_final = "\n".join(bloco_atual)
            match_cnj = re.search(padrao_cnj, texto_final)
            blocos.append({
                "numero_processo": match_cnj.group() if match_cnj else "",
                "texto": texto_final,
            })

    return blocos


async def capturar_publicacoes(
    termo_busca: str = None,
    caminho_sessao: str = None,
) -> dict:
    """
    Ponto de entrada principal.
    Abre navegador, acessa DJEN, captura publicações.
    """
    agora = datetime.now(timezone.utc).isoformat()
    pw = None
    browser = None

    try:
        pw, browser = await iniciar_navegador(caminho_sessao)
        page = browser.pages[0] if browser.pages else await browser.new_page()

        # Acessa DJEN
        await acessar_djen(page)

        # Verifica se precisa login
        conteudo = await page.inner_text("body")
        precisa_login = not any(
            palavra in conteudo.lower()
            for palavra in ["sair", "logout", "pesquisar", "consulta", "diário"]
        )

        if precisa_login:
            logou = await aguardar_login(page)
            if not logou:
                return {
                    "sucesso": False,
                    "erro": "Timeout aguardando login manual (2 minutos)",
                    "publicacoes": [],
                    "timestamp": agora,
                }

        # Busca publicações
        publicacoes = await buscar_publicacoes(page, termo_busca)

        # Captura URL atual para log
        url_atual = page.url

        return {
            "sucesso": True,
            "url": url_atual,
            "termo_busca": termo_busca,
            "total_publicacoes": len(publicacoes),
            "publicacoes": publicacoes,
            "timestamp": agora,
        }

    except Exception as e:
        return {
            "sucesso": False,
            "erro": str(e),
            "publicacoes": [],
            "timestamp": agora,
        }

    finally:
        if browser:
            await browser.close()
        if pw:
            await pw.stop()


def main():
    """Entry point para CLI."""
    import argparse

    parser = argparse.ArgumentParser(description="Captura publicações do DJEN")
    parser.add_argument("--buscar", type=str, help="Termo de busca (nome, CPF, nº processo)")
    parser.add_argument("--sessao", type=str, help="Caminho para diretório de sessão do navegador")
    args = parser.parse_args()

    resultado = asyncio.run(
        capturar_publicacoes(
            termo_busca=args.buscar,
            caminho_sessao=args.sessao,
        )
    )

    print(json.dumps(resultado, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
