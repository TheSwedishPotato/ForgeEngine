import time

import pytest
from fastapi.testclient import TestClient

from forge_dub.config import Settings
from forge_dub.server import create_app


@pytest.fixture
def client(tmp_path):
    settings = Settings(engine_mode="mock", data_dir=tmp_path)
    return TestClient(create_app(settings))


def _wait_done(client, job_id, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.15)
    raise AssertionError("job did not finish in time")


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "mock"
    assert body["app"] == "ForgeDub"


def test_missing_input_is_rejected(client):
    res = client.post("/api/jobs", data={})
    assert res.status_code == 400


def test_url_dub_end_to_end(client):
    res = client.post("/api/jobs", data={"url": "https://example.com/video"})
    assert res.status_code == 201, res.text
    job_id = res.json()["id"]

    job = _wait_done(client, job_id)
    assert job["status"] == "done", job
    assert job["has_output"]
    assert job["segments"]
    assert job["segments"][0]["text_tgt"]

    assert client.get(f"/api/jobs/{job_id}/preview").status_code == 200
    assert client.get(f"/api/jobs/{job_id}/download").status_code == 200


def test_upload_dub_end_to_end(client):
    files = {"file": ("clip.mp4", b"\x00\x00not-a-real-video", "video/mp4")}
    res = client.post("/api/jobs", files=files, data={"voice_clone": "true"})
    assert res.status_code == 201, res.text
    job_id = res.json()["id"]

    job = _wait_done(client, job_id)
    assert job["status"] == "done", job
    assert job["has_output"]
