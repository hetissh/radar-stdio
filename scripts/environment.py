"""Settings from the repository's .env file and the real environment.

On a local machine the settings live in .env; on Cloudflare Pages they are
environment variables. Real environment variables win over .env values.
"""

from __future__ import annotations

import os
from pathlib import Path

from paths import ENV_FILE

# Only these environment variables are read from the real environment.
PREFIX = 'SHOPIFY_'


def load_env(path: Path = ENV_FILE) -> dict[str, str]:
    """Reads .env, overlaid with SHOPIFY_* variables from the environment.

    Args:
        path: The .env file: one KEY=value per line, # starts a comment, and
            values may be quoted.

    Returns:
        Every setting that has a non-empty value.
    """
    values = {}
    if path.exists():
        for raw_line in path.read_text().splitlines():
            line = raw_line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('"\'')
    values.update(
        {
            key: value
            for key, value in os.environ.items()
            if key.startswith(PREFIX)
        }
    )
    return {key: value for key, value in values.items() if value}
