"""Verify all browser overlays against the original, ordered HTTP responses."""
import json
from pathlib import Path
import subprocess

web = Path(__file__).resolve().parents[1]
recordings = web.parent / "runs/demo_eight_20261024/streams"
catalog = json.loads((web / "dist/catalog.json").read_text())
expected = ["I_BS_01", "I_BS_02", "I_MB_02", "I_MC_02", "I_SI_02", "O_CL_02", "O_MC_01", "O_RA_02"]
assert [s["id"] for s in catalog["sequences"]] == expected
assert catalog["totalFrames"] == 2675 and catalog["totalDuration"] == 107
for scene in catalog["sequences"]:
    original = json.loads((recordings / scene["id"] / "native_float/results.json").read_text())
    browser = json.loads((web / "dist" / scene["data"]).read_text())
    assert len(browser["frames"]) == scene["frames"] == len(original["frames"])
    for old, new in zip(original["frames"], browser["frames"]):
        assert [o["id"] for o in old["objects"]] == [o["id"] for o in new]
        for a, b in zip(old["objects"], new):
            assert max(abs(x-y) for x,y in zip(a["bbox"], b["bbox"])) <= 0.000051
    for field in ("original", "encrypted"):
        path = web / "dist" / scene[field]
        probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                                    "stream=nb_frames,width,height:format=duration", "-of", "json", str(path)]))
        assert int(probe["streams"][0]["nb_frames"]) == scene["frames"]
        assert abs(float(probe["format"]["duration"]) - scene["duration"]) < 0.05
    print(f"Verified {scene['id']}: {scene['frames']} ordered video/HTTP frames")
print("All 8 scenes and 2675 actual frames verified; browser overlays match original HTTP results")
