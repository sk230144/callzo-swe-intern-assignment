"""Webhook signature and API key checks. Both compare in constant time."""

import hashlib
import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.metrics import WEBHOOK_REQUESTS

_bearer = HTTPBearer(auto_error=False)

SettingsDep = Annotated[Settings, Depends(get_settings)]


def is_valid_signature(secret: str, body: bytes, signature: str | None) -> bool:
    if signature is None:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), signature.encode())


async def verified_body(request: Request, settings: SettingsDep) -> bytes:
    """Return the raw request body, or reject the request if its signature is wrong."""
    body = await request.body()
    signature = request.headers.get("x-signature")
    if not is_valid_signature(settings.webhook_secret.get_secret_value(), body, signature):
        WEBHOOK_REQUESTS.labels(outcome="bad_signature").inc()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing signature")
    return body


def require_api_key(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: SettingsDep,
) -> None:
    expected = settings.api_key.get_secret_value().encode()
    if credentials is None or not hmac.compare_digest(expected, credentials.credentials.encode()):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or missing API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
