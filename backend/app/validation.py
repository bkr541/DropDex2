"""
Thin wrapper around dropdex_importer.validation.

Import is deferred so this module can be loaded (and mocked) in tests
without requiring the full dropdex_importer package to be present.
"""

from __future__ import annotations


def validate(library):
    from dropdex_importer.validation import validate as _validate

    return _validate(library)
