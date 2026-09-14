from __future__ import annotations

import hashlib
import importlib.util
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "http_download.py"
SPEC = importlib.util.spec_from_file_location("audio_studio_http_download", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
http_download = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(http_download)


class FakeHTTPError(Exception):
    pass


class FakeResponse:
    def __init__(self, content: bytes = b"", *, status_code: int = 206, headers=None, error=None):
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}
        self.error = error

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def raise_for_status(self):
        if self.error is not None:
            raise self.error

    def iter_bytes(self, chunk_size=None):
        del chunk_size
        if self.error is not None:
            raise self.error
        yield self.content


class FakeClient:
    def __init__(self, payload: bytes, requests: list[dict], *, error: Exception | None = None, bad_range: bool = False):
        self.payload = payload
        self.requests = requests
        self.error = error
        self.bad_range = bad_range

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def stream(self, method, url, *, headers):
        assert method == "GET"
        self.requests.append({"url": url, "headers": dict(headers)})
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", headers["Range"])
        assert match is not None
        start, end = (int(value) for value in match.groups())
        total = len(self.payload)
        if self.error is not None:
            return FakeResponse(error=self.error)
        content_range = f"bytes {start}-{end}/{total}"
        if self.bad_range:
            content_range = f"bytes 0-{end}/{total}"
        return FakeResponse(
            self.payload[start : end + 1],
            headers={"content-range": content_range},
        )


def install_fake_httpx(monkeypatch, payload: bytes, *, error=None, bad_range=False):
    requests: list[dict] = []
    clients: list[FakeClient] = []

    def client_factory(*_args, **_kwargs):
        client = FakeClient(payload, requests, error=error, bad_range=bad_range)
        clients.append(client)
        return client

    monkeypatch.setitem(
        sys.modules,
        "httpx",
        SimpleNamespace(Client=client_factory, HTTPError=FakeHTTPError),
    )
    monkeypatch.setattr(http_download.time, "sleep", lambda _seconds: None)
    return requests, clients


def test_downloads_exact_byte_ranges_and_verifies_before_install(tmp_path, monkeypatch):
    payload = b"0123456789abcdef"
    requests, _ = install_fake_httpx(monkeypatch, payload)
    destination = tmp_path / "model.safetensors"

    result = http_download.download_ranges(
        "https://example.invalid/model",
        destination,
        len(payload),
        hashlib.sha256(payload).hexdigest(),
        chunk_bytes=5,
        workers=1,
    )

    assert result == destination
    assert destination.read_bytes() == payload
    assert [request["headers"]["Range"] for request in requests] == [
        "bytes=0-4",
        "bytes=5-9",
        "bytes=10-14",
        "bytes=15-15",
    ]
    assert not destination.with_name(destination.name + ".http-part").exists()
    assert not destination.with_name(destination.name + ".http-part.sha256").exists()


def test_resume_starts_at_partial_length_only_with_matching_hash_marker(tmp_path, monkeypatch):
    payload = b"0123456789"
    digest = hashlib.sha256(payload).hexdigest()
    destination = tmp_path / "model.bin"
    part = destination.with_name(destination.name + ".http-part")
    marker = part.with_name(part.name + ".sha256")
    part.write_bytes(payload[:4])
    marker.write_text(digest, encoding="utf-8")
    requests, _ = install_fake_httpx(monkeypatch, payload)

    http_download.download_ranges(
        "https://example.invalid/model",
        destination,
        len(payload),
        digest,
        chunk_bytes=3,
        workers=1,
    )

    assert destination.read_bytes() == payload
    assert requests[0]["headers"]["Range"] == "bytes=4-6"


def test_mismatched_resume_marker_fails_before_network_and_preserves_files(tmp_path, monkeypatch):
    payload = b"0123456789"
    destination = tmp_path / "model.bin"
    destination.write_bytes(b"existing destination")
    part = destination.with_name(destination.name + ".http-part")
    marker = part.with_name(part.name + ".sha256")
    part.write_bytes(payload[:4])
    marker.write_text("0" * 64, encoding="utf-8")
    requests, _ = install_fake_httpx(monkeypatch, payload)

    with pytest.raises(ValueError, match="different artifact"):
        http_download.download_ranges(
            "https://example.invalid/model",
            destination,
            len(payload),
            hashlib.sha256(payload).hexdigest(),
            chunk_bytes=3,
            workers=1,
        )

    assert requests == []
    assert destination.read_bytes() == b"existing destination"
    assert part.read_bytes() == payload[:4]
    assert marker.read_text(encoding="utf-8") == "0" * 64


def test_hash_mismatch_does_not_replace_existing_destination(tmp_path, monkeypatch):
    payload = b"downloaded bytes"
    destination = tmp_path / "model.bin"
    destination.write_bytes(b"keep this signed artifact")
    expected = hashlib.sha256(b"different bytes").hexdigest()
    requests, _ = install_fake_httpx(monkeypatch, payload)

    with pytest.raises(ValueError, match="SHA-256 check"):
        http_download.download_ranges(
            "https://example.invalid/model",
            destination,
            len(payload),
            expected,
            chunk_bytes=64,
            workers=1,
        )

    part = destination.with_name(destination.name + ".http-part")
    marker = part.with_name(part.name + ".sha256")
    assert requests
    assert destination.read_bytes() == b"keep this signed artifact"
    assert part.read_bytes() == payload
    assert marker.read_text(encoding="utf-8") == expected


def test_network_errors_do_not_echo_signed_url_or_destroy_destination(tmp_path, monkeypatch, capsys):
    secret_url = "https://example.invalid/model?token=TOP_SECRET&X-Amz-Signature=SIGNED_SECRET"
    destination = tmp_path / "model.bin"
    destination.write_bytes(b"preserve on transport failure")
    requests, _ = install_fake_httpx(
        monkeypatch,
        b"ignored",
        error=FakeHTTPError(f"request failed for {secret_url}"),
    )

    with pytest.raises(RuntimeError) as error:
        http_download.download_ranges(
            secret_url,
            destination,
            7,
            hashlib.sha256(b"ignored").hexdigest(),
            chunk_bytes=7,
            workers=1,
        )

    output = capsys.readouterr()
    message = str(error.value) + output.out + output.err
    assert "TOP_SECRET" not in message
    assert "SIGNED_SECRET" not in message
    assert secret_url not in message
    assert destination.read_bytes() == b"preserve on transport failure"
    assert requests


def test_server_range_mismatch_is_rejected_without_replacing_destination(tmp_path, monkeypatch):
    payload = b"012345"
    destination = tmp_path / "model.bin"
    destination.write_bytes(b"old")
    requests, _ = install_fake_httpx(monkeypatch, payload, bad_range=True)

    with pytest.raises(ValueError, match="byte range"):
        http_download.download_ranges(
            "https://example.invalid/model",
            destination,
            len(payload),
            hashlib.sha256(payload).hexdigest(),
            chunk_bytes=3,
            workers=1,
        )

    assert requests[0]["headers"]["Range"] == "bytes=0-2"
    assert destination.read_bytes() == b"old"

