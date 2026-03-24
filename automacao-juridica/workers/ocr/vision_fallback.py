"""
GPT Vision Fallback — Extrai texto de imagens/PDFs quando o pytesseract falha.

Uso via CLI:
    python vision_fallback.py /caminho/do/arquivo.png
    python vision_fallback.py /caminho/do/arquivo.pdf

Uso via import:
    from workers.ocr.vision_fallback import extrair_com_vision
    resultado = extrair_com_vision("/caminho/do/arquivo.png")

Retorna JSON estruturado no mesmo formato do reader.py.
"""

import json
import sys
import os
import base64
import tempfile
from datetime import datetime, timezone
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    print(json.dumps({
        "sucesso": False,
        "erro": "OpenAI não instalado. Execute: pip install openai",
        "texto": ""
    }))
    sys.exit(1)

try:
    from pdf2image import convert_from_path
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

try:
    from PIL import Image
    PIL_SUPPORT = True
except ImportError:
    PIL_SUPPORT = False


MODELO = "gpt-4o-mini"
MAX_TOKENS = 2048
MAX_LARGURA = 1024

PROMPT_EXTRACAO = """Você é um assistente especializado em extrair texto de documentos jurídicos brasileiros.

TAREFA:
Extraia TODO o texto visível nesta imagem, mantendo a estrutura original.

REGRAS:
1. Extraia o texto EXATAMENTE como aparece, sem interpretar ou resumir
2. Preserve a hierarquia: títulos, subtítulos, parágrafos, listas
3. Mantenha números de processo no formato original (ex: 0001234-56.2025.4.05.8100)
4. Mantenha CPFs, datas, valores monetários exatamente como aparecem
5. Se houver tabelas, mantenha o alinhamento usando espaços
6. Indique trechos ilegíveis com [ILEGÍVEL]
7. Não adicione comentários, explicações ou formatação extra

RESPONDA APENAS COM O TEXTO EXTRAÍDO."""


def redimensionar_imagem(caminho: str) -> str:
    """Redimensiona imagem se for muito grande, retorna caminho da nova imagem."""
    if not PIL_SUPPORT:
        return caminho

    img = Image.open(caminho)
    largura, altura = img.size

    if largura <= MAX_LARGURA:
        return caminho

    proporcao = MAX_LARGURA / largura
    nova_altura = int(altura * proporcao)
    img_redimensionada = img.resize((MAX_LARGURA, nova_altura), Image.LANCZOS)

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    img_redimensionada.save(tmp.name, "PNG")
    return tmp.name


def imagem_para_base64(caminho: str) -> str:
    """Converte imagem para base64."""
    caminho_otimizado = redimensionar_imagem(caminho)
    with open(caminho_otimizado, "rb") as f:
        dados = base64.b64encode(f.read()).decode("utf-8")

    # Limpa arquivo temporário se foi redimensionado
    if caminho_otimizado != caminho:
        os.unlink(caminho_otimizado)

    return dados


def detectar_tipo_mime(caminho: str) -> str:
    """Retorna o tipo MIME baseado na extensão."""
    mapa = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".tiff": "image/tiff",
        ".webp": "image/webp",
    }
    extensao = Path(caminho).suffix.lower()
    return mapa.get(extensao, "image/png")


def extrair_de_imagem_vision(caminho: str, client: OpenAI) -> dict:
    """Envia uma imagem para GPT Vision e retorna o texto extraído."""
    base64_img = imagem_para_base64(caminho)
    tipo_mime = detectar_tipo_mime(caminho)

    resposta = client.chat.completions.create(
        model=MODELO,
        max_tokens=MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT_EXTRACAO},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{tipo_mime};base64,{base64_img}",
                            "detail": "high",
                        },
                    },
                ],
            }
        ],
    )

    texto = resposta.choices[0].message.content.strip()
    tokens_usados = resposta.usage.total_tokens if resposta.usage else 0

    return {
        "texto": texto,
        "tokens_usados": tokens_usados,
        "total_palavras": len(texto.split()) if texto else 0,
    }


def extrair_de_pdf_vision(caminho: str, client: OpenAI) -> dict:
    """Converte PDF em imagens e extrai texto de cada página via Vision."""
    if not PDF_SUPPORT:
        return {
            "texto": "",
            "tokens_usados": 0,
            "total_palavras": 0,
            "erro": "pdf2image não instalado. Execute: pip install pdf2image",
        }

    with tempfile.TemporaryDirectory() as tmp_dir:
        paginas = convert_from_path(caminho, output_folder=tmp_dir, dpi=200)

        textos = []
        tokens_total = 0

        for i, pagina in enumerate(paginas):
            caminho_tmp = os.path.join(tmp_dir, f"pagina_{i}.png")
            pagina.save(caminho_tmp, "PNG")

            resultado = extrair_de_imagem_vision(caminho_tmp, client)
            if resultado["texto"]:
                textos.append(f"--- PÁGINA {i + 1} ---\n{resultado['texto']}")
            tokens_total += resultado.get("tokens_usados", 0)

    texto_final = "\n\n".join(textos)

    return {
        "texto": texto_final,
        "tokens_usados": tokens_total,
        "total_palavras": len(texto_final.split()) if texto_final else 0,
        "total_paginas": len(paginas),
    }


def extrair_com_vision(caminho_arquivo: str) -> dict:
    """
    Ponto de entrada principal.
    Recebe caminho do arquivo, retorna JSON estruturado.
    """
    caminho = Path(caminho_arquivo)
    agora = datetime.now(timezone.utc).isoformat()

    # Validações
    if not caminho.exists():
        return {
            "sucesso": False,
            "erro": f"Arquivo não encontrado: {caminho_arquivo}",
            "texto": "",
            "timestamp": agora,
        }

    extensao = caminho.suffix.lower()
    extensoes_validas = {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif", ".webp", ".pdf"}

    if extensao not in extensoes_validas:
        return {
            "sucesso": False,
            "erro": f"Formato não suportado: {extensao}",
            "texto": "",
            "timestamp": agora,
        }

    # Verifica API key
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "sucesso": False,
            "erro": "OPENAI_API_KEY não configurada nas variáveis de ambiente",
            "texto": "",
            "timestamp": agora,
        }

    try:
        client = OpenAI(api_key=api_key)

        if extensao == ".pdf":
            resultado = extrair_de_pdf_vision(caminho_arquivo, client)
        else:
            resultado = extrair_de_imagem_vision(caminho_arquivo, client)

        return {
            "sucesso": True,
            "arquivo": caminho.name,
            "formato": extensao,
            "metodo": "gpt_vision",
            "modelo": MODELO,
            "texto": resultado["texto"],
            "total_palavras": resultado["total_palavras"],
            "total_paginas": resultado.get("total_paginas", 1),
            "tokens_usados": resultado.get("tokens_usados", 0),
            "precisa_fallback": False,
            "timestamp": agora,
        }

    except Exception as e:
        return {
            "sucesso": False,
            "erro": str(e),
            "arquivo": caminho.name,
            "formato": extensao,
            "metodo": "gpt_vision",
            "texto": "",
            "precisa_fallback": False,
            "timestamp": agora,
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "sucesso": False,
            "erro": "Uso: python vision_fallback.py <caminho_do_arquivo>",
            "texto": "",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    resultado = extrair_com_vision(sys.argv[1])
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
