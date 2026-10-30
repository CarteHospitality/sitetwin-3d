"""Serves the viewer and relays planning-assistant calls to the model.

The API key stays on the server. The agent's tools run in the browser,
next to the 3D twin, so every option the agent tries uses the same EMF,
conflict and coverage code the engineer sees.

    python -m sitetwin3d.server            # http://localhost:8765
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from openai import OpenAI, OpenAIError
from pydantic import BaseModel

from .extract import PROVIDERS
from .portfolio import import_site

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
# The planning agent runs on the open-weight model by default.
AGENT_MODELS = {"baseten": PROVIDERS["baseten"], "meta": PROVIDERS["meta"]}

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
app = FastAPI(title="SiteTwin 3D")


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


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict:
    cfg = AGENT_MODELS[os.environ.get("AGENT_PROVIDER", "baseten")]
    client = OpenAI(base_url=cfg["base_url"], api_key=os.environ[cfg["key_env"]])
    for _ in range(3):
        try:
            response = client.chat.completions.create(
                model=cfg["model"], messages=req.messages, temperature=0.2,
                **({"tools": req.tools} if req.tools else {}),
            )
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e
        message = response.choices[0].message.model_dump(exclude_none=True)
        message.setdefault("content", "")
        if not LEAK.search(message["content"] or ""):
            break
    message["content"] = _clean(message["content"] or "")
    message.pop("reasoning_content", None)
    return {"message": message, "model": cfg["model"]}


TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe"


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    """Voice mode: the browser posts a 16 kHz mono WAV; Muse Voice Transcribe returns the text."""
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


@app.post("/api/import")
def import_sitetwin(doc: dict[str, Any]) -> dict:
    """Load a SiteTwin site file: build its twin with real surroundings and add it to the map."""
    try:
        return import_site(doc, VIEWER / "data" / "uploads", web_root=VIEWER)
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"not a usable SiteTwin file: {e}") from e


app.mount("/", StaticFiles(directory=VIEWER, html=True), name="viewer")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8765)))
