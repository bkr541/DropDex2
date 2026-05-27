#!/usr/bin/env python3
"""
Verify that the importer .env is configured before running the real import.

Prints PASS / FAIL for each required variable without revealing secret values.
Exit code 0 = all required vars present, 1 = one or more missing.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

REQUIRED = [
    ("SUPABASE_URL", False),
    ("SUPABASE_SECRET_KEY", True),
    ("DROPDEX_OWNER_USER_ID", False),
]

OPTIONAL = [
    ("EXPORT_LIBRARY_PATH", False),
]

print()
print("── importer/.env check ─────────────────────────────────────────")
ok = True

for var, is_secret in REQUIRED:
    val = os.environ.get(var, "").strip()
    if val:
        display = f"[set, {len(val)} chars]" if is_secret else val
        print(f"  PASS  {var:<30} = {display}")
    else:
        print(f"  FAIL  {var:<30} = (missing)")
        ok = False

for var, is_secret in OPTIONAL:
    val = os.environ.get(var, "").strip()
    if val:
        exists = Path(val).exists()
        status = "exists" if exists else "NOT FOUND on disk"
        print(f"  INFO  {var:<30} = {val}  [{status}]")
    else:
        print(f"  INFO  {var:<30} = (not set — use --file instead)")

print()

if not ok:
    print("One or more required variables are missing.")
    print("Edit importer/.env and fill in the values.")
    sys.exit(1)

print("All required variables are present.")
sys.exit(0)
