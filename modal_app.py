"""The public demo on Modal: sample sites only, capped model calls (SITETWIN_PUBLIC=1, sitetwin3d/server.py).

Only files git tracks go up, so an operator's own sites (viewer/data/private, uploads) never leave the
machine. The model keys go to a Modal Secret made from .env, never into the repo or the image:

    pip install modal
    python modal_app.py keys       # the keys below from .env into the Modal Secret "sitetwin-3d-keys"
    modal deploy modal_app.py
"""

import subprocess
import sys
from functools import cache
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent
SECRET = "sitetwin-3d-keys"
KEYS = ("BASETEN_API_KEY", "MODAL_BASE_URL", "MODAL_API_KEY", "MODEL_API_KEY")


@cache
def _tracked(folder: str) -> frozenset[str]:
    """What git tracks under `folder`, files and their folders, relative to it."""
    files = subprocess.run(["git", "ls-files", folder], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    rel = [Path(f).relative_to(folder) for f in files]
    return frozenset(p.as_posix() for f in rel for p in (f, *f.parents))


def untracked(folder: str):
    """Modal's ignore predicate for `folder` (it gets paths relative to the folder). Asked only when the
    files are gathered on this machine, never in the container."""
    return lambda path: path.as_posix() not in _tracked(folder)


app = modal.App("sitetwin-3d")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .env({"SITETWIN_PUBLIC": "1", "SITETWIN_DAILY_TOTAL": "400"})
    .add_local_dir(ROOT / "sitetwin3d", "/root/sitetwin3d", ignore=untracked("sitetwin3d"))
    .add_local_dir(ROOT / "viewer", "/root/viewer", ignore=untracked("viewer"))
)


# One warm container: the daily caps are counted in its memory, and no visitor waits for a cold start.
@app.function(image=image, secrets=[modal.Secret.from_name(SECRET)], min_containers=1, max_containers=1)
@modal.concurrent(max_inputs=50)
@modal.asgi_app(label="sitetwin-3d")
def web():
    from sitetwin3d.server import app as site

    return site


if __name__ == "__main__" and sys.argv[1:] == ["keys"]:
    from dotenv import dotenv_values

    env = dotenv_values(ROOT / ".env")
    names = [k for k in KEYS if env.get(k)]
    done = subprocess.run([sys.executable, "-m", "modal", "secret", "create", SECRET, "--force", *(f"{k}={env[k]}" for k in names)],
                          capture_output=True, text=True)
    # Modal's own output is not shown: it could echo a value.
    print(f"{SECRET}: {', '.join(names)}" if done.returncode == 0 else f"modal secret create failed (exit {done.returncode})")
