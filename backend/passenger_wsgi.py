"""cPanel / Passenger entrypoint for the Zaujain backend (backzaujain.mttasin.com)."""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

from backend.wsgi import application  # noqa: E402
