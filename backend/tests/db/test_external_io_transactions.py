"""No outside service is called while a request holds a database transaction open (EMAIL-1).

Real PostgreSQL, committed data and one real session per request. At the moment an e-mail is being
sent, or Google's code exchange is running, PostgreSQL itself is asked how many connections to the
test database are *idle in transaction*. The sender is deliberately slow, like a real provider, so
the request that caused the message has finished long before the check.

Why it exists: with FastAPI ``BackgroundTasks`` the answer was 1 for the verification and the
password-changed e-mails - the request's session stayed open for as long as the send took.
"""

import time
from typing import Any

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.models.enums import AuthProvider
from app.services.email import EmailMessage
from app.services.email_dispatch import BackgroundEmailDispatcher
from app.services.oauth.fake import fake_code
from tests.db.auth_helpers import OTHER_PASSWORD, PASSWORD, make_account
from tests.db.oauth_helpers import callback, fake_provider, location, started_ok
from tests.db.test_listing_write_concurrency import committed_world

_IDLE_IN_TRANSACTION = text(
    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
    "AND state = 'idle in transaction' AND pid <> pg_backend_pid()"
)


def open_transactions(engine: Engine) -> int:
    with engine.connect() as connection:
        return int(connection.execute(_IDLE_IN_TRANSACTION).scalar_one())


class SlowProvider:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.seen: list[tuple[str, int]] = []

    def send(self, message: EmailMessage) -> None:
        time.sleep(0.4)
        self.seen.append((message.kind, open_transactions(self.engine)))


def test_the_check_really_detects_an_open_transaction(db_engine: Engine) -> None:
    """The control: without it, a count of zero below could mean the query sees nothing."""
    with Session(db_engine) as holding:
        holding.execute(text("SELECT 1"))  # a read begins a transaction and leaves it open

        assert open_transactions(db_engine) >= 1


def test_no_email_is_sent_while_a_database_transaction_is_open(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        dispatcher = env.app.state.email_dispatcher = BackgroundEmailDispatcher()
        provider = env.app.state.email_sender = SlowProvider(db_engine)
        make_account(env.session, "verified@example.org")
        env.session.commit()

        def after(response: Any, status: int) -> None:
            assert response.status_code == status, response.text
            assert dispatcher.drain(20)

        newcomer, member, anonymous = env.client(), env.client(), env.client()
        after(newcomer.register(email="newcomer@example.org"), 201)
        after(member.login(email="verified@example.org"), 200)
        after(
            member.post(
                "/auth/change-password",
                {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD},
            ),
            200,
        )
        after(anonymous.post("/auth/forgot-password", {"email": "verified@example.org"}), 202)
        dispatcher.close()

        assert provider.seen == [
            ("email_verification", 0),
            ("login_notice", 0),
            ("password_changed", 0),
            ("password_reset", 0),
        ]


@pytest.mark.parametrize("purpose", ["login", "link"])
def test_google_is_never_called_while_a_database_transaction_is_open(
    db_engine: Engine, purpose: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with committed_world(db_engine) as env:
        provider = fake_provider(env)
        real_exchange = provider.exchange
        counts: list[int] = []

        def watched(**kwargs: Any) -> Any:
            counts.append(open_transactions(db_engine))  # where the real adapter calls Google
            return real_exchange(**kwargs)

        monkeypatch.setattr(provider, "exchange", watched)
        assert provider.name is AuthProvider.GOOGLE
        make_account(env.session, "member@example.org")
        env.session.commit()
        api = env.client()
        if purpose == "link":  # a signed-in browser: the request reads its session as well
            assert api.login(email="member@example.org").status_code == 200
        email = "member@example.org" if purpose == "link" else "new@example.org"

        started = started_ok(api, purpose=purpose)
        response = callback(api, fake_code("sub-tx-1", email), state=started.state)

        assert "error=" not in location(response)
        assert counts == [0]
