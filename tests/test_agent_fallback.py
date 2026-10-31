"""When the configured model provider fails, the other one answers the same call."""

from types import SimpleNamespace

import time

import pytest
from fastapi.testclient import TestClient
from openai import OpenAIError

from sitetwin3d import server


class FakeOpenAI:
    """Stands in for the OpenAI client: the providers listed in `down` fail, the others answer.
    With `leak` set every answer leaks chat-template markup, and each call takes `cost_s` on the
    fake clock (at most the timeout it was given). The providers listed in `hang` stall for real
    time, ignoring the timeout they were given."""

    down: set[str] = set()
    hang: set[str] = set()
    calls: list[str] = []
    leak = False
    cost_s = 0.0
    clock = 0.0

    def __init__(self, base_url, api_key, max_retries, timeout=None):
        self.base_url = base_url
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, model, messages, temperature, timeout=None, **kwargs):
        FakeOpenAI.calls.append(model)
        FakeOpenAI.clock += min(FakeOpenAI.cost_s, timeout if timeout is not None else FakeOpenAI.cost_s)
        if any(host in self.base_url for host in FakeOpenAI.hang):
            time.sleep(2)
        if any(host in self.base_url for host in FakeOpenAI.down):
            raise OpenAIError("service unavailable")
        text = "<|start|>assistant to=functions.x<|message|>{}" if FakeOpenAI.leak else f"answer from {model}"
        message = SimpleNamespace(model_dump=lambda exclude_none: {"role": "assistant", "content": text})
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(server, "OpenAI", FakeOpenAI)
    monkeypatch.setenv("BASETEN_API_KEY", "test")
    monkeypatch.setenv("MODEL_API_KEY", "test")
    monkeypatch.delenv("AGENT_PROVIDER", raising=False)
    monkeypatch.setattr(server.time, "monotonic", lambda: FakeOpenAI.clock)
    FakeOpenAI.calls, FakeOpenAI.leak, FakeOpenAI.cost_s, FakeOpenAI.clock = [], False, 0.0, 0.0
    FakeOpenAI.hang = set()
    return TestClient(server.app)


def ask(client):
    return client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}], "tools": []})


def test_the_configured_provider_answers_when_it_is_up(client):
    FakeOpenAI.down = set()
    r = ask(client)
    assert r.status_code == 200 and r.json()["model"] == "meta-models/muse-spark-open-1026"
    assert r.json()["fallback"] is False
    assert FakeOpenAI.calls == ["meta-models/muse-spark-open-1026"]


def test_the_meta_model_api_answers_when_baseten_fails(client):
    FakeOpenAI.down = {"baseten"}
    r = ask(client)
    assert r.status_code == 200
    assert r.json()["model"] == "muse-spark-1.3" and r.json()["message"]["content"] == "answer from muse-spark-1.3"
    assert r.json()["fallback"] is True


def test_both_down_is_one_plain_error(client):
    FakeOpenAI.down = {"baseten", "meta.ai"}
    r = ask(client)
    assert r.status_code == 502 and "baseten" in r.json()["detail"] and "meta" in r.json()["detail"]


def test_a_missing_key_skips_that_provider(client, monkeypatch):
    monkeypatch.delenv("BASETEN_API_KEY")
    FakeOpenAI.down = set()
    r = ask(client)
    assert r.status_code == 200 and FakeOpenAI.calls == ["muse-spark-1.3"]
    # The only provider with a key answered: that is not a fallback.
    assert r.json()["fallback"] is False


def test_leak_retries_stay_within_the_provider_budget(client):
    # Every answer leaks and each call takes 20 s: the second try gets only what is left of the
    # 30 s budget, and no third try starts, so the page's 60 s limit is never at risk.
    FakeOpenAI.down, FakeOpenAI.leak, FakeOpenAI.cost_s = set(), True, 20.0
    r = ask(client)
    assert r.status_code == 200
    assert FakeOpenAI.calls == ["meta-models/muse-spark-open-1026"] * 2
    assert FakeOpenAI.clock <= server.TIMEOUTS_S[0]
    assert "<|" not in r.json()["message"]["content"]


def test_a_call_that_hangs_is_cut_at_the_provider_deadline(client, monkeypatch):
    # Baseten stalls past its whole budget: the call is abandoned at the deadline and the
    # Meta Model API answers, well before the stalled call would have returned.
    monkeypatch.setattr(server, "TIMEOUTS_S", (0.3, 0.3))
    FakeOpenAI.down, FakeOpenAI.hang = set(), {"baseten"}
    start = time.perf_counter()
    r = ask(client)
    assert r.status_code == 200 and r.json()["model"] == "muse-spark-1.3" and r.json()["fallback"] is True
    assert time.perf_counter() - start < 1.5


def test_the_page_can_tell_it_has_a_server(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_voice_without_the_meta_key_says_what_is_missing(client, monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY")
    r = client.post("/api/transcribe", content=b"RIFF")
    assert r.status_code == 503 and "MODEL_API_KEY" in r.json()["detail"]
