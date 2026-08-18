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
            own ``max_rows`` setting. The helper advances by the number of rows
            actually returned, so a smaller server cap does not truncate results.

    Returns:
        Combined list of all matching rows in ``order_column`` order.
        No duplicates, no gaps.
    """
    all_rows: List[dict] = []
    start = 0
    request_count = 0
    previous_last_order_value: Any = object()

    while True:
        resp = (
            query_factory()
            .order(order_column)
            .range(start, start + page_size - 1)
            .execute()
        )
        request_count += 1
        page: List[dict] = resp.data or []
        if page:
            if order_column not in page[-1]:
                raise RuntimeError(
                    f"Supabase pagination order column '{order_column}' is missing from "
                    "the response; include it in the SELECT projection"
                )
            last_order_value = page[-1].get(order_column)
            if request_count > 1 and last_order_value == previous_last_order_value:
                raise RuntimeError(
                    "Supabase pagination made no forward progress; refusing a potentially "
                    "truncated result set"
                )
            previous_last_order_value = last_order_value
        all_rows.extend(page)

        # Do not treat a short page as terminal. PostgREST may clamp a requested
        # range to a server-side max_rows value smaller than page_size. Advancing
        # by the number actually returned and stopping only on an empty page keeps
        # pagination correct for both default and custom server caps.
        if not page:
            break

        start += len(page)

    logger.debug(
        "fetch_all_rows: %d rows in %d request(s) (page_size=%d, order=%s)",
        len(all_rows),
        request_count,
        page_size,
        order_column,
    )
    return all_rows
