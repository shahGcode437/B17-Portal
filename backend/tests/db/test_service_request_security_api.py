"""Security of Saved items and service requests against real PostgreSQL (Phase 12F).

Every unsafe cookie-authenticated write is protected centrally (Origin + the session's CSRF token,
Phase 11); nothing here is route-specific, so the tests prove EVERY new write is covered and that
a refused request writes nothing. Also: no request or contact data ever reaches a public surface,
and a suspended account loses access at once.
"""

from typing import Any

import pytest
from sqlalchemy import text

from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.request_helpers import (
    REQUESTS,
    SAVED,
    World,
    act,
    approved_provider,
    error_code,
    request_body,
    request_count,
    requester_signed_in,
    saved_rows,
    sent_id,
    stored_request,
    world,
)

TAMPERINGS: dict[str, dict[str, Any]] = {
    "no origin": {"origin": None},
    "foreign origin": {"origin": "https://evil.example.org"},
    "null origin": {"origin": "null"},
    "no csrf": {"csrf": None},
    "wrong csrf": {"csrf": "not-the-token"},
    "empty csrf": {"csrf": ""},
}
UNSAFE = ["create", "accept", "start", "complete", "cancel", "save", "unsave"]


class Scene:
    def __init__(self, env: AuthEnv) -> None:
        self.env = env
        self.w: World = world(env)
        self.request_id = sent_id(self.w.resident, self.w.listing_id)

    def api_for(self, call: str) -> AuthApi:
        return self.w.resident if call in ("create", "cancel", "save", "unsave") else self.w.owner

    def send(self, call: str, **tamper: Any) -> Any:
        api = self.api_for(call)
        if call == "create":
            other_listing = approved_provider(self.env, self.w.owner, name="Another Provider Co")
            return api.request("POST", REQUESTS, json=request_body(other_listing), **tamper)
        if call == "save":
            return api.request("PUT", f"{SAVED}/{self.w.listing_id}", **tamper)
        if call == "unsave":
            return api.request("DELETE", f"{SAVED}/{self.w.listing_id}", **tamper)
        return api.request("POST", f"{REQUESTS}/{self.request_id}/{call}", **tamper)

    def state(self) -> tuple[Any, ...]:
        row = stored_request(self.env.session, self.request_id)
        return (
            row["status"],
            request_count(self.env.session),
            saved_rows(self.env.session, "resident@example.org"),
        )


@pytest.mark.parametrize("tamper", list(TAMPERINGS))
@pytest.mark.parametrize("call", UNSAFE)
def test_origin_and_csrf_protect_every_new_write(auth_env: AuthEnv, call: str, tamper: str) -> None:
    scene = Scene(auth_env)
    if call == "unsave":
        scene.w.resident.request("PUT", f"{SAVED}/{scene.w.listing_id}")  # something to protect
    if call in ("start", "complete"):
        act(scene.w.owner, scene.request_id, "accept")
        if call == "complete":
            act(scene.w.owner, scene.request_id, "start")
    before = scene.state()

    response = scene.send(call, **TAMPERINGS[tamper])

    assert (response.status_code, error_code(response)) == (403, "csrf_failed"), (call, tamper)
    assert scene.state() == before  # nothing was written


@pytest.mark.parametrize("call", UNSAFE)
def test_a_valid_origin_and_csrf_token_succeed(auth_env: AuthEnv, call: str) -> None:
    scene = Scene(auth_env)
    if call == "unsave":
        scene.w.resident.request("PUT", f"{SAVED}/{scene.w.listing_id}")
    if call in ("start", "complete"):
        act(scene.w.owner, scene.request_id, "accept")
        if call == "complete":
            act(scene.w.owner, scene.request_id, "start")

    response = scene.send(call)

    assert response.status_code in (200, 201, 204), (call, response.text)


def test_another_browsers_csrf_token_is_not_accepted(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    response = scene.w.owner.request(
        "POST",
        f"{REQUESTS}/{scene.request_id}/accept",
        csrf=scene.w.resident.csrf,  # a valid token, but for someone else's session
    )

    assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert scene.state()[0] == "submitted"


def test_reads_do_not_need_a_csrf_token(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    for api, path in (
        (scene.w.resident, REQUESTS),
        (scene.w.resident, f"{REQUESTS}/{scene.request_id}"),
        (scene.w.resident, SAVED),
        (scene.w.owner, "/users/me/leads"),
    ):
        assert api.request("GET", path, csrf=None, origin=None).status_code == 200, path


def test_csrf_is_checked_before_authorization_details_leak(auth_env: AuthEnv) -> None:
    """A tampered write to a request the caller is not a party to answers 403 csrf_failed, never
    404 — the browser-level check comes first, so it cannot be used to probe for requests."""
    scene = Scene(auth_env)
    stranger = requester_signed_in(auth_env, "stranger@example.org")

    response = stranger.request(
        "POST", f"{REQUESTS}/{scene.request_id}/accept", origin="https://evil.example.org"
    )

    assert (response.status_code, error_code(response)) == (403, "csrf_failed")


# -- nothing reaches a public surface -------------------------------------------------------------


def test_no_public_response_mentions_a_request_or_its_requester(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    scene.w.resident.request("PUT", f"{SAVED}/{scene.w.listing_id}")
    anonymous = auth_env.client()

    public = [
        anonymous.get(f"/listings/{scene.w.listing_id}"),
        anonymous.get("/search", params={"q": "Bright Spark"}),
        anonymous.get("/search", params={"q": "kettle"}),  # words from the request's details
        anonymous.get("/search", params={"q": "Fix wiring"}),
        anonymous.get("/search/suggestions", params={"q": "Bright"}),
        anonymous.get("/categories"),
    ]

    for response in public:
        assert response.status_code == 200
        for private in (
            "Rana Resident",
            "kettle",
            "Please call before arriving",
            "B-17, Block C",
            "preferredContactChannel",
            "requesterName",
            scene.request_id,
        ):
            assert private not in response.text, (response.request.url, private)


def test_the_search_index_never_learns_a_requests_text(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    document = auth_env.session.execute(
        text("SELECT search_document FROM listings WHERE id = :i"), {"i": scene.w.listing_id}
    ).scalar_one()

    assert "kettle" not in document and "rana" not in document.lower()


def test_the_saved_list_of_another_user_never_shows_requests(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    scene.w.resident.request("PUT", f"{SAVED}/{scene.w.listing_id}")
    other = requester_signed_in(auth_env, "other@example.org")

    assert other.get(SAVED).json()["data"] == []
    assert scene.request_id not in scene.w.resident.get(SAVED).text


# -- saving grants nothing --------------------------------------------------------------------------


def test_saving_a_listing_gives_no_access_to_its_requests(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    saver = requester_signed_in(auth_env, "saver@example.org")
    saver.request("PUT", f"{SAVED}/{scene.w.listing_id}")

    assert saver.get(f"{REQUESTS}/{scene.request_id}").status_code == 404
    assert act(saver, scene.request_id, "cancel").status_code == 404
    assert saver.get("/users/me/leads").status_code == 403


# -- accounts that lose access -----------------------------------------------------------------------


def test_a_suspended_account_loses_every_new_surface_immediately(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    auth_env.session.execute(
        text("UPDATE users SET status = 'suspended' WHERE email = 'resident@example.org'")
    )
    auth_env.session.commit()
    resident = scene.w.resident

    for response in (
        resident.get(REQUESTS),
        resident.get(f"{REQUESTS}/{scene.request_id}"),
        resident.request("PUT", f"{SAVED}/{scene.w.listing_id}"),
        resident.get(SAVED),
        act(resident, scene.request_id, "cancel"),
    ):
        assert response.status_code == 401, response.text
    assert scene.state()[0] == "submitted"


def test_a_suspended_provider_can_no_longer_work_their_inbox(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    auth_env.session.execute(
        text("UPDATE users SET status = 'suspended' WHERE email = 'provider@example.org'")
    )
    auth_env.session.commit()

    assert scene.w.owner.get("/users/me/leads").status_code == 401
    assert act(scene.w.owner, scene.request_id, "accept").status_code == 401
    assert scene.state()[0] == "submitted"


def test_the_sessions_of_a_signed_out_user_are_dead_for_requests(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    assert scene.w.resident.post("/auth/logout").status_code == 204

    assert scene.w.resident.get(REQUESTS).status_code == 401
    assert scene.w.resident.request("PUT", f"{SAVED}/{scene.w.listing_id}").status_code == 401


def test_authorization_comes_from_the_database_not_from_the_session_age(
    auth_env: AuthEnv,
) -> None:
    """Dropping the professional profile revokes the inbox on the next request (re-read every time)."""
    scene = Scene(auth_env)
    assert scene.w.owner.get("/users/me/leads").status_code == 200
    auth_env.session.execute(
        text(
            "DELETE FROM professional_profiles WHERE user_id = "
            "(SELECT id FROM users WHERE email = 'provider@example.org')"
        )
    )
    auth_env.session.commit()

    assert scene.w.owner.get("/users/me/leads").status_code == 403


def test_a_provider_who_lost_their_profile_can_still_act_on_a_request_they_own(
    auth_env: AuthEnv,
) -> None:
    """Actions are authorised by ownership of the listing (API_CONTRACT §13), not by the capability."""
    scene = Scene(auth_env)
    auth_env.session.execute(
        text(
            "DELETE FROM professional_profiles WHERE user_id = "
            "(SELECT id FROM users WHERE email = 'provider@example.org')"
        )
    )
    auth_env.session.commit()

    assert act(scene.w.owner, scene.request_id, "accept").status_code == 200


def test_roles_in_the_request_body_or_query_grant_nothing(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    resident = scene.w.resident

    response = resident.request(
        "POST",
        f"{REQUESTS}/{scene.request_id}/accept",
        json={"role": "provider", "isAdmin": True, "roles": ["admin"]},
    )

    assert response.status_code == 422
    assert act(resident, scene.request_id, "accept", params={"as": "provider"}).status_code == 403
    assert scene.state()[0] == "submitted"
