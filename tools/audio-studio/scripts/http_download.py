"""Bounded HTTP ranges for hosts where multi-GB streaming responses stall."""
from __future__ import annotations

import hashlib
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def download_ranges(url: str, destination: Path, size: int, sha256: str, *, chunk_bytes: int = 16 * 1024**2, workers: int = 4) -> Path:
    import httpx

    if not re.fullmatch(r"[0-9a-fA-F]{64}", sha256):
        raise ValueError("A trusted SHA-256 is required for ranged downloads")
    if size <= 0 or chunk_bytes <= 0 or not 1 <= workers <= 8:
        raise ValueError("Invalid download size, chunk size or worker count")
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_name(destination.name + ".http-part")
    marker = part.with_name(part.name + ".sha256")
    if part.exists() and (not marker.exists() or marker.read_text() != sha256):
        raise ValueError("Partial download belongs to a different artifact; choose a fresh destination")
    marker.write_text(sha256)
    offset = part.stat().st_size if part.exists() else 0
    if offset > size:
        raise ValueError("Partial download exceeds the expected file size")
    with httpx.Client(follow_redirects=True, timeout=30) as client, part.open("ab") as output:
        def fetch(start: int, end: int) -> bytes:
            for attempt in range(5):
                try:
                    with client.stream("GET", url, headers={"Range": f"bytes={start}-{end}"}) as response:
                        response.raise_for_status()
                        if response.status_code != 206 or response.headers.get("content-range") != f"bytes {start}-{end}/{size}":
                            raise ValueError("Server did not honor the requested byte range")
                        content = bytearray()
                        for block in response.iter_bytes(chunk_size=64 * 1024):
                            content.extend(block)
                            if len(content) > end - start + 1:
                                raise ValueError("HTTP range exceeded its declared size")
                        if len(content) != end - start + 1:
                            raise ValueError("Incomplete HTTP byte range")
                        return bytes(content)
                except httpx.HTTPError as exc:
                    if attempt == 4:
                        # Signed URLs can contain credentials; do not echo them.
                        raise RuntimeError(f"Download interrupted ({type(exc).__name__}) while fetching byte {start}; rerun to resume the saved contiguous data") from None
                    time.sleep(min(attempt + 1, 5))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            while offset < size:
                ranges = [(start, min(start + chunk_bytes, size) - 1) for start in range(offset, min(offset + workers * chunk_bytes, size), chunk_bytes)]
                pending = [pool.submit(fetch, start, end) for start, end in ranges]
                # Persist only contiguous verified ranges, even if later requests
                # finish first. At most `workers` chunks are held in memory.
                for (_, end), future in zip(ranges, pending):
                    output.write(future.result())
                    output.flush()
                    offset = end + 1
                print(f"{destination.name}: {offset}/{size} bytes", flush=True)
    with part.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual.lower() != sha256.lower():
        raise ValueError("Downloaded artifact failed the official SHA-256 check; it was not installed")
    os.replace(part, destination)
    marker.unlink()
    return destination
