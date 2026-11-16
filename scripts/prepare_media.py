"""Prepare small browser-native media and actual HTTP tracking overlays."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

NAMES = ("I_BS_01", "I_BS_02", "I_MB_02", "I_MC_02", "I_SI_02", "O_CL_02", "O_MC_01", "O_RA_02")
WEB = Path(__file__).resolve().parents[1]


def run(command):
    subprocess.run(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, timeout=120)


def prepare(recordings):
    catalog, evidence = [], []
    media = WEB / "dist/media"
    for index, name in enumerate(NAMES):
        source = recordings / "streams" / name
        m = json.loads((source / "edge/edge_manifest.json").read_text())
        result_file = source / "native_float/results.json"
        result = json.loads(result_file.read_text())
        assert [f["frame_id"] for f in result["frames"]] == list(range(1, m["frames"] + 1))
        assert result["all_features_byte_exact"] and result["retries_idempotent"]
        target = media / name
        target.mkdir(parents=True, exist_ok=True)
        original = target / "original.mp4"
        if not original.exists():
            run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-fflags", "+genpts", "-r", str(m["fps"]),
                 "-i", m["video"], "-an", "-c:v", "copy", "-movflags", "+faststart", str(original)])
        cipher = target / "encrypted.mp4"
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(source / "edge/cipher_preview.mp4"),
             "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", str(cipher)])
        for video, poster in ((original, "poster.jpg"), (cipher, "encrypted-poster.jpg")):
            probe = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height,nb_frames:format=duration", "-of", "json", str(video)]))
            assert int(probe["streams"][0]["nb_frames"]) == m["frames"], name
            assert abs(float(probe["format"]["duration"]) - m["frames"]/m["fps"]) < 0.05
            run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(video), "-frames:v", "1",
                 "-q:v", "2", "-threads", "1", str(target / poster)])
        frames = [[dict(id=int(o["id"]), bbox=[round(v, 4) for v in o["bbox"]])
                   for o in frame["objects"]] for frame in result["frames"]]
        payload = dict(width=m["width"], height=m["height"], fps=m["fps"], frames=frames)
        (target / "tracks.json").write_text(json.dumps(payload, separators=(",", ":")))
        indoor = name.startswith("I_")
        number = index + 1 if indoor else index - 4
        base = f"media/{name}"
        catalog.append(dict(id=name, label=f"{'室内' if indoor else '室外'}场景 {number:02d}",
                            environment="室内" if indoor else "室外", frames=m["frames"], fps=m["fps"],
                            width=m["width"], height=m["height"], duration=m["frames"]/m["fps"],
                            original=base+"/original.mp4", encrypted=base+"/encrypted.mp4",
                            poster=base+"/poster.jpg", encryptedPoster=base+"/encrypted-poster.jpg", data=base+"/tracks.json"))
        evidence.append(dict(sequence=name, frames=m["frames"], source_results_sha256=hashlib.sha256(result_file.read_bytes()).hexdigest(),
                             assets={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}))
        print(f"Web media ready: {name}, {m['frames']} actual frames", flush=True)
    (WEB / "dist/catalog.json").write_text(json.dumps(dict(sequences=catalog, totalFrames=sum(s["frames"] for s in catalog),
        totalDuration=sum(s["duration"] for s in catalog), dataSource="Recorded HTTP responses; locally decoded ciphertext previews"), ensure_ascii=False, separators=(",", ":")))
    (WEB / ".sites-runtime").mkdir(exist_ok=True)
    (WEB / ".sites-runtime/media-provenance.json").write_text(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recordings", type=Path, default=WEB.parent / "runs/demo_eight_20261024")
    args = parser.parse_args()
    prepare(args.recordings.resolve())
