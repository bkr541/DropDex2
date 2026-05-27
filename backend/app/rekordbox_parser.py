"""
Thin wrapper around dropdex_importer.parser.

Imports are deferred so this module can be loaded (and mocked) in tests
without requiring pyrekordbox and sqlcipher3 to be present.
"""

from __future__ import annotations


def parse_library(db_path: str):
    from dropdex_importer.parser import parse_library as _parse_library

    return _parse_library(db_path)
