"""When the configured model provider fails, the other one answers the same call."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from openai import OpenAIError

from sitetwin3d import server


class FakeOpenAI:
    """Stands in for the OpenAI client: the providers listed in `down` fail, the others answer."""

    down: set[str] = set()
    calls: list[str] = []

    def __init__(self, base_url, api_key, timeout, max_retries):
        self.base_url = base_url
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, model, messages, temperature, **kwargs):
        FakeOpenAI.calls.append(model)
        if any(host in self.base_url for host in FakeOpenAI.down):
            raise OpenAIError("service unavailable")
        message = SimpleNamespace(model_dump=lambda exclude_none: {"role": "assistant", "content": f"answer from {model}"})
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(server, "OpenAI", FakeOpenAI)
    monkeypatch.setenv("BASETEN_API_KEY", "test")
    monkeypatch.setenv("MODEL_API_KEY", "test")
    monkeypatch.delenv("AGENT_PROVIDER", raising=False)
    FakeOpenAI.calls = []
    return TestClient(server.app)


def ask(client):
    return client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}], "tools": []})


def test_the_configured_provider_answers_when_it_is_up(client):
    FakeOpenAI.down = set()
    r = ask(client)
    assert r.status_code == 200 and r.json()["model"] == "meta-models/muse-spark-open-1026"
    assert FakeOpenAI.calls == ["meta-models/muse-spark-open-1026"]


def test_the_meta_model_api_answers_when_baseten_fails(client):
    FakeOpenAI.down = {"baseten"}
    r = ask(client)
    assert r.status_code == 200
    assert r.json()["model"] == "muse-spark-1.3" and r.json()["message"]["content"] == "answer from muse-spark-1.3"


def test_both_down_is_one_plain_error(client):
    FakeOpenAI.down = {"baseten", "meta.ai"}
    r = ask(client)
    assert r.status_code == 502 and "baseten" in r.json()["detail"] and "meta" in r.json()["detail"]


def test_a_missing_key_skips_that_provider(client, monkeypatch):
    monkeypatch.delenv("BASETEN_API_KEY")
    FakeOpenAI.down = set()
    r = ask(client)
    assert r.status_code == 200 and FakeOpenAI.calls == ["muse-spark-1.3"]
