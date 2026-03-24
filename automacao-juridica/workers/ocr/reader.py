"""
OCR Reader — Extrai texto de imagens e PDFs usando pytesseract.

Uso via CLI:
    python reader.py /caminho/do/arquivo.pdf
    python reader.py /caminho/da/imagem.png

Uso via import:
    from workers.ocr.reader import extrair_texto
    resultado = extrair_texto("/caminho/do/arquivo.pdf")

Retorna JSON estruturado para consumo pelo n8n.
"""

import json
import sys
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import pytesseract
    from PIL import Image
except ImportError:
    print(json.dumps({
        "sucesso": False,
        "erro": "Dependências não instaladas. Execute: pip install pytesseract Pillow",
        "texto": ""
    }))
    sys.exit(1)

try:
    from pdf2image import convert_from_path
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False


IDIOMA_OCR = "por"
CONFIANCA_MINIMA = 60


def limpar_texto(texto: str) -> str:
    """Remove espaços excessivos e linhas vazias."""
    linhas = texto.splitlines()
    linhas_limpas = []
    for linha in linhas:
        linha = linha.strip()
        if linha:
            linhas_limpas.append(linha)
    return "\n".join(linhas_limpas)


def extrair_de_imagem(caminho: str) -> dict:
    """Extrai texto de um arquivo de imagem."""
    imagem = Image.open(caminho)

    # Extrai com dados de confiança
    dados = pytesseract.image_to_data(
        imagem, lang=IDIOMA_OCR, output_type=pytesseract.Output.DICT
    )

    # Calcula confiança média (ignora blocos vazios)
    confiancas = [
        int(c) for c, t in zip(dados["conf"], dados["text"])
        if int(c) > 0 and t.strip()
    ]
    confianca_media = sum(confiancas) / len(confiancas) if confiancas else 0

    # Extrai texto completo
    texto_bruto = pytesseract.image_to_string(imagem, lang=IDIOMA_OCR)
    texto_limpo = limpar_texto(texto_bruto)

    return {
        "texto": texto_limpo,
        "confianca": round(confianca_media, 2),
        "total_palavras": len(texto_limpo.split()) if texto_limpo else 0,
    }


def extrair_de_pdf(caminho: str) -> dict:
    """Extrai texto de PDF convertendo cada página em imagem."""
    if not PDF_SUPPORT:
        return {
            "texto": "",
            "confianca": 0,
            "total_palavras": 0,
            "erro": "pdf2image não instalado. Execute: pip install pdf2image",
        }

    with tempfile.TemporaryDirectory() as tmp_dir:
        paginas = convert_from_path(caminho, output_folder=tmp_dir, dpi=300)

        textos = []
        confiancas = []

        for i, pagina in enumerate(paginas):
            caminho_tmp = os.path.join(tmp_dir, f"pagina_{i}.png")
            pagina.save(caminho_tmp, "PNG")

            resultado = extrair_de_imagem(caminho_tmp)
            if resultado["texto"]:
                textos.append(f"--- PÁGINA {i + 1} ---\n{resultado['texto']}")
            if resultado["confianca"] > 0:
                confiancas.append(resultado["confianca"])

    texto_final = "\n\n".join(textos)
    confianca_media = sum(confiancas) / len(confiancas) if confiancas else 0

    return {
        "texto": texto_final,
        "confianca": round(confianca_media, 2),
        "total_palavras": len(texto_final.split()) if texto_final else 0,
        "total_paginas": len(paginas),
    }


def extrair_texto(caminho_arquivo: str) -> dict:
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
    extensoes_validas = {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif", ".pdf"}

    if extensao not in extensoes_validas:
        return {
            "sucesso": False,
            "erro": f"Formato não suportado: {extensao}. Use: {', '.join(extensoes_validas)}",
            "texto": "",
            "timestamp": agora,
        }

    try:
        if extensao == ".pdf":
            resultado = extrair_de_pdf(caminho_arquivo)
        else:
            resultado = extrair_de_imagem(caminho_arquivo)

        # Avalia se precisa de fallback
        precisa_fallback = (
            resultado["confianca"] < CONFIANCA_MINIMA
            or resultado["total_palavras"] < 5
        )

        return {
            "sucesso": True,
            "arquivo": caminho.name,
            "formato": extensao,
            "metodo": "pytesseract",
            "texto": resultado["texto"],
            "confianca": resultado["confianca"],
            "total_palavras": resultado["total_palavras"],
            "total_paginas": resultado.get("total_paginas", 1),
            "precisa_fallback": precisa_fallback,
            "timestamp": agora,
        }

    except Exception as e:
        return {
            "sucesso": False,
            "erro": str(e),
            "arquivo": caminho.name,
            "formato": extensao,
            "metodo": "pytesseract",
            "texto": "",
            "precisa_fallback": True,
            "timestamp": agora,
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "sucesso": False,
            "erro": "Uso: python reader.py <caminho_do_arquivo>",
            "texto": "",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    resultado = extrair_texto(sys.argv[1])
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
