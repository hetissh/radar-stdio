"""Paths the scripts share: the repository and the published site in it."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / 'public'
DATA = PUBLIC / 'data'
ASSETS = PUBLIC / 'assets'
THUMBS = ASSETS / 'thumbs'
# The catalogue's source of truth (synced from Shopify when it is set up).
PRODUCTS_JSON = DATA / 'products.json'
CONFIG_JS = PUBLIC / 'js' / 'core' / 'config.js'
EXPORT_HTML = PUBLIC / 'RADAR-Gallery-to-Archive.html'
ENV_FILE = REPO / '.env'
