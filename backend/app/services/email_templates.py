"""The transactional e-mails (EMAIL-1; docs/backend/AUTH_RBAC.md §14.1).

Every message is built by one layout (:func:`_render`) that produces a plain-text body and a
matching HTML body, so the two can never drift apart. Rules that hold for all of them:

* **Escaping.** Every piece of text and every URL is HTML-escaped by the layout; a template never
  writes markup itself.
* **No user-written text.** The display name is deliberately not used: anyone can register with
  another person's address, and a greeting built from a free-text field would let them put their own
  words into a message sent by B-17 Portal. The only account value shown is the address itself.
* **Trusted links only.** Action links come from the *configured* ``FRONTEND_BASE_URL`` (never a
  request value), plus the one fixed Google security page. One-time tokens travel in the URL
  **fragment** (AUTH_RBAC.md §8).
* **No remote content.** No images, fonts, scripts or tracking pixels, and nothing promotional.
* Never a password, session token, cookie or CSRF value.
"""

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Literal

from app.core.config import Settings
from app.services.email import EmailMessage

#: B-17 is in Islamabad. Pakistan Standard Time has no daylight saving, so a fixed offset is exact
#: and needs no time-zone database in the container.
PKT = timezone(timedelta(hours=5), "PKT")

LoginMethod = Literal["password", "google"]
LOGIN_METHOD_LABELS: dict[LoginMethod, str] = {
    "password": "Email and password",
    "google": "Google",
}
GOOGLE_SECURITY_URL = "https://myaccount.google.com/security"

_BRAND = "B-17 Portal"
_PRIMARY = "#047857"
_TEXT = "#0f172a"
_MUTED = "#475569"
_FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"


def format_time(moment: datetime) -> str:
    """``26 November 2026 at 14:05 PKT (UTC+5)``."""
    local = moment.astimezone(PKT)
    return f"{local.day} {local:%B %Y} at {local:%H:%M} PKT (UTC+5)"


def _base_url(settings: Settings) -> str:
    if settings.frontend_base_url is None:
        raise RuntimeError("FRONTEND_BASE_URL is not configured")
    return settings.frontend_base_url


def _token_link(settings: Settings, path: str, token: str) -> str:
    return f"{_base_url(settings)}/{path}#token={token}"


def _footer(settings: Settings) -> list[str]:
    lines = [f"This is an automatic message from {_BRAND} about your account."]
    if settings.email_support_address:
        lines.append(f"Need help? Write to {settings.email_support_address}.")
    return lines


def _paragraph(text: str, *, color: str = _TEXT, size: int = 16) -> str:
    return (
        f'<p style="margin:0 0 16px;{_FONT};font-size:{size}px;line-height:1.55;color:{color}">'
        f"{escape(text)}</p>"
    )


def _render(
    settings: Settings,
    *,
    heading: str,
    intro: Sequence[str],
    facts: Sequence[tuple[str, str]] = (),
    action: tuple[str, str] | None = None,
    after: Sequence[str] = (),
) -> tuple[str, str]:
    """``(plain_text, html)`` of one message."""
    footer = _footer(settings)

    text: list[str] = [_BRAND, "", heading, ""]
    for line in intro:
        text += [line, ""]
    if facts:
        text += [f"{label}: {value}" for label, value in facts] + [""]
    if action:
        text += [f"{action[0]}:", action[1], ""]
    for line in after:
        text += [line, ""]
    text += ["--", *footer]

    blocks = [_paragraph(line) for line in intro]
    if facts:
        rows = "".join(
            f'<tr><th scope="row" align="left" style="padding:4px 16px 4px 0;{_FONT};'
            f'font-size:15px;font-weight:600;color:{_MUTED};vertical-align:top">{escape(label)}'
            f'</th><td style="padding:4px 0;{_FONT};font-size:15px;color:{_TEXT};'
            f'word-break:break-word">{escape(value)}</td></tr>'
            for label, value in facts
        )
        blocks.append(f'<table style="margin:0 0 20px;border-collapse:collapse">{rows}</table>')
    if action:
        label, url = escape(action[0]), escape(action[1])
        blocks.append(
            f'<p style="margin:4px 0 20px"><a href="{url}" style="display:inline-block;'
            f"background:{_PRIMARY};color:#ffffff;text-decoration:none;border-radius:8px;"
            f'padding:13px 22px;{_FONT};font-size:16px;font-weight:600">{label}</a></p>'
        )
        blocks.append(
            f'<p style="margin:0 0 16px;{_FONT};font-size:13px;line-height:1.5;color:{_MUTED}">'
            "If the button does not work, copy this address into your browser:<br>"
            f'<a href="{url}" style="color:{_PRIMARY};word-break:break-all">{url}</a></p>'
        )
    blocks += [_paragraph(line) for line in after]
    closing = "".join(_paragraph(line, color=_MUTED, size=13) for line in footer)

    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(heading)}</title></head>"
        '<body style="margin:0;padding:0;background:#f1f5f9">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:560px;background:#ffffff;border-radius:12px">'
        f'<tr><td style="padding:20px 24px;border-bottom:3px solid {_PRIMARY};{_FONT};'
        f'font-size:18px;font-weight:700;color:{_PRIMARY}">{_BRAND}</td></tr>'
        '<tr><td style="padding:24px">'
        f'<h1 style="margin:0 0 16px;{_FONT};font-size:22px;line-height:1.3;color:{_TEXT}">'
        f"{escape(heading)}</h1>"
        f"{''.join(blocks)}</td></tr>"
        f'<tr><td style="padding:16px 24px 8px;border-top:1px solid #e2e8f0">{closing}</td></tr>'
        "</table></td></tr></table></body></html>"
    )
    return "\n".join(text), html


def verification_email(settings: Settings, to: str, token: str) -> EmailMessage:
    link = _token_link(settings, "verify-email", token)
    body, html = _render(
        settings,
        heading="Confirm your email address",
        intro=["Welcome to B-17 Portal. Confirm that this email address belongs to you."],
        action=("Verify email address", link),
        after=[
            "The link works once and expires in 24 hours. If you did not create an account, "
            "ignore this message."
        ],
    )
    return EmailMessage(
        to=to,
        subject="Verify your B-17 Portal email",
        body=body,
        html=html,
        kind="email_verification",
        link=link,
    )


def password_reset_email(settings: Settings, to: str, token: str) -> EmailMessage:
    link = _token_link(settings, "reset-password", token)
    body, html = _render(
        settings,
        heading="Reset your password",
        intro=["We received a request to reset the password of your B-17 Portal account."],
        action=("Choose a new password", link),
        after=[
            "The link works once and expires in 60 minutes. If you did not ask for this, ignore "
            "this message - your password has not changed."
        ],
    )
    return EmailMessage(
        to=to,
        subject="Reset your B-17 Portal password",
        body=body,
        html=html,
        kind="password_reset",
        link=link,
    )


def password_changed_notice(settings: Settings, to: str, occurred_at: datetime) -> EmailMessage:
    body, html = _render(
        settings,
        heading="Your password was changed",
        intro=[
            "The password of your B-17 Portal account was just changed, and your other signed-in "
            "devices were signed out."
        ],
        facts=[("Account", to), ("Date and time", format_time(occurred_at))],
        action=("Reset your password", f"{_base_url(settings)}/forgot-password"),
        after=[
            "If this was you, you do not need to do anything.",
            "If this was not you, reset your password immediately with the link above. That signs "
            "out every device.",
        ],
    )
    return EmailMessage(
        to=to,
        subject="Your B-17 Portal password was changed",
        body=body,
        html=html,
        kind="password_changed",
    )


def login_notice_email(
    settings: Settings,
    to: str,
    *,
    method: LoginMethod,
    occurred_at: datetime,
    idempotency_key: str,
) -> EmailMessage:
    reset_url = f"{_base_url(settings)}/forgot-password"
    if method == "google":
        guidance = (
            "If you do not recognise this sign-in, first secure your Google account at "
            f"{GOOGLE_SECURITY_URL}. Then set a new B-17 Portal password with the link above, "
            "which signs out every device."
        )
    else:
        guidance = (
            "If you do not recognise this sign-in, reset your password now with the link above. "
            "That signs out every device."
        )
    body, html = _render(
        settings,
        heading="New sign-in to your account",
        intro=["Your B-17 Portal account was just signed in to."],
        facts=[
            ("Account", to),
            ("Date and time", format_time(occurred_at)),
            ("Sign-in method", LOGIN_METHOD_LABELS[method]),
        ],
        action=("Reset your password", reset_url),
        after=["If this was you, you do not need to do anything.", guidance],
    )
    return EmailMessage(
        to=to,
        subject="New sign-in to your B-17 Portal account",
        body=body,
        html=html,
        kind="login_notice",
        idempotency_key=idempotency_key,
    )
