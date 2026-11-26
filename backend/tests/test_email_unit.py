"""EMAIL-1 without a database: templates, the Resend adapter, the dispatcher and the settings.

No test here (or anywhere) contacts a provider: the adapter is driven through an ``httpx`` mock
transport. Real delivery is a manual check (DEPLOYMENT.md §12).
"""

import json
import logging
import threading
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.core.logging import request_id_var
from app.core.security.tokens import new_token
from app.factory import create_app
from app.services import email_resend
from app.services.email import (
    ConsoleEmailSender,
    DisabledEmailSender,
    EmailDeliveryError,
    EmailMessage,
    MemoryEmailSender,
    create_email_sender,
    deliver,
)
from app.services.email_dispatch import BackgroundEmailDispatcher, InlineEmailDispatcher
from app.services.email_resend import ENDPOINT, MAX_ATTEMPTS, ResendEmailSender
from app.services.email_templates import (
    GOOGLE_SECURITY_URL,
    format_time,
    login_notice_email,
    password_changed_notice,
    password_reset_email,
    verification_email,
)

ORIGIN = "https://b17portal.com"
HOSTED = {"frontend_origins": [ORIGIN], "frontend_base_url": ORIGIN}
SENDER = "B-17 Portal <notifications@mail.b17portal.com>"
API_KEY = "re_test_SECRET-API-KEY-never-logged"
RECIPIENT = "gina@example.org"
MOMENT = datetime(2026, 11, 26, 9, 5, tzinfo=UTC)


def settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"environment": "test", **HOSTED, **overrides}
    return Settings(_env_file=None, **values)


def every_message(config: Settings | None = None, to: str = RECIPIENT) -> list[EmailMessage]:
    config = config or settings()
    return [
        verification_email(config, to, new_token()),
        password_reset_email(config, to, new_token()),
        password_changed_notice(config, to, MOMENT),
        login_notice_email(config, to, method="password", occurred_at=MOMENT, idempotency_key="a"),
        login_notice_email(config, to, method="google", occurred_at=MOMENT, idempotency_key="b"),
    ]


# -- templates ---------------------------------------------------------------------------------


def test_every_message_has_a_text_and_an_accessible_html_alternative() -> None:
    for message in every_message():
        assert message.body.startswith("B-17 Portal\n"), message.kind
        html = message.html or ""
        assert html.startswith('<!doctype html><html lang="en">'), message.kind
        assert 'name="viewport"' in html and "max-width:560px" in html
        assert html.count("<h1") == 1 and 'role="presentation"' in html
        assert "B-17 Portal" in html
        assert "<" not in message.body.replace("<UTC", "")  # the text part carries no markup


def test_messages_load_nothing_remote_and_link_only_to_trusted_addresses() -> None:
    for message in every_message():
        html = message.html or ""
        for forbidden in ("<img", "<script", "<link", "<iframe", "url(", "@import"):
            assert forbidden not in html, (message.kind, forbidden)
        for url in [part.split('"', 1)[0] for part in html.split('href="')[1:]]:
            assert url.startswith(f"{ORIGIN}/"), (message.kind, url)
        for word in message.body.split():
            if word.startswith("http"):
                assert word.startswith((f"{ORIGIN}/", GOOGLE_SECURITY_URL)), (message.kind, word)


def test_no_message_carries_marketing_or_unsubscribe_content() -> None:
    for message in every_message():
        text = message.body.lower()
        for word in ("unsubscribe", "offer", "upgrade", "premium", "follow us", "newsletter"):
            assert word not in text, (message.kind, word)


def test_one_time_links_use_the_fragment_and_notices_carry_no_token() -> None:
    config = settings()
    token = new_token()
    for message, path in (
        (verification_email(config, RECIPIENT, token), "verify-email"),
        (password_reset_email(config, RECIPIENT, token), "reset-password"),
    ):
        link = f"{ORIGIN}/{path}#token={token}"
        assert message.link == link and "?" not in link
        assert link in message.body and f'href="{link}"' in (message.html or "")
    for message in every_message()[2:]:
        assert message.link is None and "token" not in (message.body + (message.html or ""))
        assert f"{ORIGIN}/forgot-password" in message.body


def test_values_are_html_escaped_in_every_part_of_the_markup() -> None:
    hostile = 'a"><script>alert(1)</script>@example.org'
    config = settings(email_support_address="help@b17portal.com")

    for message in every_message(config, to=hostile)[2:]:
        html = message.html or ""
        assert "<script>" not in html and '"><script' not in html
        assert "a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@example.org" in html
        assert hostile in message.body  # the plain-text part is text: nothing to escape


def test_the_support_address_appears_only_when_one_is_configured() -> None:
    assert all("Need help?" not in m.body for m in every_message())
    configured = every_message(settings(email_support_address="help@b17portal.com"))
    assert all("Need help? Write to help@b17portal.com." in m.body for m in configured)


def test_the_sign_in_time_is_shown_in_pakistan_time_with_its_offset() -> None:
    assert format_time(MOMENT) == "26 November 2026 at 14:05 PKT (UTC+5)"
    assert format_time(datetime(2026, 12, 31, 20, 30, tzinfo=UTC)) == (
        "1 January 2027 at 01:30 PKT (UTC+5)"
    )


@pytest.mark.parametrize(
    ("method", "label"), [("password", "Email and password"), ("google", "Google")]
)
def test_a_sign_in_notice_says_when_how_and_what_to_do(method: Any, label: str) -> None:
    message = login_notice_email(
        settings(), RECIPIENT, method=method, occurred_at=MOMENT, idempotency_key="k"
    )

    assert message.kind == "login_notice" and message.idempotency_key == "k"
    assert f"Sign-in method: {label}" in message.body
    assert "Date and time: 26 November 2026 at 14:05 PKT (UTC+5)" in message.body
    assert f"Account: {RECIPIENT}" in message.body
    assert "If you do not recognise this sign-in" in message.body
    assert f"{ORIGIN}/forgot-password" in message.body
    assert (GOOGLE_SECURITY_URL in message.body) is (method == "google")


def test_each_logical_message_has_its_own_idempotency_key() -> None:
    config = settings()
    first = verification_email(config, RECIPIENT, new_token())
    second = verification_email(config, RECIPIENT, new_token())

    assert first.idempotency_key != second.idempotency_key
    assert len(first.idempotency_key) <= 256


# -- the Resend adapter ------------------------------------------------------------------------


class FakeResend:
    """A scripted provider: records every request, answers from a queue (the last one repeats)."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers) or [(200, {"id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"})]
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        status, body, *headers = answer
        extra = headers[0] if headers else None
        if isinstance(body, bytes):
            return httpx.Response(status, content=body, headers=extra)
        return httpx.Response(status, json=body, headers=extra)


def resend(
    provider: FakeResend, sleeps: list[float] | None = None, **overrides: Any
) -> ResendEmailSender:
    pauses = sleeps if sleeps is not None else []
    values: dict[str, Any] = {
        "api_key": SecretStr(API_KEY),
        "sender": SENDER,
        "http": httpx.Client(transport=httpx.MockTransport(provider.handler)),
        "sleep": pauses.append,
        "user_agent": "b17-portal-api/test",
        **overrides,
    }
    return ResendEmailSender(**values)


def a_message() -> EmailMessage:
    return password_reset_email(settings(), RECIPIENT, new_token())


def test_the_request_is_the_documented_one() -> None:
    provider, message = FakeResend(), a_message()

    resend(provider, reply_to="support@b17portal.com").send(message)

    [request] = provider.requests
    assert (request.method, str(request.url)) == ("POST", ENDPOINT)
    assert ENDPOINT == "https://api.resend.com/emails"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    assert request.headers["content-type"] == "application/json"
    assert request.headers["idempotency-key"] == message.idempotency_key
    assert request.headers["user-agent"] == "b17-portal-api/test"
    assert json.loads(request.content) == {
        "from": SENDER,
        "to": [RECIPIENT],
        "subject": message.subject,
        "text": message.body,
        "html": message.html,
        "reply_to": "support@b17portal.com",
        "tags": [{"name": "kind", "value": "password_reset"}],
    }


def test_reply_to_is_sent_only_when_configured() -> None:
    provider = FakeResend()

    resend(provider).send(a_message())

    assert "reply_to" not in json.loads(provider.requests[0].content)


def test_acceptance_is_logged_as_accepted_never_as_delivered(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    message = a_message()

    resend(FakeResend()).send(message)

    [record] = [r for r in caplog.records if r.name == "app.email"]
    assert record.getMessage() == "email accepted by provider"
    assert record.__dict__["providerMessageId"] == "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
    assert "delivered" not in caplog.text
    blob = f"{record.__dict__}"
    for secret in (API_KEY, RECIPIENT, message.link or "?", message.subject):
        assert secret not in blob


@pytest.mark.parametrize(
    "body", [{}, {"id": ""}, {"id": 7}, {"id": "x y\nz"}, b"<html>ok</html>", ["id"]]
)
def test_a_success_without_a_message_id_is_not_claimed_as_accepted(body: Any) -> None:
    provider = FakeResend((200, body))

    with pytest.raises(EmailDeliveryError) as error:
        resend(provider).send(a_message())

    assert error.value.outcome == "unconfirmed" and len(provider.requests) == 1


@pytest.mark.parametrize(
    ("status", "name"),
    [
        (400, "validation_error"),
        (401, "missing_api_key"),
        (401, "restricted_api_key"),
        (403, "validation_error"),  # unverified domain, or the testing-mode recipient rule
        (409, "invalid_idempotent_request"),
        (422, "missing_required_field"),
        (429, "daily_quota_exceeded"),
        (429, "monthly_quota_exceeded"),
    ],
)
def test_a_refusal_is_final_and_is_not_retried(status: int, name: str) -> None:
    provider = FakeResend((status, {"name": name, "message": "SECRET-MARKER text"}))

    with pytest.raises(EmailDeliveryError) as error:
        resend(provider).send(a_message())

    assert len(provider.requests) == 1
    assert (error.value.outcome, error.value.provider_status, error.value.provider_error) == (
        "refused",
        status,
        name,
    )
    assert "SECRET-MARKER" not in f"{error.value} {error.value.log_fields()}"


@pytest.mark.parametrize(
    "first",
    [
        (429, {"name": "rate_limit_exceeded"}),
        (500, {"name": "application_error"}),
        (503, {"name": "service_unavailable"}),
        (502, b"<html>bad gateway</html>"),
        (409, {"name": "concurrent_idempotent_requests"}),
        httpx.ConnectTimeout("handshake timed out"),
        httpx.ReadTimeout("no answer"),
        httpx.ConnectError("name resolution failed"),
    ],
)
def test_a_transient_failure_is_retried_once_with_the_same_idempotency_key(first: Any) -> None:
    provider = FakeResend(first, (200, {"id": "accepted-1"}))
    sleeps: list[float] = []
    message = a_message()

    resend(provider, sleeps).send(message)

    assert [r.headers["idempotency-key"] for r in provider.requests] == [
        message.idempotency_key
    ] * 2
    assert provider.requests[0].content == provider.requests[1].content  # same key, same payload
    assert len(sleeps) == 1 and 0 <= sleeps[0] <= 2.0


def test_attempts_are_bounded_and_a_timeout_ends_unconfirmed() -> None:
    provider = FakeResend(httpx.ReadTimeout("SECRET-MARKER"))

    with pytest.raises(EmailDeliveryError) as error:
        resend(provider).send(a_message())

    assert len(provider.requests) == MAX_ATTEMPTS == 2
    assert error.value.outcome == "unconfirmed"  # it may have arrived: never "not sent"
    assert error.value.error_type == "ReadTimeout" and error.value.attempts == 2
    assert error.value.__cause__ is None and "SECRET-MARKER" not in f"{error.value.log_fields()}"


def test_a_persistent_server_error_ends_unconfirmed_after_the_last_attempt() -> None:
    provider = FakeResend((503, {"name": "service_unavailable"}))

    with pytest.raises(EmailDeliveryError) as error:
        resend(provider).send(a_message())

    assert len(provider.requests) == 2 and error.value.outcome == "unconfirmed"


@pytest.mark.parametrize(
    ("header", "pause"), [("1", 1.0), ("3600", 2.0), ("-5", 0.0), ("soon", 0.5), (None, 0.5)]
)
def test_a_retry_after_header_is_honoured_but_never_stalls_the_worker(
    header: str | None, pause: float
) -> None:
    headers = {"retry-after": header} if header is not None else {}
    provider = FakeResend((429, {"name": "rate_limit_exceeded"}, headers), (200, {"id": "a"}))
    sleeps: list[float] = []

    resend(provider, sleeps).send(a_message())

    assert sleeps == [pause]


def test_an_unknown_provider_error_name_is_never_repeated() -> None:
    provider = FakeResend((400, {"name": "SECRET-MARKER free text", "message": "more"}))

    with pytest.raises(EmailDeliveryError) as error:
        resend(provider).send(a_message())

    assert error.value.provider_error is None


def test_the_configured_timeout_bounds_every_network_operation() -> None:
    sender = ResendEmailSender(api_key=SecretStr(API_KEY), sender=SENDER, timeout_seconds=7)

    timeout = sender._http.timeout
    assert (timeout.connect, timeout.read, timeout.write, timeout.pool) == (7, 7, 7, 7)


@pytest.mark.parametrize(
    "answer",
    [
        (401, {"name": "missing_api_key", "message": f"bad key {API_KEY}"}),
        httpx.ConnectError(f"cannot connect as {API_KEY} to {RECIPIENT}"),
    ],
)
def test_a_failed_delivery_is_observable_without_any_secret(
    caplog: pytest.LogCaptureFixture, answer: Any
) -> None:
    caplog.set_level(logging.DEBUG)
    message = a_message()

    deliver(resend(FakeResend(answer)), message)  # never raises

    [record] = [r for r in caplog.records if r.name == "app.email" and r.levelno >= logging.ERROR]
    assert record.__dict__["emailKind"] == "password_reset"
    everything = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)
    for secret in (API_KEY, RECIPIENT, message.link or "?", "Choose a new password"):
        assert secret not in everything, secret


def test_an_unexpected_sender_error_logs_only_its_class_name(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class Broken:
        def send(self, message: EmailMessage) -> None:
            raise RuntimeError(f"could not send {message.body} to {message.to}")

    caplog.set_level(logging.DEBUG)
    message = a_message()

    deliver(Broken(), message)

    [record] = [r for r in caplog.records if r.name == "app.email"]
    assert record.__dict__["errorType"] == "RuntimeError" and record.exc_info is None
    for secret in (RECIPIENT, message.link or "?"):
        assert secret not in f"{record.__dict__}"


# -- logs while really talking HTTP ------------------------------------------------------------


class LoopbackResend:
    """A stand-in provider on 127.0.0.1, so the REAL HTTP stack (httpx and httpcore) runs and
    logs exactly as it would against Resend. Nothing leaves this machine."""

    def __init__(self, status: int) -> None:
        received = self.received = []  # type: list[tuple[dict[str, str], bytes]]

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:  # noqa: N802 - the name http.server requires
                body = self.rfile.read(int(self.headers["content-length"]))
                received.append(({k.lower(): v for k, v in self.headers.items()}, body))
                ok = status < 300
                reply = json.dumps({"id": "loopback-1"} if ok else {"name": "validation_error"})
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(reply)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(reply.encode())

            def log_message(self, *args: object) -> None:
                return None

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/emails"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture(params=[200, 403, 500], ids=["accepted", "refused", "server-error"])
def loopback(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> Iterator[LoopbackResend]:
    provider = LoopbackResend(request.param)
    monkeypatch.setattr(email_resend, "ENDPOINT", provider.url)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy"):
        monkeypatch.delenv(name, raising=False)
    yield provider
    provider.close()


@pytest.mark.parametrize("template", [verification_email, password_reset_email])
def test_one_time_links_and_the_key_never_reach_the_logs_even_at_debug(
    loopback: LoopbackResend, caplog: pytest.LogCaptureFixture, template: Any
) -> None:
    caplog.set_level(logging.DEBUG)  # DEBUG=true: httpx and httpcore trace every request
    token = new_token()
    message = template(settings(), RECIPIENT, token)
    sender = ResendEmailSender(api_key=SecretStr(API_KEY), sender=SENDER, sleep=lambda _: None)

    deliver(sender, message)

    # The control: the secrets really did travel, and the HTTP stack really did log.
    headers, body = loopback.received[0]
    assert headers["authorization"] == f"Bearer {API_KEY}" and token in body.decode()
    assert any(r.name.startswith("httpcore") for r in caplog.records)
    logged = "\n".join(
        f"{r.name} {r.getMessage()} {r.__dict__} {r.exc_text or ''}" for r in caplog.records
    )
    for secret in (token, message.link or "?", API_KEY, RECIPIENT, "#token=", message.subject):
        assert secret not in logged, secret


# -- the dispatcher ----------------------------------------------------------------------------


class Gate:
    """A sender that blocks until released, so a test can look while a send is in flight."""

    def __init__(self, on_send: Callable[[], None] | None = None) -> None:
        self.release = threading.Event()
        self.started = threading.Event()
        self.sent: list[str] = []
        self.threads: list[str] = []
        self._on_send = on_send

    def send(self, message: EmailMessage) -> None:
        self.threads.append(threading.current_thread().name)
        self.started.set()
        assert self.release.wait(10)
        if self._on_send:
            self._on_send()
        self.sent.append(message.idempotency_key)


def numbered(index: int) -> EmailMessage:
    return EmailMessage(
        to=RECIPIENT, subject="s", body="b", kind="login_notice", idempotency_key=f"k{index}"
    )


def test_submitting_never_waits_for_the_provider_and_sends_off_the_calling_thread() -> None:
    gate, dispatcher = Gate(), BackgroundEmailDispatcher()
    began = time.monotonic()

    dispatcher.submit(gate, numbered(1))

    assert time.monotonic() - began < 1 and gate.sent == []
    assert gate.started.wait(5) and gate.threads[0].startswith("b17-email")
    gate.release.set()
    assert dispatcher.drain(5) and gate.sent == ["k1"]
    dispatcher.close()


def test_the_queue_is_bounded_and_a_dropped_message_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    gate = Gate()
    dispatcher = BackgroundEmailDispatcher(workers=1, max_pending=2)

    for index in range(5):
        dispatcher.submit(gate, numbered(index))

    dropped = [r.__dict__ for r in caplog.records if r.getMessage() == "email not queued"]
    assert [r["reason"] for r in dropped] == ["queue_full"] * 3
    assert all(RECIPIENT not in f"{r}" for r in dropped)
    gate.release.set()
    assert dispatcher.drain(5) and sorted(gate.sent) == ["k0", "k1"]
    dispatcher.submit(gate, numbered(9))  # finished sends give their places back
    assert dispatcher.drain(5) and gate.sent[-1] == "k9"
    dispatcher.close()


def test_closing_drains_what_is_queued_and_then_accepts_nothing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    gate, dispatcher = Gate(), BackgroundEmailDispatcher(workers=1)
    gate.release.set()
    for index in range(3):
        dispatcher.submit(gate, numbered(index))

    dispatcher.close()
    dispatcher.submit(gate, numbered(99))

    assert gate.sent == ["k0", "k1", "k2"]
    assert [r.__dict__.get("reason") for r in caplog.records][-1] == "shutting_down"


def test_a_stuck_provider_cannot_hold_up_shutdown_and_the_loss_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    gate = Gate()
    dispatcher = BackgroundEmailDispatcher(workers=1, drain_seconds=0.2)
    dispatcher.submit(gate, numbered(1))
    dispatcher.submit(gate, numbered(2))
    assert gate.started.wait(5)
    began = time.monotonic()

    dispatcher.close()

    assert time.monotonic() - began < 3
    [record] = [r for r in caplog.records if r.getMessage() == "email unfinished at shutdown"]
    assert record.__dict__["count"] == 2
    gate.release.set()  # let the worker end; the queued one was cancelled
    time.sleep(0.2)
    assert gate.sent in ([], ["k1"])


def test_a_failing_send_does_not_stop_the_worker_and_keeps_its_request_id() -> None:
    seen: list[str | None] = []

    class Flaky:
        calls = 0

        def send(self, message: EmailMessage) -> None:
            Flaky.calls += 1
            seen.append(request_id_var.get())
            if Flaky.calls == 1:
                raise ConnectionError("down")

    dispatcher = BackgroundEmailDispatcher(workers=1)
    token = request_id_var.set("request-abc-123")
    try:
        dispatcher.submit(Flaky(), numbered(1))
        dispatcher.submit(Flaky(), numbered(2))
    finally:
        request_id_var.reset(token)

    assert dispatcher.drain(5) and seen == ["request-abc-123"] * 2
    dispatcher.close()


def test_only_the_in_memory_backend_is_sent_inline() -> None:
    for backend, expected in (
        ("memory", InlineEmailDispatcher),
        ("console", BackgroundEmailDispatcher),
        ("disabled", BackgroundEmailDispatcher),
    ):
        app = create_app(settings(email_backend=backend))
        assert isinstance(app.state.email_dispatcher, expected), backend
        app.state.email_dispatcher.close()


# -- settings ----------------------------------------------------------------------------------

#: A complete provider setup. ``development``: the ``test`` environment refuses it by design.
RESEND = {
    "environment": "development",
    "email_backend": "resend",
    "resend_api_key": API_KEY,
    "email_from": SENDER,
}


@pytest.mark.parametrize("environment", ["development", "staging", "production"])
def test_a_complete_provider_configuration_is_accepted_outside_tests(environment: str) -> None:
    config = settings(**{**RESEND, "environment": environment})

    sender = create_email_sender(config)

    assert isinstance(sender, ResendEmailSender)


def test_the_test_environment_can_never_use_the_real_provider() -> None:
    with pytest.raises(ValidationError, match="ENVIRONMENT=test"):
        settings(**{**RESEND, "environment": "test"})


@pytest.mark.parametrize("typed", [f"  {API_KEY}  ", f"{API_KEY}\n", f"{API_KEY}\r\n"])
def test_the_spaces_a_paste_adds_to_the_key_are_dropped(typed: str) -> None:
    config = settings(**{**RESEND, "resend_api_key": typed})

    assert config.resend_api_key is not None
    assert config.resend_api_key.get_secret_value() == API_KEY


@pytest.mark.parametrize("bad", ["re_abc def", "re_abc\ndef", "re_abc def", "re_café"])
def test_a_key_that_cannot_be_a_header_stops_the_start_without_being_quoted(bad: str) -> None:
    with pytest.raises(ValidationError, match="RESEND_API_KEY") as error:
        settings(**{**RESEND, "resend_api_key": bad})

    assert bad not in str(error.value) and "re_" not in str(error.value)


def test_hosted_environments_stay_disabled_by_default_and_refuse_dev_backends() -> None:
    config = settings(environment="production")
    assert config.email_backend == "disabled"
    assert isinstance(create_email_sender(config), DisabledEmailSender)
    for backend in ("console", "memory"):
        with pytest.raises(ValidationError, match="EMAIL_BACKEND"):
            settings(environment="production", email_backend=backend)


def test_local_development_needs_no_provider_credentials() -> None:
    config = Settings(_env_file=None, environment="development")

    assert config.email_backend == "console" and config.resend_api_key is None
    assert isinstance(create_email_sender(config), ConsoleEmailSender)
    assert isinstance(create_email_sender(settings()), MemoryEmailSender)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"resend_api_key": None}, "RESEND_API_KEY"),
        ({"resend_api_key": "   "}, "RESEND_API_KEY"),
        ({"email_from": "B-17 Portal <no-reply@localhost>"}, "EMAIL_FROM"),
        ({"email_from": "B-17 Portal"}, "EMAIL_FROM"),
        ({"email_from": f"{SENDER}\r\nBcc: x@example.org"}, "single line"),
        ({"email_support_address": "not-an-address"}, "EMAIL_SUPPORT_ADDRESS"),
        ({"email_timeout_seconds": 0}, "email_timeout_seconds"),
        ({"email_timeout_seconds": 600}, "email_timeout_seconds"),
    ],
)
def test_an_incomplete_provider_configuration_stops_the_start(
    overrides: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        settings(**{**RESEND, **overrides})


def test_hosted_email_links_must_be_https() -> None:
    insecure = "http://b17portal.com"
    with pytest.raises(ValidationError, match="https"):
        settings(
            **{**RESEND, "environment": "production"},
            frontend_origins=[insecure],
            frontend_base_url=insecure,
        )


def test_reply_to_follows_the_support_address_setting() -> None:
    for address, expected in ((None, None), ("help@b17portal.com", "help@b17portal.com")):
        sender = create_email_sender(settings(**RESEND, email_support_address=address))
        assert isinstance(sender, ResendEmailSender)
        provider = FakeResend()
        sender._http = httpx.Client(transport=httpx.MockTransport(provider.handler))

        sender.send(a_message())

        assert json.loads(provider.requests[0].content).get("reply_to") == expected


def test_the_api_key_never_appears_in_repr_dumps_or_errors() -> None:
    config = settings(**RESEND)
    sender = create_email_sender(config)

    for text in (repr(config), str(config), str(config.model_dump()), config.model_dump_json()):
        assert API_KEY not in text
    assert API_KEY not in repr(sender)


@pytest.mark.parametrize("secret", ["resend_api_key", "google_oauth_client_secret", "database_url"])
def test_a_failed_startup_check_never_quotes_a_secret(secret: str) -> None:
    """Pydantic quotes the raw input in its errors, truncated in the MIDDLE: a secret given last
    is exactly the part that would survive."""
    marker = "SECRET-TAIL-must-never-be-quoted"
    value = (
        f"postgresql+psycopg://u:{marker}@localhost:5432/x" if secret == "database_url" else marker
    )
    values: dict[str, Any] = {
        "environment": "development",
        "email_backend": "resend",
        "email_from": "nobody",
        secret: value,
    }

    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **values)

    for text in (str(error.value), repr(error.value)):
        assert marker not in text and marker[-12:] not in text
