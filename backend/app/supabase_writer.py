"""
Thin wrapper around dropdex_importer.supabase_writer.

Import is deferred so this module can be loaded (and mocked) in tests
without requiring the supabase package to be present.
"""

from __future__ import annotations


def write_to_supabase(library, supabase_url: str, supabase_key: str, owner_user_id: str) -> str:
    from dropdex_importer.supabase_writer import write_to_supabase as _write

    return _write(library, supabase_url, supabase_key, owner_user_id)
