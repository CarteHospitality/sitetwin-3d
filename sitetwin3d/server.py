"""Serves the viewer and relays planning-assistant calls to the model.

The API key stays on the server. The agent's tools run in the browser,
next to the 3D twin, so every option the agent tries uses the same EMF,
conflict and coverage code the engineer sees.

    python -m sitetwin3d.server            # http://localhost:8765
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as Late
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI, OpenAIError
from PIL import Image
from pydantic import BaseModel

from .extract import PROVIDERS, extract
from .portfolio import import_site

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
# The planning agent runs on the open-weight model by default; AGENT_PROVIDER=wonder runs it on
# Muse Wonder (Meta Model API, same key), with the same tools on the same twin.
AGENT_MODELS = {"baseten": PROVIDERS["baseten"], "meta": PROVIDERS["meta"],
                "wonder": {**PROVIDERS["meta"], "model": "muse-wonder-1.0"}}

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
app = FastAPI(title="SiteTwin 3D")

# The public demo (SITETWIN_PUBLIC=1, e.g. behind a reverse proxy at sitetwin.tr/3d/): sample sites
# only, no file loading, and a daily cap on model calls per visitor and in all, so the keys' cost
# stays bounded. Counted in memory: a restart starts the day again.
PUBLIC = os.environ.get("SITETWIN_PUBLIC") == "1"
DAILY_PER_VISITOR = int(os.environ.get("SITETWIN_DAILY_PER_VISITOR", "60"))
DAILY_TOTAL = int(os.environ.get("SITETWIN_DAILY_TOTAL", "1500"))
_used: dict[tuple[str, str], int] = {}
_used_lock = threading.Lock()
PRIVATE_PATH = re.compile(r"/data/(private|uploads)(/|$)")


def _count_call(request: Request) -> None:
    if not PUBLIC:
        return
    day = time.strftime("%Y-%m-%d")
    # Behind Cloudflare the visitor is CF-Connecting-IP; the socket address is the proxy's.
    visitor = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    with _used_lock:
        for key in [k for k in _used if k[0] != day]:
            del _used[key]
        if _used.get((day, "*"), 0) >= DAILY_TOTAL or _used.get((day, visitor), 0) >= DAILY_PER_VISITOR:
            raise HTTPException(status_code=429, detail="the public demo's daily limit is reached")
        _used[(day, "*")] = _used.get((day, "*"), 0) + 1
        _used[(day, visitor)] = _used.get((day, visitor), 0) + 1


@app.middleware("http")
async def no_private_data_in_public(request: Request, call_next):
    # The public demo never serves an operator's own sites or loaded files, even if they are on disk,
    # wherever the app is mounted (a reverse proxy may keep its prefix: /3d/data/private/...).
    if PUBLIC and PRIVATE_PATH.search(request.url.path):
        return Response(status_code=404)
    return await call_next(request)


@app.middleware("http")
async def no_stale_pages(request: Request, call_next):
    # The viewer is plain ES modules; make browsers revalidate so edits and new twins show up.
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-cache")
    return response


class ChatRequest(BaseModel):
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]


# Now and then the open model writes its raw chat-template tokens as text
# instead of a structured tool call. Such a turn is asked again; if it still
# leaks, the markup is stripped so the engineer only sees readable text.
LEAK = re.compile(r"<\|[a-z_]+\|>|</?atem:[^>]*>")
LEAK_HEADER = re.compile(r"<\|start\|>assistant to=\S+?<\|message\|>")


def _clean(text: str) -> str:
    text = re.sub(r"<atem:function_calls>.*?</atem:function_calls>", "", text, flags=re.S)
    text = LEAK_HEADER.sub("", text)
    return LEAK.sub("", text).strip()


def _providers() -> list[str]:
    """The configured provider first, then the other one, each only if its key is set."""
    first = os.environ.get("AGENT_PROVIDER", "baseten")
    return [p for p in (first, *(p for p in AGENT_MODELS if p != first)) if os.environ.get(AGENT_MODELS[p]["key_env"])]


# Each provider's whole budget, its leak retries included: both together stay under the page's
# 60 s limit for one model call (viewer/agent.js). A call still running at its deadline is abandoned,
# since the HTTP client's timeouts bound each read, not the whole answer.
TIMEOUTS_S = (30, 25)
# A leaked turn is asked again only while this much of the budget is left.
RETRY_MIN_S = 5
CALLS = ThreadPoolExecutor(max_workers=8, thread_name_prefix="model-call")


def _create(client: OpenAI, cfg: dict, req: ChatRequest, left: float):
    future = CALLS.submit(client.chat.completions.create, model=cfg["model"], messages=req.messages, temperature=0.2,
                          timeout=left, **({"tools": req.tools} if req.tools else {}))
    try:
        return future.result(timeout=max(left, 0.0))
    except Late:
        raise OpenAIError(f"{cfg['model']} gave no answer before its deadline") from None


def _ask(cfg: dict, req: ChatRequest, budget: float) -> dict:
    client = OpenAI(base_url=cfg["base_url"], api_key=os.environ[cfg["key_env"]], max_retries=0)
    deadline = time.monotonic() + budget
    for attempt in range(3):
        left = deadline - time.monotonic()
        if attempt and left < RETRY_MIN_S:
            break
        response = _create(client, cfg, req, left)
        message = response.choices[0].message.model_dump(exclude_none=True)
        message.setdefault("content", "")
        if not LEAK.search(message["content"] or ""):
            break
    message["content"] = _clean(message["content"] or "")
    message.pop("reasoning_content", None)
    return message


@app.get("/api/health")
def health() -> dict:
    """The page asks this to tell its own server from a static host, and a public demo from a local run."""
    return {"ok": True, "public": PUBLIC}


@app.post("/api/chat")
def chat(req: ChatRequest, request: Request) -> dict:
    # If the configured provider fails (outage, quota, timeout), the other one answers this call;
    # the page shows which model answered, and whether it was the fallback.
    _count_call(request)
    providers = _providers()
    if not providers:
        raise HTTPException(status_code=503, detail="no model API key configured (BASETEN_API_KEY or MODEL_API_KEY)")
    errors = []
    for i, (name, timeout) in enumerate(zip(providers, TIMEOUTS_S)):
        cfg = AGENT_MODELS[name]
        try:
            return {"message": _ask(cfg, req, timeout), "model": cfg["model"], "fallback": i > 0}
        except OpenAIError as e:
            errors.append(f"{name}: {e}")
    raise HTTPException(status_code=502, detail="; ".join(errors)[:1000])


TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe"


def _need_meta_key(what: str) -> None:
    """Voice and photo run on the Meta Model API: without its key, say so instead of failing."""
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(status_code=503, detail=f"{what} needs MODEL_API_KEY (Meta Model API) in .env, see the README")


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    """Voice mode: the browser posts a 16 kHz mono WAV; Muse Voice Transcribe returns the text."""
    _need_meta_key("Voice")
    _count_call(request)
    wav = await request.body()
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            TRANSCRIBE_URL,
            headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY']}", "Accept": "text/plain"},
            files={
                "request": (None, json.dumps({"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"}), "application/json"),
                "audio": ("speech.wav", wav, "audio/wav"),
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=r.text[:500])
    return {"text": " ".join(line.strip() for line in r.text.splitlines() if line.strip())}


@app.post("/api/photo")
async def read_photo(request: Request) -> dict:
    """Photo mode: Muse Spark 1.3 reads one site photo into equipment, labels and safety notes."""
    _need_meta_key("Photo reading")
    _count_call(request)
    data = await request.body()
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception as e:
        raise HTTPException(status_code=400, detail="not an image (JPEG or PNG)") from e
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "photo.jpg"
        path.write_bytes(data)
        try:
            record = await asyncio.to_thread(extract, path, "meta")
        except Exception as e:  # unreadable image or model error: tell the page, keep the server up
            raise HTTPException(status_code=502, detail=str(e)[:500]) from e
    return record.model_dump(exclude_none=True)


@app.post("/api/import")
def import_sitetwin(doc: dict[str, Any]) -> dict:
    """Load a SiteTwin site file: build its twin with real surroundings and add it to the map."""
    if PUBLIC:
        raise HTTPException(status_code=403, detail="loading site files is off on the public demo")
    try:
        return import_site(doc, VIEWER / "data" / "uploads", web_root=VIEWER)
    except (KeyError, ValueError) as e:
        why = f"missing field {e}" if isinstance(e, KeyError) else str(e)
        raise HTTPException(status_code=400, detail=f"not a usable SiteTwin file: {why}") from e


app.mount("/", StaticFiles(directory=VIEWER, html=True), name="viewer")


def mounted(prefix: str) -> FastAPI:
    """The app under a path prefix (SITETWIN_PREFIX=/3d), for a tunnel or proxy that passes the path on
    as it is (Cloudflare Tunnel does): sitetwin.tr/3d/portfolio.html reaches /portfolio.html here."""
    root = FastAPI()
    root.add_api_route(prefix, lambda: RedirectResponse(f"{prefix}/"), include_in_schema=False)
    root.mount(prefix, app)
    return root


if __name__ == "__main__":
    prefix = os.environ.get("SITETWIN_PREFIX", "").strip("/")
    prefix = f"/{prefix}" if prefix else ""
    uvicorn.run(mounted(prefix) if prefix else app, host="127.0.0.1", port=int(os.environ.get("PORT", 8765)))
