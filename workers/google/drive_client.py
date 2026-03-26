"""
Google Drive — Criar pastas de clientes e upload de documentos.
"""
import os
import io
import logging
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

logger = logging.getLogger("workers.google.drive")


def _get_service():
    """Cria o serviço do Drive autenticado via OAuth refresh token."""
    creds = Credentials(
        token=None,
        refresh_token=os.getenv("GOOGLE_REFRESH_TOKEN"),
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        token_uri="https://oauth2.googleapis.com/token",
    )
    return build("drive", "v3", credentials=creds)


async def get_or_create_client_folder(client_name: str, existing_folder_id: str = None) -> dict:
    """Busca ou cria a pasta do cliente dentro da pasta raiz."""
    if existing_folder_id:
        service = _get_service()
        try:
            folder = service.files().get(
                fileId=existing_folder_id, fields="id, name, webViewLink"
            ).execute()
            return folder
        except Exception:
            pass  # Pasta pode ter sido deletada, criar nova

    root_id = os.getenv("GOOGLE_DRIVE_ROOT_FOLDER_ID")
    service = _get_service()

    # Busca pasta existente pelo nome
    query = (
        f"name='{client_name}' and mimeType='application/vnd.google-apps.folder' "
        f"and '{root_id}' in parents and trashed=false"
    )
    results = service.files().list(q=query, fields="files(id, name, webViewLink)").execute()
    files = results.get("files", [])

    if files:
        logger.info(f"Pasta encontrada: {files[0]['name']}")
        return files[0]

    # Criar nova pasta
    metadata = {
        "name": client_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [root_id],
    }
    folder = service.files().create(body=metadata, fields="id, name, webViewLink").execute()
    logger.info(f"Pasta criada: {folder['name']}")
    return folder


async def create_named_folder(folder_name: str, parent_id: str = None) -> dict:
    """Cria (ou retorna) uma pasta com nome específico na raiz ou dentro de um pai."""
    root_id = parent_id or os.getenv("GOOGLE_DRIVE_ROOT_FOLDER_ID")
    service = _get_service()

    # Busca pasta existente pelo nome
    query = (
        f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' "
        f"and '{root_id}' in parents and trashed=false"
    )
    results = service.files().list(q=query, fields="files(id, name, webViewLink)").execute()
    files = results.get("files", [])

    if files:
        logger.info(f"Pasta já existe: {files[0]['name']}")
        return files[0]

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [root_id],
    }
    folder = service.files().create(body=metadata, fields="id, name, webViewLink").execute()
    logger.info(f"Pasta criada: {folder['name']}")
    return folder


async def create_subfolder(parent_folder_id: str, subfolder_name: str) -> dict:
    """Cria (ou retorna) uma subpasta dentro de uma pasta pai."""
    return await create_named_folder(subfolder_name, parent_id=parent_folder_id)


async def upload_file(
    folder_id: str, file_name: str, file_bytes: bytes, mime_type: str
) -> dict:
    """Faz upload de um arquivo para a pasta do cliente."""
    service = _get_service()

    metadata = {"name": file_name, "parents": [folder_id]}
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type)

    result = service.files().create(
        body=metadata, media_body=media, fields="id, name, webViewLink"
    ).execute()

    logger.info(f"Upload concluído: {result['name']}")
    return result
