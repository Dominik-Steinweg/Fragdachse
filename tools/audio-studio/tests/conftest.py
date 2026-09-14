from pathlib import Path
import shutil

import numpy as np
import pytest
import soundfile as sf

from audio_studio.repository import Repository
from audio_studio.service import Studio


TOOL = Path(__file__).resolve().parents[1]


class NoModel:
    def generate(self, *args, **kwargs):
        raise RuntimeError("No model was installed for this GPU-independent test")

    def unload(self):
        pass


@pytest.fixture
def studio(tmp_path):
    root, tool = tmp_path / "game", tmp_path / "tool"
    source = root / "src" / "audio" / "AudioCatalog.ts"
    source.parent.mkdir(parents=True)
    source.write_text("""const SHIPPED_AUDIO_FILES = new Set(['one.ogg']);
const SFX_ASSETS = { sfx_one: './assets/sounds/one.ogg', sfx_shared: './assets/sounds/one.ogg', sfx_missing: './assets/sounds/missing.ogg' };
const MUSIC_ASSETS = { music_arena: './assets/sounds/music.ogg' };
const AUDIO_ASSETS = { ...SFX_ASSETS, ...MUSIC_ASSETS } as const;
const SOUND_VOLUMES = { sfx_one: 0.4, sfx_shared: 0.2, sfx_missing: 0.5, music_arena: 0.8 };
""", encoding="utf-8")
    (root / "src" / "usage.ts").write_text("audio.playSound('sfx_one'); audio.startLoop('sfx_shared');", encoding="utf-8")
    sounds = root / "public" / "assets" / "sounds"
    sounds.mkdir(parents=True)
    signal = np.zeros((22050, 2))
    t = np.arange(15000) / 44100
    signal[1000:16000] = (0.35 * np.sin(2 * np.pi * 340 * t) * np.exp(-8 * t))[:, None]
    sf.write(sounds / "one.ogg", signal, 44100, format="OGG", subtype="VORBIS")
    (tool / "catalog" / "migrations").mkdir(parents=True)
    shutil.copytree(TOOL / "frontend", tool / "frontend")
    instance = Studio(root, tool, tool / ".audio-workspace", backend=NoModel(), repository=Repository(root, TOOL))
    instance.catalog.sync()
    yield instance
    instance.jobs.close()


def prepared(studio, key="sfx_one"):
    run = studio.import_current(key)
    version = studio.process(run["id"], "0", "oneshot", "impact", {})
    return {"run_id": run["id"], "candidate_id": "0", "version_id": version["id"]}
