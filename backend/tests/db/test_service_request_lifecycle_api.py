"""The service-request lifecycle against real PostgreSQL (Phase 12F; API_CONTRACT.md §13).

    submitted -> accepted -> in-progress -> completed            (provider: accept, start, complete)
    submitted | accepted | in-progress -> cancelled              (provider: cancel)
    submitted | accepted -> cancelled                            (requester: cancel)

The expectation table below is written out independently of the implementation: for every
(actor, action, current status) it says what MUST happen. A non-party always gets the concealing
``404``; a party who has no authority over the action gets ``403``; a party with authority but the
wrong status gets ``409 invalid_state_transition``.
"""

from typing import Any

import pytest

from app.models.enums import ListingStatus
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.request_helpers import (
    ACTIONS,
    REQUESTS,
    World,
    detail,
    error_code,
    history_of,
    history_rows,
    new_id,
    provider_signed_in,
    request_count,
    requester_signed_in,
    sent_id,
    set_request_status,
    status_of,
    stored_request,
    world,
)
from tests.db.request_helpers import act as act_on
from tests.db.write_helpers import set_status, signed_in

STATUSES = ("submitted", "accepted", "in-progress", "completed", "cancelled")
TARGET = {
    "accept": "accepted",
    "start": "in-progress",
    "complete": "completed",
    "cancel": "cancelled",
}
#: (action, role) -> the statuses it may be applied from. Anything not listed is not allowed.
ALLOWED: dict[tuple[str, str], set[str]] = {
    ("accept", "provider"): {"submitted"},
    ("start", "provider"): {"accepted"},
    ("complete", "provider"): {"in-progress"},
    ("cancel", "provider"): {"submitted", "accepted", "in-progress"},
    ("cancel", "requester"): {"submitted", "accepted"},
}


def expected(actor: str, action: str, status: str) -> int:
    """The HTTP status the frozen design demands."""
    if actor == "anonymous":
        return 401
    if actor in ("stranger", "other_professional", "admin"):
        return 404  # not a party: indistinguishable from "no such request"
    if (action, actor) not in ALLOWED:
        return 403  # a party, but this action is not theirs
    return 200 if status in ALLOWED[(action, actor)] else 409


class Scene:
    """A request, both parties and three kinds of outsider (created on first use: signing in
    an account costs a login, and most tests need only two of them)."""

    def __init__(self, env: AuthEnv) -> None:
        self.env = env
        self.w: World = world(env)
        self.request_id = sent_id(self.w.resident, self.w.listing_id)
        self._actors: dict[str, AuthApi] = {"requester": self.w.resident, "provider": self.w.owner}

    def actor(self, name: str) -> AuthApi:
        if name not in self._actors:
            env = self.env
            self._actors[name] = {
                "stranger": lambda: requester_signed_in(env, "stranger@example.org"),
                "other_professional": lambda: provider_signed_in(env, "rival@example.org"),
                "admin": lambda: signed_in(env, "admin@example.org", professional=None, admin=True),
                "anonymous": lambda: env.client(),
            }[name]()
        return self._actors[name]

    def put_in(self, status: str) -> None:
        set_request_status(self.env.session, self.request_id, status)

    def act(self, actor: str, action: str, **kwargs: Any) -> Any:
        return act_on(self.actor(actor), self.request_id, action, **kwargs)

    @property
    def status(self) -> str:
        return str(stored_request(self.env.session, self.request_id)["status"])

    @property
    def history(self) -> list[tuple[str | None, str, str]]:
        return history_rows(self.env.session, self.request_id)


# -- the whole matrix ----------------------------------------------------------------------------------


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize(
    "actor", ["requester", "provider", "stranger", "other_professional", "admin", "anonymous"]
)
def test_the_transition_matrix(auth_env: AuthEnv, actor: str, action: str, status: str) -> None:
    scene = Scene(auth_env)
    scene.put_in(status)
    history_before = scene.history

    response = scene.act(actor, action)

    want = expected(actor, action, status)
    assert response.status_code == want, response.text
    if want == 200:
        assert scene.status == TARGET[action]
        assert response.json()["data"]["status"] == TARGET[action]
        assert len(scene.history) == len(history_before) + 1
        assert scene.history[-1] == (status, TARGET[action], actor)
    else:
        assert scene.status == status  # a refused action changes nothing
        assert scene.history == history_before  # and writes no history
        assert (
            response.json()["error"]["code"]
            == {
                401: "unauthenticated",
                403: "forbidden",
                404: "not_found",
                409: "invalid_state_transition",
            }[want]
        )


# -- the journeys -------------------------------------------------------------------------------------


def test_the_provider_drives_a_request_to_completion(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    requester, provider = scene.actor("requester"), scene.actor("provider")

    for action, status in (
        ("accept", "accepted"),
        ("start", "in-progress"),
        ("complete", "completed"),
    ):
        response = scene.act("provider", action)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["status"] == status
        assert response.json()["data"]["viewerRole"] == "provider"  # the caller's own view
        assert status_of(requester, scene.request_id) == status  # the requester sees it too
        assert status_of(provider, scene.request_id) == status

    data = detail(requester, scene.request_id)
    assert history_of(data) == [
        (None, "submitted", "requester"),
        ("submitted", "accepted", "provider"),
        ("accepted", "in-progress", "provider"),
        ("in-progress", "completed", "provider"),
    ]


def test_an_action_answers_with_the_callers_own_view(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    response = scene.act("requester", "cancel")

    data = response.json()["data"]
    assert data["status"] == "cancelled" and data["viewerRole"] == "requester"
    assert data["requesterName"] == "Rana Resident"
    assert history_of(data)[-1] == ("submitted", "cancelled", "requester")


def test_the_requester_can_cancel_while_submitted(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    assert scene.act("requester", "cancel").status_code == 200

    assert scene.status == "cancelled"
    assert scene.history == [
        (None, "submitted", "requester"),
        ("submitted", "cancelled", "requester"),
    ]


def test_the_requester_can_cancel_after_the_provider_accepted(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    assert scene.act("provider", "accept").status_code == 200

    assert scene.act("requester", "cancel").status_code == 200

    assert scene.status == "cancelled"
    assert scene.history[-1] == ("accepted", "cancelled", "requester")


def test_the_requester_can_not_cancel_once_work_has_started(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    scene.act("provider", "accept")
    scene.act("provider", "start")

    response = scene.act("requester", "cancel")

    assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")
    assert scene.status == "in-progress"


def test_the_provider_may_cancel_work_in_progress(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    scene.act("provider", "accept")
    scene.act("provider", "start")

    assert scene.act("provider", "cancel").status_code == 200

    assert scene.status == "cancelled"
    assert scene.history[-1] == ("in-progress", "cancelled", "provider")


@pytest.mark.parametrize("terminal", ["completed", "cancelled"])
@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("actor", ["requester", "provider"])
def test_completed_and_cancelled_are_final(
    auth_env: AuthEnv, terminal: str, action: str, actor: str
) -> None:
    scene = Scene(auth_env)
    scene.put_in(terminal)

    response = scene.act(actor, action)

    # the requester has no authority over accept/start/complete at all (403); everything else 409
    want = 403 if (action, actor) not in ALLOWED else 409
    assert response.status_code == want
    assert scene.status == terminal


@pytest.mark.parametrize("action", ["accept", "start", "complete", "cancel"])
def test_repeating_an_action_is_a_conflict_and_changes_nothing(
    auth_env: AuthEnv, action: str
) -> None:
    scene = Scene(auth_env)
    scene.put_in(
        {
            "accept": "submitted",
            "start": "accepted",
            "complete": "in-progress",
            "cancel": "submitted",
        }[action]
    )
    assert scene.act("provider", action).status_code == 200
    history_after_first = scene.history

    again = scene.act("provider", action)

    assert (again.status_code, error_code(again)) == (409, "invalid_state_transition")
    assert scene.history == history_after_first


def test_a_step_cannot_be_skipped(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    for action in ("start", "complete"):  # straight from submitted
        assert scene.act("provider", action).status_code == 409
    assert scene.status == "submitted"
    scene.act("provider", "accept")
    assert scene.act("provider", "complete").status_code == 409  # straight from accepted
    assert scene.status == "accepted"


# -- authority ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("action", ["accept", "start", "complete"])
def test_the_requester_has_no_authority_over_provider_actions(
    auth_env: AuthEnv, action: str
) -> None:
    scene = Scene(auth_env)
    scene.put_in({"accept": "submitted", "start": "accepted", "complete": "in-progress"}[action])

    response = scene.act("requester", action)

    assert (response.status_code, error_code(response)) == (403, "forbidden")
    assert (
        scene.status
        == {"accept": "submitted", "start": "accepted", "complete": "in-progress"}[action]
    )


def test_only_the_owner_of_the_target_listing_is_the_provider(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    rival = scene.actor("other_professional")
    # the rival even owns an approved provider listing of their own: still not this request's provider
    assert rival.get("/users/me/listings").status_code == 200

    for action in ACTIONS:
        assert act_on(rival, scene.request_id, action).status_code == 404
    assert scene.status == "submitted"


def test_the_provider_is_whoever_owns_the_listing_not_whoever_the_request_names(
    auth_env: AuthEnv,
) -> None:
    w = world(auth_env)
    second_listing_owner = provider_signed_in(auth_env, "second@example.org")
    from tests.db.request_helpers import approved_provider

    second_listing = approved_provider(auth_env, second_listing_owner, name="Second Provider Co")
    first = sent_id(w.resident, w.listing_id)
    second = sent_id(w.resident, second_listing)

    assert act_on(w.owner, second, "accept").status_code == 404  # not their listing
    assert act_on(second_listing_owner, first, "accept").status_code == 404
    assert act_on(w.owner, first, "accept").status_code == 200
    assert act_on(second_listing_owner, second, "accept").status_code == 200


def test_admin_has_no_request_surface(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    admin = scene.actor("admin")

    assert admin.get(f"{REQUESTS}/{scene.request_id}").status_code == 404
    assert admin.get(REQUESTS).json()["data"] == []
    for action in ACTIONS:
        assert act_on(admin, scene.request_id, action).status_code == 404
    assert scene.status == "submitted"


# -- concealment --------------------------------------------------------------------------------------


def test_a_non_party_cannot_tell_a_real_request_from_a_missing_one(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    missing = new_id()

    def bodies(request_id: str, actor: str) -> list[Any]:
        api = scene.actor(actor)
        calls = [api.get(f"{REQUESTS}/{request_id}")]
        calls += [act_on(api, request_id, action) for action in ACTIONS]
        out = []
        for response in calls:
            error = dict(response.json()["error"])
            error.pop("requestId")
            out.append({"status": response.status_code, **error})
        return out

    for actor in ("stranger", "other_professional", "admin"):
        assert bodies(scene.request_id, actor) == bodies(missing, actor)
    assert scene.status == "submitted"


@pytest.mark.parametrize("bad", ["not-a-uuid", "123", "00000000-0000-0000-0000-000000000000"])
def test_a_malformed_or_unknown_id_is_a_plain_404(auth_env: AuthEnv, bad: str) -> None:
    scene = Scene(auth_env)

    assert scene.actor("requester").get(f"{REQUESTS}/{bad}").status_code == 404
    for action in ACTIONS:
        response = act_on(scene.actor("provider"), bad, action)
        assert (response.status_code, error_code(response)) == (404, "not_found")


# -- the body of an action ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "field", ["status", "revision", "reason", "actorRole", "requesterId", "to"]
)
def test_an_action_accepts_no_body_fields(auth_env: AuthEnv, field: str) -> None:
    scene = Scene(auth_env)

    response = scene.act("provider", "accept", json={field: "completed"})

    assert response.status_code == 422
    assert (field, "not_allowed") in [
        (d["field"], d["code"]) for d in response.json()["error"]["details"]
    ]
    assert scene.status == "submitted"


def test_an_empty_object_or_no_body_is_fine(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    assert scene.act("provider", "accept", json={}).status_code == 200
    assert scene.act("provider", "start").status_code == 200


def test_a_non_object_body_is_rejected(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    bodies: list[Any] = [[], "accepted", 5]
    for body in bodies:
        assert scene.act("provider", "accept", json=body).status_code == 422
    assert scene.status == "submitted"


# -- the target listing's own life does not govern an existing request ---------------------------------


@pytest.mark.parametrize(
    "status", [ListingStatus.REJECTED, ListingStatus.ARCHIVED, ListingStatus.PENDING]
)
def test_a_request_keeps_working_after_its_listing_is_taken_down_or_archived(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    scene = Scene(auth_env)
    set_status(auth_env.session, scene.w.listing_id, status)

    assert scene.act("provider", "accept").status_code == 200  # the provider can still progress it
    assert scene.act("requester", "cancel").status_code == 200  # and the requester can still cancel
    assert scene.status == "cancelled"
    data = detail(scene.actor("requester"), scene.request_id)
    assert data["providerName"] == "Bright Spark Electricians"


def test_the_requests_of_other_users_are_untouched_by_an_action(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    other = requester_signed_in(auth_env, "other@example.org")
    mine = sent_id(w.resident, w.listing_id)
    theirs = sent_id(other, w.listing_id)

    assert act_on(w.owner, mine, "accept").status_code == 200

    assert status_of(other, theirs) == "submitted"
    assert request_count(auth_env.session) == 2
