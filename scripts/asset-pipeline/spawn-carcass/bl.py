"""Run a script inside the live Blender through the Blender Lab MCP add-on socket (localhost:9876).

    python -I scripts/asset-pipeline/spawn-carcass/bl.py <script.py> [timeout_s] [label]

ROOT (repository root), LIVE (build/spawn-structure/live, the working folder for intermediate maps) and
LABEL are injected in front of the script, because code sent through the socket has no __file__.
"""
import json
import socket
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[3].as_posix()
code = Path(sys.argv[1]).read_text(encoding='utf8')
timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 600
label = sys.argv[3] if len(sys.argv) > 3 else 'v6'
prefix = f"ROOT = {root!r}\nLIVE = {root + '/build/spawn-structure/live'!r}\nLABEL = {label!r}\n"
with socket.create_connection(('localhost', 9876), timeout=timeout) as connection:
    connection.sendall((json.dumps({'type': 'execute', 'code': prefix + code, 'strict_json': True}) + '\0').encode('utf8'))
    data = b''
    while not data.endswith(b'\0'):
        chunk = connection.recv(1 << 16)
        if not chunk:
            break
        data += chunk
print(json.dumps(json.loads(data.rstrip(b'\0')), indent=1, ensure_ascii=False)[:20000])
