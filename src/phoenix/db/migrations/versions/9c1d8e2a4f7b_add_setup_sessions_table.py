"""add setup_sessions table

Revision ID: 9c1d8e2a4f7b
Revises: d4e5f6a7b8c9
Create Date: 2026-07-08 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

_Integer = sa.Integer().with_variant(
    sa.BigInteger(),
    "postgresql",
)

# revision identifiers, used by Alembic.
revision: str = "9c1d8e2a4f7b"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "setup_sessions",
        sa.Column("id", _Integer, primary_key=True),
        sa.Column("session_token_hash", sa.String, nullable=False, unique=True, index=True),
        sa.Column("poll_token_hash", sa.String, nullable=False),
        sa.Column("verification_code", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False),
        sa.Column(
            "user_id",
            _Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            _Integer,
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("api_key_payload", sa.LargeBinary, nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False, index=True),
        sa.Column("delivered_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sqlite_autoincrement=True,
    )


def downgrade() -> None:
    op.drop_table("setup_sessions")
