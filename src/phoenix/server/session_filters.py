from datetime import datetime
from typing import Optional, Sequence

from openinference.semconv.trace import SpanAttributes
from sqlalchemy import distinct, or_, select
from sqlalchemy.sql.selectable import ScalarSelect

from phoenix.db import models
from phoenix.trace.dsl.session_filter import SessionFilter


def get_filtered_session_rowids_subquery(
    session_filter_condition: str,
    project_rowids: Sequence[int],
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> ScalarSelect[int]:
    """Compile the session filter DSL into a subquery of matching project-session rowids.

    ``session_filter_condition`` is a session-grain filter expression (see
    :class:`~phoenix.trace.dsl.session_filter.SessionFilter`), not a substring. The returned
    ``ScalarSelect[int]`` is the shared session-filter contract every fan-out consumer
    (counts, cost/latency summaries, the sessions list) applies as ``.where(id.in_(subquery))``.
    """
    return SessionFilter(condition=session_filter_condition).as_session_rowids_subquery(
        project_rowids=list(project_rowids),
        start_time=start_time,
        end_time=end_time,
    )


def get_io_substring_session_rowids_subquery(
    io_substring: str,
    project_rowids: Sequence[int],
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> ScalarSelect[int]:
    """Return session rowids whose root-span input or output contains ``io_substring``.

    Case-insensitive substring match over root spans only, backing the sessions list's free-text
    search. This is the pre-DSL matcher; the structured session filter lives in
    :func:`get_filtered_session_rowids_subquery`.
    """
    filtered_session_rowids = (
        select(distinct(models.Trace.project_session_rowid).label("id"))
        .join_from(models.Trace, models.Span)
        .where(models.Trace.project_rowid.in_(project_rowids))
        .where(models.Span.parent_id.is_(None))
        .where(
            or_(
                models.CaseInsensitiveContains(
                    models.Span.attributes[INPUT_VALUE].as_string(),
                    io_substring,
                ),
                models.CaseInsensitiveContains(
                    models.Span.attributes[OUTPUT_VALUE].as_string(),
                    io_substring,
                ),
            )
        )
    )
    if start_time:
        filtered_session_rowids = filtered_session_rowids.where(
            start_time <= models.Trace.start_time
        )
    if end_time:
        filtered_session_rowids = filtered_session_rowids.where(models.Trace.start_time < end_time)
    return filtered_session_rowids.scalar_subquery()


INPUT_VALUE = SpanAttributes.INPUT_VALUE.split(".")
OUTPUT_VALUE = SpanAttributes.OUTPUT_VALUE.split(".")
