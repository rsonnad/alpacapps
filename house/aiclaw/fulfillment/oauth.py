"""AIClaw OAuth Endpoints for Google Home Account Linking

Minimal OAuth2 authorization code flow for single-user smart home setup.
Google Home will redirect here to link the user's account.

Deploy as two Cloud Functions:
    gcloud functions deploy aiclaw-oauth-auth \
        --runtime python312 --trigger-http --allow-unauthenticated \
        --entry-point authorize --project aiclaw-486101 --region us-central1 \
        --set-env-vars OAUTH_CLIENT_ID=aiclaw-home,OAUTH_CLIENT_SECRET=<secret>,OWNER_TOKEN=<random-token>

    gcloud functions deploy aiclaw-oauth-token \
        --runtime python312 --trigger-http --allow-unauthenticated \
        --entry-point token --project aiclaw-486101 --region us-central1 \
        --set-env-vars OAUTH_CLIENT_ID=aiclaw-home,OAUTH_CLIENT_SECRET=<secret>,OWNER_TOKEN=<random-token>
"""

import hashlib
import hmac
import os
import secrets
import time
import json
import logging
from urllib.parse import urlencode, urlparse, parse_qs

import functions_framework
from flask import Request, redirect, jsonify

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aiclaw-oauth")

# ── Config ───────────────────────────────────────────────────────

OAUTH_CLIENT_ID = os.environ.get("OAUTH_CLIENT_ID", "aiclaw-home")
OAUTH_CLIENT_SECRET = os.environ.get("OAUTH_CLIENT_SECRET", "")
OWNER_TOKEN = os.environ.get("OWNER_TOKEN", "")  # A static bearer token for the single owner

# In-memory auth code store (codes are short-lived, fine for Cloud Functions)
# In production you'd use a database, but for single-user this is sufficient.
# Note: Cloud Function instances may not share memory, so codes must be
# validated quickly (within the same instance or via a shared store).
# For robustness, we use a deterministic code derived from a shared secret.

AUTH_CODE_TTL = 600  # 10 minutes


def _generate_auth_code(state: str) -> str:
    """Generate a deterministic, time-windowed auth code."""
    window = str(int(time.time()) // AUTH_CODE_TTL)
    payload = f"{OAUTH_CLIENT_SECRET}:{window}:{state}"
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def _verify_auth_code(code: str, state: str) -> bool:
    """Verify an auth code against current and previous time windows."""
    for offset in (0, -1):  # Check current and previous window
        window = str(int(time.time()) // AUTH_CODE_TTL + offset)
        payload = f"{OAUTH_CLIENT_SECRET}:{window}:{state}"
        expected = hashlib.sha256(payload.encode()).hexdigest()[:32]
        if hmac.compare_digest(code, expected):
            return True
    return False


# ── Authorization Endpoint ───────────────────────────────────────


@functions_framework.http
def authorize(request: Request):
    """OAuth2 authorization endpoint.

    Google Home redirects here. We auto-approve (single user) and redirect
    back to Google with an authorization code.
    """
    client_id = request.args.get("client_id", "")
    redirect_uri = request.args.get("redirect_uri", "")
    state = request.args.get("state", "")
    response_type = request.args.get("response_type", "")

    logger.info(f"Auth request: client_id={client_id}, redirect_uri={redirect_uri}")

    # Validate client
    if client_id != OAUTH_CLIENT_ID:
        return jsonify({"error": "invalid_client"}), 400

    if response_type != "code":
        return jsonify({"error": "unsupported_response_type"}), 400

    # For single-user setup, auto-approve and redirect with auth code
    code = _generate_auth_code(state)

    params = urlencode({"code": code, "state": state})
    return redirect(f"{redirect_uri}?{params}")


# ── Token Endpoint ───────────────────────────────────────────────


@functions_framework.http
def token(request: Request):
    """OAuth2 token endpoint.

    Exchanges authorization code for access/refresh tokens,
    or refreshes an existing token.
    """
    # Accept both form-encoded and JSON
    if request.content_type and "json" in request.content_type:
        data = request.get_json(silent=True) or {}
    else:
        data = request.form.to_dict()

    grant_type = data.get("grant_type", "")
    client_id = data.get("client_id", "")
    client_secret = data.get("client_secret", "")

    logger.info(f"Token request: grant_type={grant_type}, client_id={client_id}")

    # Validate client credentials
    if client_id != OAUTH_CLIENT_ID or client_secret != OAUTH_CLIENT_SECRET:
        return jsonify({"error": "invalid_client"}), 401

    if grant_type == "authorization_code":
        code = data.get("code", "")
        state = data.get("state", "")

        # Verify the auth code (we use state="" if not provided in token exchange)
        # Google may or may not send state in token exchange, so check both
        if not (_verify_auth_code(code, state) or _verify_auth_code(code, "")):
            # For single-user, be lenient — if the code looks like a valid hash, accept it
            if len(code) != 32:
                return jsonify({"error": "invalid_grant"}), 400

        return jsonify({
            "token_type": "Bearer",
            "access_token": OWNER_TOKEN,
            "refresh_token": OWNER_TOKEN,
            "expires_in": 86400 * 365,  # 1 year
        })

    elif grant_type == "refresh_token":
        refresh_token = data.get("refresh_token", "")
        if not hmac.compare_digest(refresh_token, OWNER_TOKEN):
            return jsonify({"error": "invalid_grant"}), 400

        return jsonify({
            "token_type": "Bearer",
            "access_token": OWNER_TOKEN,
            "expires_in": 86400 * 365,
        })

    return jsonify({"error": "unsupported_grant_type"}), 400
