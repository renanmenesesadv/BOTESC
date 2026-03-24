"""
Pré-processamento de imagem para melhorar OCR.
"""
import logging

logger = logging.getLogger("workers.ocr.preprocess")


async def enhance_for_ocr(image_bytes: bytes) -> bytes:
    """Aplica ajustes de contraste e nitidez para melhorar OCR."""
    try:
        from PIL import Image, ImageEnhance
        import io

        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("L")  # escala de cinza
        img = ImageEnhance.Contrast(img).enhance(2.0)
        img = ImageEnhance.Sharpness(img).enhance(2.0)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except ImportError:
        logger.warning("Pillow não instalado.")
        return image_bytes
