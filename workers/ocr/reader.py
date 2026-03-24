"""
OCR Reader — Extrai texto de imagens e PDFs.
Placeholder para quando OCR local for necessário (complemento à IA).
"""
import logging

logger = logging.getLogger("workers.ocr")


async def extract_text_from_image(image_bytes: bytes) -> str:
    """Extrai texto de imagem usando pytesseract."""
    try:
        import pytesseract
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(img, lang="por")
        return text.strip()
    except ImportError:
        logger.warning("pytesseract não instalado. OCR local desativado.")
        return ""


async def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extrai texto de PDF usando PyMuPDF."""
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text.strip()
    except ImportError:
        logger.warning("PyMuPDF não instalado. Extração de PDF desativada.")
        return ""
