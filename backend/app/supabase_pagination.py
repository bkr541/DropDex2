"""
Reusable pagination helper for Supabase/PostgREST queries.

PostgREST caps unpaginated SELECT responses at max_rows (default 1,000).
Any query that may return more rows than that cap must use this helper.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, List

logger = logging.getLogger(__name__)

_DEFAULT_PAGE_SIZE = 1000


def fetch_all_rows(
    query_factory: Callable[[], Any],
    *,
    order_column: str = "id",
    page_size: int = _DEFAULT_PAGE_SIZE,
) -> List[dict]:
    """
    Fetch every matching row from a Supabase table using range-based pagination.

    Args:
        query_factory: No-argument callable that returns a fresh query builder
            with all filters already applied (e.g. ``.select(...).eq(...)``).
            Called once per page so each page starts from a clean chain.
        order_column: Unique column used for deterministic page ordering.
            Must be stable across pages — ``"id"`` is the right choice for
            every table that has a UUID/bigint primary key.
        page_size: Rows to request per page.  The server caps responses at its
            own ``max_rows`` setting; values above the cap result in a shorter
            page, which correctly terminates the loop.

    Returns:
        Combined list of all matching rows in ``order_column`` order.
        No duplicates, no gaps.
    """
    all_rows: List[dict] = []
    start = 0

    while True:
        resp = (
            query_factory()
            .order(order_column)
            .range(start, start + page_size - 1)
            .execute()
        )
        page: List[dict] = resp.data or []
        all_rows.extend(page)

        # A page shorter than page_size means we've reached the last page.
        # This handles: 0 rows, partial final page, and exact multiples of page_size
        # (where the *next* page will be empty and terminate the loop).
        if len(page) < page_size:
            break

        start += page_size

    logger.debug(
        "fetch_all_rows: %d rows in %d request(s) (page_size=%d, order=%s)",
        len(all_rows),
        max(1, start // page_size + 1),
        page_size,
        order_column,
    )
    return all_rows
