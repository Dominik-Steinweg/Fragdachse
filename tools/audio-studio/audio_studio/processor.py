"""Non-destructive WAV/OGG SFX processing.

The processor intentionally has no model or web-service dependency.  It reads
audio through ``soundfile`` and keeps all decisions in a JSON-safe recipe so a
later UI/export layer can display and persist exactly what happened.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np

from .profiles import PROFILES, PROFILE_VERSION

try:  # soundfile is an optional import for model-free catalog usage.
    import soundfile as sf
except ImportError:  # pragma: no cover - exercised by environments without extras
    sf = None


class AudioProcessingError(ValueError):
    """Raised when an input, recipe, or generated output cannot be accepted."""


_OVERRIDE_NAMES = {
    "start_seconds",
    "end_seconds",
    "fade_in_ms",
    "fade_out_ms",
    "crossfade_ms",
    "crossfade_curve",
    "output_gain_db",
    "auto_trim",
    "pre_roll_ms",
    "peak_db",
    "target_lufs",
    "true_peak_db",
}
_PLAYBACKS = {"oneshot", "loop"}
_CROSSFADE_CURVES = {"linear", "equal_power"}
_OUTPUT_NAMES = ("processed.wav", "export.ogg", "loop-preview.wav")
_OGG_COMPRESSION_LEVEL = 0.8
_MUSIC_PROFILE = "music_loop"
_MUSIC_MAX_SECONDS = 380.0


def _require_soundfile() -> Any:
    if sf is None:
        raise AudioProcessingError(
            "soundfile is required for audio processing; install the audio-studio dependencies"
        )
    return sf


def _finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.number)):
        raise AudioProcessingError(f"{name} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise AudioProcessingError(f"{name} must be finite")
    return number


def _as_json(value: Any) -> Any:
    """Convert numpy scalar/container values into JSON-safe values."""
    if isinstance(value, np.ndarray):
        return [_as_json(item) for item in value.tolist()]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, dict):
        return {str(key): _as_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_as_json(item) for item in value]
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_audio(path: Path, dtype: str = "float64") -> tuple[np.ndarray, int]:
    """Read an audio file as finite ``(frames, channels)`` floating samples.

    The public default remains float64 for the established SFX contract.  The
    long-form music path may request float32 to keep a 120-second stereo source
    bounded while it creates its derived loop buffer.
    """
    soundfile = _require_soundfile()
    path = Path(path)
    if not path.is_file():
        raise AudioProcessingError(f"audio source does not exist: {path}")
    try:
        info = soundfile.info(str(path))
        if info.channels not in (1, 2) or not 8000 <= info.samplerate <= 192000:
            raise AudioProcessingError("SFX must use one or two channels at 8–192 kHz")
        if info.frames <= 0 or info.duration > 600:
            raise AudioProcessingError("SFX duration must be nonempty and at most ten minutes")
        if dtype not in {"float32", "float64"}:
            raise AudioProcessingError("audio dtype must be float32 or float64")
        data, sample_rate = soundfile.read(str(path), always_2d=True, dtype=dtype)
    except Exception as exc:  # soundfile exposes several backend-specific errors.
        raise AudioProcessingError(f"could not decode audio source {path}: {exc}") from exc
    data = np.asarray(data, dtype=dtype)
    if data.ndim != 2:
        raise AudioProcessingError("decoded audio must have shape (frames, channels)")
    if int(sample_rate) <= 0:
        raise AudioProcessingError("audio sample rate must be positive")
    if data.shape[0] == 0 or data.shape[1] == 0:
        raise AudioProcessingError("audio content is empty")
    if not np.isfinite(data).all():
        raise AudioProcessingError("audio contains non-finite sample values")
    return data, int(sample_rate)


def _db(value: float, floor: float = -120.0) -> float:
    return max(floor, 20.0 * math.log10(max(abs(float(value)), 10.0 ** (floor / 20.0))))


def _ffmpeg_level_metrics(path: Path, loop: bool = False) -> dict[str, Any] | None:
    """Read FFmpeg's ebur128 integrated LUFS and true-peak summary.

    ``imageio-ffmpeg`` supplies the studio's bundled, cross-platform meter.
    Music processing turns a missing runtime or malformed meter response into
    a clear processing error instead of claiming an unverified true peak.
    """
    try:
        import imageio_ffmpeg  # type: ignore

        executable = imageio_ffmpeg.get_ffmpeg_exe()
        command = [executable]
        if loop:
            # Meter two passes so the true-peak check includes the actual
            # playback boundary between the final and first encoded frames.
            command.extend(["-stream_loop", "1"])
        command.extend(
            [
                "-hide_banner",
                "-nostats",
                "-i",
                str(path),
                "-filter_complex",
                "ebur128=peak=true:framelog=verbose",
                "-f",
                "null",
                "-",
            ]
        )
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except Exception:
        return None
    if completed.returncode != 0:
        return None
    output = completed.stderr
    loudness_match = re.search(r"Integrated loudness:\s*\n\s*I:\s*([-+]?\d+(?:\.\d+)?|[-+]?inf)", output)
    true_peak_match = re.search(r"True peak:\s*\n\s*Peak:\s*([-+]?\d+(?:\.\d+)?|[-+]?inf)\s*dBFS", output)
    if loudness_match is None or true_peak_match is None:
        return None
    try:
        loudness_text = loudness_match.group(1)
        true_peak_text = true_peak_match.group(1)
        integrated = None if "inf" in loudness_text.lower() else float(loudness_text)
        true_peak_db = -120.0 if "inf" in true_peak_text.lower() else float(true_peak_text)
        true_peak = 10.0 ** (true_peak_db / 20.0)
    except (TypeError, ValueError, OverflowError):
        return None
    return {
        "integrated_lufs": integrated,
        "true_peak": true_peak,
        "true_peak_db": true_peak_db,
        "method": "FFmpeg ebur128 (BS.1770 gated integrated loudness and true peak; two loop passes)",
    }


def _require_ffmpeg_level_metrics(path: Path, loop: bool = False) -> dict[str, Any]:
    metrics = _ffmpeg_level_metrics(path, loop=loop)
    if metrics is None:
        raise AudioProcessingError(
            "music_loop requires the bundled imageio-ffmpeg ebur128 meter; install audio-studio dependencies"
        )
    return metrics


def _verified_buffer_metrics(data: np.ndarray, sample_rate: int, output_dir: Path) -> dict[str, Any]:
    """Measure an in-memory arrangement through the bundled FFmpeg meter."""
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", dir=str(output_dir), delete=False) as temporary:
            temporary_path = Path(temporary.name)
        _write_wav(temporary_path, data, sample_rate)
        return _require_ffmpeg_level_metrics(temporary_path, loop=True)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _compact_waveform(data: np.ndarray, bins: int = 128) -> list[dict[str, float]]:
    count = int(data.shape[0])
    if count == 0:
        return []
    bins = max(1, min(int(bins), count))
    result: list[dict[str, float]] = []
    for start, end in zip(
        np.linspace(0, count, bins, endpoint=False, dtype=int),
        np.linspace(0, count, bins + 1, endpoint=True, dtype=int)[1:],
    ):
        block = data[start:max(start + 1, end)]
        result.append(
            {
                "min": float(np.min(block)),
                "max": float(np.max(block)),
                "peak": float(np.max(np.abs(block))),
            }
        )
    return result


def _seam_metrics(data: np.ndarray, sample_rate: int, window_ms: float = 8.0) -> dict[str, float]:
    window = max(1, min(data.shape[0], int(round(sample_rate * window_ms / 1000.0))))
    if data.shape[0] < 2:
        return {"sample_jump": 0.0, "rms_ratio": 1.0, "window_samples": 1}
    boundary_jump = float(np.max(np.abs(data[0] - data[-1])))
    before = np.sqrt(np.mean(np.square(data[-window:])))
    after = np.sqrt(np.mean(np.square(data[:window])))
    ratio = float(after / max(before, 1.0e-12))
    return {
        "sample_jump": boundary_jump,
        "rms_ratio": ratio,
        "window_samples": int(window),
    }


def _inspect_data(data: np.ndarray, sample_rate: int, path: Path, playback: str) -> dict[str, Any]:
    """Inspect already-decoded samples without creating another long buffer."""
    if playback not in _PLAYBACKS:
        raise AudioProcessingError(f"playback must be one of {sorted(_PLAYBACKS)}")
    peak = float(np.max(np.abs(data)))
    rms = float(np.sqrt(np.mean(np.square(data))))
    duration = float(data.shape[0] / sample_rate)
    warnings: list[str] = []
    if peak > 1.0:
        warnings.append("sample peak exceeds 0 dBFS")
    if peak <= 1.0e-12:
        warnings.append("audio is effectively silent")
    seam = _seam_metrics(data, sample_rate)
    if playback == "loop" and (seam["sample_jump"] > 0.25 or seam["rms_ratio"] > 3.0 or seam["rms_ratio"] < 1.0 / 3.0):
        warnings.append("loop boundary has a potentially audible discontinuity")
    return _as_json(
        {
            "path": str(Path(path)),
            "valid": True,
            "finite": bool(np.isfinite(data).all()),
            "nonempty": bool(data.shape[0] > 0 and data.shape[1] > 0),
            "channels": int(data.shape[1]),
            "sample_rate": int(sample_rate),
            "frames": int(data.shape[0]),
            "duration_seconds": duration,
            "peak": peak,
            "peak_db": _db(peak),
            "rms": rms,
            "rms_db": _db(rms),
            "seam": seam,
            "cut_seam_warnings": list(warnings) if playback == "loop" else [],
            "warnings": warnings,
            "waveform_peaks": _compact_waveform(data),
        }
    )


def inspect_audio(path: Path, playback: str = "oneshot") -> dict[str, Any]:
    """Return validation, level, duration, seam, and compact waveform metrics."""
    data, sample_rate = read_audio(Path(path))
    return _inspect_data(data, sample_rate, Path(path), playback)


def _frame_energy(data: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    """Short RMS energy with enough temporal resolution for early attacks."""
    mono = np.sqrt(np.mean(np.square(data), axis=1))
    window = max(1, int(round(sample_rate * 0.002)))
    if mono.shape[0] <= window:
        return np.asarray([float(np.sqrt(np.mean(np.square(mono))))]), window
    # A moving RMS is stable against individual noise samples but retains a
    # sub-3ms attack.  ``valid`` keeps boundaries deterministic.
    squared = np.square(mono)
    cumulative = np.concatenate(([0.0], np.cumsum(squared)))
    energy = np.sqrt(np.maximum(cumulative[window:] - cumulative[:-window], 0.0) / window)
    return energy, window


def _find_onset(data: np.ndarray, sample_rate: int, profile: dict[str, Any]) -> int:
    energy, window = _frame_energy(data, sample_rate)
    if energy.size == 0:
        return 0
    peak = float(np.max(np.abs(data)))
    if peak <= 1.0e-12:
        return 0
    # ``_frame_energy`` is a moving window evaluated at every sample, so the
    # baseline is expressed in samples as well.  Keeping roughly 80 ms gives
    # a useful estimate for a low noise prelude without assuming silence.
    baseline_count = max(1, min(energy.size, int(round(0.08 * sample_rate))))
    baseline_samples = energy[:baseline_count]
    noise = float(np.percentile(baseline_samples, 35.0))
    baseline_mean = float(np.mean(baseline_samples))
    baseline_variation = float(np.std(baseline_samples) / max(baseline_mean, 1.0e-12))
    relative = peak * float(profile["onset_relative"])
    floor = peak * (10.0 ** (float(profile["onset_floor_db"]) / 20.0))
    threshold = max(relative, noise * 3.0, floor)
    # A continuously active texture can be louder than the relative onset
    # threshold from its first frame.  Treat a stable baseline as already
    # active instead of mistaking the global moving-RMS maximum for its onset.
    if baseline_mean > 1.0e-8 and baseline_variation < 0.10 and threshold > baseline_mean * 1.5:
        return 0
    # Require a tiny rise over the local median. This filters a low, steady
    # noise bed while retaining an attack that starts near frame zero.
    smooth = np.maximum(energy, 1.0e-12)
    local = np.empty_like(smooth)
    local[0] = smooth[0]
    local[1:] = np.minimum(smooth[:-1], smooth[1:])
    candidates = np.flatnonzero((smooth >= threshold) & (smooth >= local * 1.02))
    if candidates.size == 0:
        candidates = np.flatnonzero(smooth >= threshold)
    if candidates.size == 0:
        return int(np.argmax(smooth))
    # Two consecutive qualifying frames avoid selecting a single noisy spike,
    # while accepting the first frame when the source is a true impulse.
    first = int(candidates[0])
    for candidate in candidates:
        index = int(candidate)
        end = min(smooth.size, index + 2)
        if int(np.count_nonzero(smooth[index:end] >= threshold)) >= min(2, end - index):
            first = index
            break
    return max(0, min(data.shape[0] - 1, first))


def _find_tail(data: np.ndarray, start: int, sample_rate: int, profile: dict[str, Any]) -> int:
    if start >= data.shape[0] - 1:
        return data.shape[0]
    energy, window = _frame_energy(data[start:], sample_rate)
    peak = float(np.max(np.abs(data)))
    if peak <= 1.0e-12 or energy.size == 0:
        return min(data.shape[0], start + 1)
    # A source whose event starts at frame zero has no noise-only region.  Using
    # its decaying tail as a noise estimate would incorrectly cut the tail of
    # an early explosion or charge.
    noise_region = data[:start] if start > max(1, int(0.01 * sample_rate)) else np.empty((0, data.shape[1]))
    noise_rms = float(np.sqrt(np.mean(np.square(noise_region)))) if noise_region.size else 0.0
    threshold = max(peak * (10.0 ** (-60.0 / 20.0)), peak * 0.003, noise_rms * 3.0)
    active = np.flatnonzero(energy >= threshold)
    if active.size == 0:
        return min(data.shape[0], start + max(1, int(round(sample_rate * profile["tail_ms"] / 1000.0))))
    last = int(active[-1] + window)
    tail = max(0, int(round(sample_rate * float(profile["tail_ms"]) / 1000.0)))
    return min(data.shape[0], start + last + tail)


def _fade(data: np.ndarray, fade_in: int, fade_out: int) -> np.ndarray:
    result = np.array(data, dtype=np.float64, copy=True)
    if fade_in > 0:
        count = min(fade_in, result.shape[0])
        result[:count] *= np.linspace(0.0, 1.0, count, endpoint=True)[:, None]
    if fade_out > 0:
        count = min(fade_out, result.shape[0])
        result[-count:] *= np.linspace(1.0, 0.0, count, endpoint=True)[:, None]
    return result


def _crossfade_loop(data: np.ndarray, count: int, curve: str) -> tuple[np.ndarray, int]:
    if data.shape[0] < 2 or count <= 0:
        return np.array(data, dtype=np.float64, copy=True), 0
    count = min(count, max(1, data.shape[0] // 3))
    values = np.linspace(0.0, 1.0, count, endpoint=True)
    tail = data[-count:]
    head = data[:count]
    if curve == "equal_power":
        outgoing = np.cos(values * math.pi / 2.0)[:, None]
        incoming = np.sin(values * math.pi / 2.0)[:, None]
    else:
        outgoing = (1.0 - values)[:, None]
        incoming = values[:, None]
    blended = tail * outgoing + head * incoming
    result = np.concatenate((data[:-count], blended), axis=0)
    # Put the file boundary through the middle of the smooth splice. This
    # keeps the cut seam between adjacent samples of the crossfade rather than
    # at its two loudest endpoints.
    rotation = max(0, result.shape[0] - count // 2)
    if rotation:
        result = np.roll(result, -rotation, axis=0)
    return result, count


def _crossfade_music_loop(data: np.ndarray, count: int, curve: str) -> tuple[np.ndarray, int]:
    """Overlap the arrangement's tail and head without duplicating its head.

    The existing SFX loop helper retains the pre-overlap head in the output.
    For a long arrangement that makes
    the first musical phrase occur twice around the seam.  This helper removes
    both endpoint overlap regions and inserts the blended region once, split
    across the file boundary.  The interior remains sample-for-sample intact.
    """
    if data.shape[0] < 2 or count <= 0:
        return np.array(data, dtype=np.float64, copy=True), 0
    requested = int(count)
    count = min(requested, max(1, (data.shape[0] - 1) // 2))
    values = np.linspace(0.0, 1.0, count, endpoint=True)
    tail = data[-count:]
    head = data[:count]
    if curve == "equal_power":
        outgoing = np.cos(values * math.pi / 2.0)[:, None]
        incoming = np.sin(values * math.pi / 2.0)[:, None]
    else:
        outgoing = (1.0 - values)[:, None]
        incoming = values[:, None]
    blended = tail * outgoing + head * incoming

    # Put the seam through the middle of the overlap.  The source interior is
    # copied once, while the crossfade is split into its two circular halves.
    midpoint = count // 2
    interior = data[count : data.shape[0] - count]
    result = np.empty((data.shape[0] - count, data.shape[1]), dtype=np.float64)
    cursor = 0
    first = blended[midpoint:]
    result[cursor : cursor + first.shape[0]] = first
    cursor += first.shape[0]
    result[cursor : cursor + interior.shape[0]] = interior
    cursor += interior.shape[0]
    result[cursor:] = blended[:midpoint]
    return result, count


def _stable_loop_segment(
    data: np.ndarray,
    start: int,
    end: int,
    sample_rate: int,
) -> tuple[int, int]:
    """Choose a reasonably steady sub-window of a longer active recording.

    The selection is intentionally conservative: short material is retained in
    full, while longer material is searched in overlapping windows and scored
    by RMS variation.  This avoids turning a charge-up or release tail into a
    repeated loop without inventing a fixed authored duration.
    """
    length = end - start
    minimum = max(1, int(round(sample_rate * 0.25)))
    if length <= minimum:
        return start, end
    target = min(length, max(minimum, int(round(sample_rate * 0.75)), length // 2))
    if target >= length:
        return start, end
    region = data[start:end]
    mono = np.sqrt(np.mean(np.square(region), axis=1))
    frame = max(1, int(round(sample_rate * 0.02)))
    count = max(1, mono.shape[0] // frame)
    frame_rms = np.array(
        [float(np.sqrt(np.mean(np.square(block)))) for block in np.array_split(mono, count) if block.size],
        dtype=np.float64,
    )
    # Candidate windows are deliberately sparse; this is a preparation tool,
    # not a real-time operation, and the recipe records the selected frames.
    candidate_count = min(24, max(1, length - target + 1))
    candidate_starts = np.linspace(0, length - target, candidate_count, dtype=int)
    best: tuple[float, int] | None = None
    peak = max(float(np.max(mono)), 1.0e-12)
    for local_start in candidate_starts:
        local_end = min(length, int(local_start + target))
        first = min(frame_rms.size, int(local_start / max(frame, 1)))
        last = max(first + 1, min(frame_rms.size, int(math.ceil(local_end / max(frame, 1)))))
        values = frame_rms[first:last]
        mean = float(np.mean(values)) if values.size else 0.0
        variation = float(np.std(values) / max(mean, 1.0e-12))
        # Prefer a stable signal over a near-silent accidental window.
        quiet_penalty = max(0.0, 0.25 - mean / peak)
        score = variation + quiet_penalty
        if best is None or score < best[0]:
            best = (score, int(local_start))
    selected = best[1] if best is not None else 0
    return start + selected, start + selected + target


def validate_overrides(overrides: dict[str, Any] | None, profile: str | None = None) -> dict[str, Any]:
    if overrides is None:
        return {}
    if not isinstance(overrides, dict):
        raise AudioProcessingError("overrides must be an object")
    unknown_names = set(overrides) - _OVERRIDE_NAMES
    if profile != _MUSIC_PROFILE:
        # Keep the established SFX override contract strict.  These controls
        # only have meaning for the authored music alignment path.
        unknown_names.update(set(overrides) & {"target_lufs", "true_peak_db"})
    unknown = sorted(unknown_names)
    if unknown:
        raise AudioProcessingError(f"unknown processing override(s): {', '.join(unknown)}")
    normalized = dict(overrides)
    for name in _OVERRIDE_NAMES - {"crossfade_curve", "auto_trim"}:
        if name in normalized:
            normalized[name] = _finite(normalized[name], name)
    if "auto_trim" in normalized and not isinstance(normalized["auto_trim"], bool):
        raise AudioProcessingError("auto_trim must be boolean")
    if "crossfade_curve" in normalized and normalized["crossfade_curve"] not in _CROSSFADE_CURVES:
        raise AudioProcessingError("crossfade_curve must be 'linear' or 'equal_power'")
    bounds = {
        "start_seconds": (0.0, 24.0),
        "end_seconds": (0.0, 24.0),
        "fade_in_ms": (0.0, 1000.0),
        "fade_out_ms": (0.0, 5000.0),
        "crossfade_ms": (0.0, 5000.0),
        "output_gain_db": (-60.0, 24.0),
        "pre_roll_ms": (0.0, 1000.0),
        "peak_db": (-120.0, 0.0),
        "target_lufs": (-70.0, -5.0),
        "true_peak_db": (-20.0, 0.0),
    }
    endpoint_limit = _MUSIC_MAX_SECONDS if profile == _MUSIC_PROFILE else 24.0
    crossfade_limit = _MUSIC_MAX_SECONDS * 1000.0 if profile == _MUSIC_PROFILE else 5000.0
    bounds["start_seconds"] = (0.0, endpoint_limit)
    bounds["end_seconds"] = (0.0, endpoint_limit)
    bounds["crossfade_ms"] = (0.0, crossfade_limit)
    for name, (minimum, maximum) in bounds.items():
        if name in normalized and not minimum <= normalized[name] <= maximum:
            raise AudioProcessingError(f"{name} must be between {minimum} and {maximum}")
    if "start_seconds" in normalized and "end_seconds" in normalized and normalized["start_seconds"] >= normalized["end_seconds"]:
        raise AudioProcessingError("start_seconds must be less than end_seconds")
    return normalized


def _write_wav(path: Path, data: np.ndarray, sample_rate: int) -> None:
    soundfile = _require_soundfile()
    try:
        soundfile.write(str(path), np.asarray(data, dtype=np.float64), sample_rate, format="WAV", subtype="FLOAT")
    except Exception as exc:
        raise AudioProcessingError(f"could not write WAV output {path}: {exc}") from exc


def _write_loop_preview(path: Path, data: np.ndarray, sample_rate: int, repeats: int = 3) -> None:
    """Write a repeated preview in chunks so long music stays bounded in RAM."""
    soundfile = _require_soundfile()
    try:
        with soundfile.SoundFile(str(path), mode="w", samplerate=sample_rate, channels=data.shape[1], format="WAV", subtype="FLOAT") as stream:
            chunk_frames = max(1, min(data.shape[0], int(round(sample_rate * 10.0))))
            for _ in range(repeats):
                for start in range(0, data.shape[0], chunk_frames):
                    stream.write(np.asarray(data[start : start + chunk_frames], dtype=np.float64))
    except Exception as exc:
        raise AudioProcessingError(f"could not write WAV loop preview {path}: {exc}") from exc


def _write_ogg(
    path: Path,
    data: np.ndarray,
    sample_rate: int,
    output_dir: Path,
    prefer_ffmpeg: bool = False,
) -> dict[str, Any]:
    soundfile = _require_soundfile()
    soundfile_error: Exception | None = None
    if not prefer_ffmpeg:
        try:
            soundfile.write(
                str(path),
                np.asarray(data, dtype=np.float64),
                sample_rate,
                format="OGG",
                subtype="VORBIS",
                compression_level=_OGG_COMPRESSION_LEVEL,
            )
            return {"backend": "soundfile/libvorbis", "codec": "Vorbis", "compression_level": _OGG_COMPRESSION_LEVEL}
        except Exception as exc:
            soundfile_error = exc
    # Some Python wheels ship libsndfile without Vorbis even though WAV is
    # available.  Long music arrangements also use this path deliberately:
    # the bundled FFmpeg encoder avoids a libsndfile native abort on large
    # 44.1/48 kHz stereo inputs.
    try:
        import imageio_ffmpeg  # type: ignore

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        detail = f" ({soundfile_error})" if soundfile_error is not None else ""
        raise AudioProcessingError(
            f"could not encode OGG with soundfile{detail}; install imageio-ffmpeg"
        ) from exc
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=str(output_dir), delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        _write_wav(temporary_path, data, sample_rate)
        completed = subprocess.run(
            [ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(temporary_path), "-c:a", "libvorbis", "-q:a", "6", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=180,
        )
        if completed.returncode != 0 or not path.is_file() or path.stat().st_size == 0:
            detail = completed.stderr.strip() or "unknown ffmpeg error"
            raise AudioProcessingError(f"could not encode OGG with ffmpeg: {detail}")
        return {"backend": "ffmpeg/libvorbis", "codec": "Vorbis", "quality": 6}
    finally:
        temporary_path.unlink(missing_ok=True)


def _validate_output(path: Path, playback: str) -> dict[str, Any]:
    try:
        return inspect_audio(path, playback=playback)
    except AudioProcessingError:
        raise
    except Exception as exc:
        raise AudioProcessingError(f"output validation failed for {path}: {exc}") from exc


def _inspect_repeated_preview(path: Path, reference: dict[str, Any], repeats: int) -> dict[str, Any]:
    """Validate preview metadata without loading a multi-minute file again."""
    soundfile = _require_soundfile()
    try:
        info = soundfile.info(str(path))
    except Exception as exc:
        raise AudioProcessingError(f"loop preview validation failed for {path}: {exc}") from exc
    if info.channels not in (1, 2) or info.samplerate <= 0 or info.frames <= 0:
        raise AudioProcessingError("loop preview has invalid stream metadata")
    expected_frames = int(reference["frames"]) * int(repeats)
    if abs(int(info.frames) - expected_frames) > max(16, int(info.samplerate * 0.01)):
        raise AudioProcessingError("loop preview duration differs from its exported loop")
    result = dict(reference)
    result.update(
        {
            "path": str(path),
            "frames": int(info.frames),
            "duration_seconds": float(info.frames / info.samplerate),
            "seam": reference.get("seam", {}),
        }
    )
    return result


def process_audio(
    source: Path,
    output_dir: Path,
    playback: str,
    profile: str,
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Process one source into non-destructive WAV/OGG outputs.

    ``output_dir`` may already exist, but none of the standard output names may
    exist there.  This prevents a rerun from silently replacing a candidate.
    """
    source = Path(source)
    output_dir = Path(output_dir)
    if playback not in _PLAYBACKS:
        raise AudioProcessingError(f"playback must be one of {sorted(_PLAYBACKS)}")
    if profile not in PROFILES:
        raise AudioProcessingError(f"unknown processing profile: {profile}")
    if profile == _MUSIC_PROFILE and playback != "loop":
        raise AudioProcessingError("music_loop profile requires loop playback")
    overrides = validate_overrides(overrides, profile=profile)
    is_music = profile == _MUSIC_PROFILE
    source_data, sample_rate = read_audio(source, dtype="float32" if is_music else "float64")
    source_bytes_hash = _sha256(source)
    output_dir.mkdir(parents=True, exist_ok=True)
    collisions = [name for name in _OUTPUT_NAMES if (output_dir / name).exists()]
    if collisions:
        raise AudioProcessingError(f"refusing to overwrite existing output(s): {', '.join(collisions)}")

    authored = PROFILES[profile]
    # A musical arrangement is authored as a complete performance.  Even if
    # an old caller sends auto_trim=True, do not apply the SFX onset/tail or
    # stable-half selection heuristics to it.
    auto_trim = False if is_music else overrides.get("auto_trim", authored.get("auto_trim", playback == "oneshot"))
    pre_roll_ms = overrides.get("pre_roll_ms", authored["pre_roll_ms"])
    fade_in_ms = overrides.get("fade_in_ms", authored["fade_in_ms"])
    fade_out_ms = overrides.get("fade_out_ms", authored["fade_out_ms"])
    peak_db = overrides.get("peak_db", authored["peak_db"])
    target_lufs = overrides.get("target_lufs", authored.get("target_lufs"))
    true_peak_db = overrides.get("true_peak_db", authored.get("true_peak_db", peak_db))
    true_peak_guard_db = float(authored.get("true_peak_guard_db", 0.0)) if is_music else 0.0
    crossfade_ms = overrides.get("crossfade_ms", authored["default_crossfade_ms"])
    curve = overrides.get("crossfade_curve", authored.get("default_crossfade_curve", "linear"))
    warnings: list[str] = []

    onset = 0 if is_music else _find_onset(source_data, sample_rate, authored)
    if "start_seconds" in overrides:
        start = int(round(overrides["start_seconds"] * sample_rate))
    elif auto_trim:
        start = max(0, onset - int(round(pre_roll_ms * sample_rate / 1000.0)))
    else:
        start = 0
    if "end_seconds" in overrides:
        end = int(round(overrides["end_seconds"] * sample_rate))
    elif auto_trim:
        end = _find_tail(source_data, max(0, start), sample_rate, authored)
    else:
        end = source_data.shape[0]
    if start < 0 or end > source_data.shape[0] or start >= end:
        raise AudioProcessingError("requested cut is outside the source or empty")
    if "start_seconds" in overrides and start >= source_data.shape[0]:
        raise AudioProcessingError("start_seconds is outside the source")

    selection = "manual" if "start_seconds" in overrides or "end_seconds" in overrides else ("auto_trim" if auto_trim else "full_source")
    if playback == "loop" and auto_trim and not is_music and not ("start_seconds" in overrides or "end_seconds" in overrides):
        start, end = _stable_loop_segment(source_data, start, end, sample_rate)
        selection = "stable_segment"
    cut = source_data[start:end] if is_music else np.array(source_data[start:end], dtype=np.float64, copy=True)
    explicit_fade_in = "fade_in_ms" in overrides
    requested_fade_in_samples = int(round(fade_in_ms * sample_rate / 1000.0)) if playback == "oneshot" else 0
    available_preroll = max(0, onset - start)
    if playback == "oneshot":
        # Authored profile fades protect an automatically detected attack by
        # using only the available pre-roll. An explicit UI fade is authorial
        # intent and may span the cut, bounded only by the cut length.
        fade_in_samples = (
            min(requested_fade_in_samples, cut.shape[0])
            if explicit_fade_in
            else min(requested_fade_in_samples, available_preroll)
        )
    else:
        fade_in_samples = 0
    fade_out_samples = int(round(fade_out_ms * sample_rate / 1000.0)) if playback == "oneshot" else 0
    crossfade_samples = int(round(crossfade_ms * sample_rate / 1000.0)) if playback == "loop" else 0
    if playback == "oneshot":
        processed = _fade(cut, fade_in_samples, fade_out_samples)
    elif is_music:
        processed, crossfade_samples = _crossfade_music_loop(cut, crossfade_samples, curve)
    else:
        processed, crossfade_samples = _crossfade_loop(cut, crossfade_samples, curve)

    requested_gain_db = overrides.get("output_gain_db", 0.0)
    loudness_before = _verified_buffer_metrics(processed, sample_rate, output_dir) if is_music else None
    loudness_gain_db = 0.0
    if is_music and target_lufs is not None:
        measured_lufs = loudness_before["integrated_lufs"] if loudness_before else None
        if measured_lufs is None or not math.isfinite(float(measured_lufs)):
            warnings.append("music arrangement is effectively silent; integrated LUFS alignment was skipped")
        else:
            loudness_gain_db = float(target_lufs) - float(measured_lufs)
            processed *= 10.0 ** (loudness_gain_db / 20.0)
    if requested_gain_db:
        processed *= 10.0 ** (requested_gain_db / 20.0)
    peak_before_limit = float(np.max(np.abs(processed))) if processed.size else 0.0
    true_peak_before_limit = (
        _verified_buffer_metrics(processed, sample_rate, output_dir)["true_peak"]
        if is_music
        else peak_before_limit
    )
    effective_true_peak_db = true_peak_db - true_peak_guard_db if is_music else peak_db
    allowed_peak = 10.0 ** (effective_true_peak_db / 20.0)
    limiter_gain_db = 0.0
    limiter_reference = true_peak_before_limit if is_music else peak_before_limit
    if limiter_reference > allowed_peak and limiter_reference > 0.0:
        limiter_gain_db = 20.0 * math.log10(allowed_peak / limiter_reference)
        processed *= allowed_peak / limiter_reference
        limit_name = "true peak" if is_music else "peak"
        limit_value = effective_true_peak_db if is_music else peak_db
        warnings.append(f"{limit_name} exceeded {limit_value:.2f} dBFS; attenuated by {limiter_gain_db:.2f} dB")
    if requested_gain_db > 0.0 and not is_music:
        warnings.append("explicit positive output_gain_db applied; no implicit peak normalization was used")
    elif requested_gain_db > 0.0 and is_music:
        warnings.append("explicit positive output_gain_db was applied alongside music loudness alignment")
    if is_music:
        warnings.append("music loop uses an endpoint crossfade; beat and harmony continuity are not guaranteed")
    if playback == "oneshot" and not explicit_fade_in and fade_in_samples < requested_fade_in_samples:
        warnings.append("automatic cut has little attack pre-roll; review for an aggressive cut")
    if auto_trim and onset >= source_data.shape[0] - max(1, int(round(sample_rate * 0.01))):
        warnings.append("automatic onset is near the source end; cut confidence is low")
    if playback == "oneshot" and not explicit_fade_in and onset <= int(round(0.001 * sample_rate)):
        warnings.append("source begins close to the event; attack protection has little pre-roll available")

    processed_path = output_dir / "processed.wav"
    export_path = output_dir / "export.ogg"
    preview_path = output_dir / "loop-preview.wav"
    # Encode, decode, and (for music) repeat after any codec true-peak
    # overshoot.  This makes the safety limit apply to the file that the game
    # will actually decode rather than only to the pre-encoded WAV.
    codec_limiter_gain_db = 0.0
    exported_data: np.ndarray
    exported_rate: int
    export_levels: dict[str, Any] | None = None
    for attempt in range(3 if is_music else 1):
        _write_wav(processed_path, processed, sample_rate)
        encoding = _write_ogg(export_path, processed, sample_rate, output_dir, prefer_ffmpeg=is_music)
        exported_data, exported_rate = read_audio(export_path)
        if exported_rate != sample_rate or exported_data.shape[1] != processed.shape[1] or not np.isfinite(exported_data).all():
            raise AudioProcessingError("redecoded OGG output has invalid sample rate, channels, or finite values")
        if not is_music:
            break
        export_levels = _require_ffmpeg_level_metrics(export_path, loop=True)
        exported_true_peak = float(export_levels["true_peak"])
        if exported_true_peak <= allowed_peak * 1.000001 or exported_true_peak <= 0.0:
            break
        attenuation = allowed_peak / exported_true_peak
        attenuation_db = 20.0 * math.log10(attenuation)
        codec_limiter_gain_db += attenuation_db
        processed *= attenuation
        if attempt == 0:
            warnings.append(
                f"redecoded OGG true peak exceeded the guarded {effective_true_peak_db:.2f} dBTP ceiling; attenuated by {attenuation_db:.2f} dB"
            )
    if is_music and export_levels is not None and float(export_levels["true_peak"]) > allowed_peak * 1.000001:
        raise AudioProcessingError("redecoded OGG true peak remains above the requested safety limit")
    frame_delta = abs(int(exported_data.shape[0]) - int(processed.shape[0]))
    plausible_delta = max(16, int(round(sample_rate * 0.01)))
    if frame_delta > max(16, int(round(sample_rate * 0.10))):
        raise AudioProcessingError("redecoded OGG output duration is implausibly different from the processed WAV")
    if frame_delta > plausible_delta:
        warnings.append(f"redecoded OGG duration differs by {frame_delta} frames from the processed WAV")
    export_inspection = inspect_audio(export_path, playback=playback)
    if is_music:
        if export_levels is None:
            export_levels = _require_ffmpeg_level_metrics(export_path, loop=True)
        export_inspection.update(export_levels)
    elif export_inspection["peak"] > (10.0 ** (peak_db / 20.0)) * 1.01:
        warnings.append("redecoded OGG peak exceeds the requested one-shot peak limit; review codec overshoot")
    if playback == "loop":
        if is_music:
            _write_loop_preview(preview_path, exported_data, exported_rate)
            preview_inspection = _inspect_repeated_preview(preview_path, export_inspection, 3)
        else:
            preview = np.tile(exported_data, (3, 1))
            _write_wav(preview_path, preview, exported_rate)
            preview_inspection = inspect_audio(preview_path, playback="loop")
        warnings.extend(export_inspection.get("warnings", []))
    else:
        # Keep the output contract predictable while avoiding a misleading
        # synthetic loop preview for one-shots.
        preview_path = None
        preview_inspection = None

    processed_inspection = _validate_output(processed_path, playback)
    processed_levels = (
        _require_ffmpeg_level_metrics(processed_path, loop=True)
        if is_music
        else None
    )
    if is_music and processed_levels is not None:
        processed_inspection.update(processed_levels)
    if is_music:
        if export_levels is None:
            export_levels = _require_ffmpeg_level_metrics(export_path, loop=True)
        total_limiter_gain_db = limiter_gain_db + codec_limiter_gain_db
        if (
            target_lufs is not None
            and processed_levels is not None
            and processed_levels["integrated_lufs"] is not None
            and abs(float(processed_levels["integrated_lufs"]) - float(target_lufs)) > 0.5
        ):
            warnings.append("true-peak safety attenuation leaves the arrangement below the requested loudness target")
    else:
        export_levels = None
        total_limiter_gain_db = limiter_gain_db
    output_hashes = {"processed.wav": _sha256(processed_path), "export.ogg": _sha256(export_path)}
    if preview_path is not None:
        output_hashes["loop-preview.wav"] = _sha256(preview_path)
    recipe = _as_json(
        {
            "recipe_version": PROFILE_VERSION,
            "source": {
                "path": str(source),
                "sha256": source_bytes_hash,
                "sample_rate": sample_rate,
                "channels": int(source_data.shape[1]),
                "frames": int(source_data.shape[0]),
            },
            "playback": playback,
            "profile": profile,
            "profile_version": authored["version"],
            "cuts": {
                "start_seconds": start / sample_rate,
                "end_seconds": end / sample_rate,
                "start_frame": start,
                "end_frame": end,
                "auto_trim": bool(auto_trim),
                "selection": selection,
                "detected_onset_seconds": onset / sample_rate,
            },
            "fades": {
                "fade_in_ms": fade_in_samples * 1000.0 / sample_rate,
                "fade_out_ms": fade_out_samples * 1000.0 / sample_rate,
                "crossfade_ms": crossfade_samples * 1000.0 / sample_rate,
                "crossfade_curve": curve if playback == "loop" else None,
            },
            "loop": (
                {
                    "start_seconds": start / sample_rate,
                    "end_seconds": end / sample_rate,
                    "crossfade_ms": crossfade_samples * 1000.0 / sample_rate,
                    "crossfade_samples": crossfade_samples,
                    "endpoint_match": "conservative amplitude overlap-add",
                }
                if is_music
                else None
            ),
            "loudness": (
                {
                    "target_lufs": target_lufs,
                    "before_alignment_lufs": loudness_before["integrated_lufs"] if loudness_before else None,
                    "processed_lufs": processed_levels["integrated_lufs"] if processed_levels else None,
                    "export_lufs": export_levels["integrated_lufs"] if export_levels else None,
                    "alignment_gain_db": loudness_gain_db,
                    "method": processed_levels["method"] if processed_levels else None,
                }
                if is_music
                else None
            ),
            "true_peak": (
                {
                    "limit_db": true_peak_db,
                    "guard_db": true_peak_guard_db,
                    "effective_limit_db": effective_true_peak_db,
                    "processed_db": processed_levels["true_peak_db"] if processed_levels else None,
                    "export_db": export_levels["true_peak_db"] if export_levels else None,
                    "meter": "FFmpeg ebur128 true peak",
                    "meter_loop_repeats": 2,
                    "codec_verified": True,
                }
                if is_music
                else None
            ),
            "gain": {
                "output_gain_db": requested_gain_db,
                "limiter_attenuation_db": total_limiter_gain_db,
                "peak_limit_db": peak_db,
                "true_peak_limit_db": true_peak_db if is_music else None,
            },
            "encoding": {
                "wav": "FLOAT",
                "ogg": encoding,
                "sample_rate": sample_rate,
                "channels": int(processed.shape[1]),
            },
            "output_hashes": output_hashes,
            "overrides": overrides,
        }
    )
    result = {
        "recipe": recipe,
        "analysis": {
            "source": inspect_audio(source, playback=playback),
            "processed": processed_inspection,
            "export": export_inspection,
            "loop_preview": preview_inspection,
            "warnings": sorted(set(warnings)),
        },
        "outputs": {
            "raw": str(source),
            "source": str(source),
            "source_sha256": source_bytes_hash,
            "processed_wav": str(processed_path),
            "export_ogg": str(export_path),
            "loop_preview_wav": str(preview_path) if preview_path is not None else None,
            "sha256": output_hashes,
        },
    }
    # A final serialisability guard catches accidental Path/numpy additions at
    # this boundary before a FastAPI response or metadata file sees them.
    json.dumps(_as_json(result), allow_nan=False)
    return _as_json(result)
