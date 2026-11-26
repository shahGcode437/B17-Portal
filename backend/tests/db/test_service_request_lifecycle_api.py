"""The service-request lifecycle against real PostgreSQL (Phase 12F; API_CONTRACT.md §13, RBAC-D §16).

    submitted -> accepted -> in-progress -> completed            (provider: accept, start, complete)
    submitted | accepted | in-progress -> cancelled              (provider: cancel / decline)
    submitted | accepted -> cancelled                            (requester: cancel)

Since RBAC-D a Provider is portal-managed and has no owner, so a request to it is a PORTAL request:
the REQUESTER drives their side through ``/requests`` and the PROVIDER side is handled by portal
staff — a Super Admin, or a Moderator with the ``services`` scope — through ``/admin/requests``. The
state machine is unchanged and written out independently of the implementation: for every (actor,
action, current status) it says what MUST happen.

* on the requester's API a non-requester is a non-party: the concealing ``404`` (staff included);
* on the portal API a non-staff caller is ``403``, a Moderator without ``services`` gets the same
  ``404`` as for a missing request, and staff with authority get ``403`` for an action the provider
  side never has (none exists) or ``409 invalid_state_transition`` for the wrong status.
"""

from typing import Any

import pytest

from app.models.enums import PlanCode, StaffScope
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.request_helpers import (
    ACTIONS,
    PORTAL_REQUESTS,
    REQUESTS,
    World,
    detail,
    error_code,
    history_of,
    history_rows,
    requester_signed_in,
    sent_id,
    set_request_status,
    staff_act,
    staff_detail,
    status_of,
    stored_request,
    world,
)
from tests.db.request_helpers import act as act_on
from tests.db.write_helpers import signed_in

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

#: actor -> (the API they call, the role they act in when authorised)
ACTORS: dict[str, tuple[str, str]] = {
    "requester": ("requester_api", "requester"),
    "super_admin": ("portal_api", "provider"),
    "services_moderator": ("portal_api", "provider"),
    "directory_moderator": ("portal_api", ""),
    "professional": ("portal_api", ""),
    "stranger": ("portal_api", ""),
    "stranger_on_requester_api": ("requester_api", ""),
    "super_admin_on_requester_api": ("requester_api", ""),
    "services_moderator_on_requester_api": ("requester_api", ""),
    "anonymous": ("portal_api", ""),
}


def expected(actor: str, action: str, status: str) -> int:
    """The HTTP status the frozen design demands."""
    api, role = ACTORS[actor]
    if actor == "anonymous":
        return 401
    if api == "requester_api":
        if role == "":
            return 404  # not the requester: indistinguishable from "no such request"
    elif role == "":
        # the portal API: a Moderator without ``services`` is concealed; everyone else is no staff
        return 404 if actor == "directory_moderator" else 403
    if (action, role) not in ALLOWED:
        return 403  # authorised, but this action is not theirs
    return 200 if status in ALLOWED[(action, role)] else 409


class Scene:
    """A request, the requester, and every kind of actor (signed in on first use: a login costs
    time and most tests need only a few of them)."""

    def __init__(self, env: AuthEnv) -> None:
        self.env = env
        self.w: World = world(env)
        self.request_id = sent_id(self.w.resident, self.w.listing_id)
        self._actors: dict[str, AuthApi] = {
            "requester": self.w.resident,
            "super_admin": self.w.author,
        }

    def actor(self, name: str) -> AuthApi:
        if name not in self._actors:
            env = self.env
            plain = name.removesuffix("_on_requester_api")
            self._actors[name] = {
                "services_moderator": lambda: moderator(env, "mod-services", StaffScope.SERVICES),
                "directory_moderator": lambda: moderator(
                    env, "mod-directory", StaffScope.DIRECTORY
                ),
                "professional": lambda: signed_in(
                    env, "rival@example.org", professional=PlanCode.PREMIUM, display_name="Riv Al"
                ),
                "stranger": lambda: requester_signed_in(env, "stranger@example.org"),
                "super_admin": lambda: self.w.author,
                "anonymous": lambda: env.client(),
            }[plain]()
        return self._actors[name]

    def put_in(self, status: str) -> None:
        set_request_status(self.env.session, self.request_id, status)

    def act(self, actor: str, action: str, **kwargs: Any) -> Any:
        api = self.actor(actor)
        if ACTORS[actor][0] == "portal_api":
            return staff_act(api, self.request_id, action, **kwargs)
        return act_on(api, self.request_id, action, **kwargs)

    @property
    def status(self) -> str:
        return str(stored_request(self.env.session, self.request_id)["status"])

    @property
    def history(self) -> list[tuple[str | None, str, str]]:
        return history_rows(self.env.session, self.request_id)


def moderator(env: AuthEnv, name: str, scope: StaffScope) -> AuthApi:
    email = f"{name}@example.org"
    make_account(env.session, email, moderator_scopes=[scope], display_name=name)
    api = env.client()
    assert api.login(email).status_code == 200
    return api


# -- the whole matrix ----------------------------------------------------------------------------------


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("actor", list(ACTORS))
def test_the_transition_matrix(auth_env: AuthEnv, actor: str, action: str, status: str) -> None:
    scene = Scene(auth_env)
    scene.put_in(status)
    history_before = scene.history

    response = scene.act(actor, action)

    want = expected(actor, action, status)
    assert response.status_code == want, response.text
    if want == 200:
        role = ACTORS[actor][1]
        assert scene.status == TARGET[action]
        assert response.json()["data"]["status"] == TARGET[action]
        assert len(scene.history) == len(history_before) + 1
        assert scene.history[-1] == (status, TARGET[action], role)
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


def test_the_portal_drives_a_request_to_completion(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    requester = scene.actor("requester")

    # two DIFFERENT staff members take turns: the request belongs to the portal, not to a person
    steps = (
        ("super_admin", "accept", "accepted"),
        ("services_moderator", "start", "in-progress"),
        ("super_admin", "complete", "completed"),
    )
    for actor, action, status in steps:
        response = scene.act(actor, action)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["status"] == status
        assert response.json()["data"]["viewerRole"] == "provider"  # the portal's own view
        assert status_of(requester, scene.request_id) == status  # the requester sees it too
        assert staff_detail(scene.actor(actor), scene.request_id)["status"] == status

    data = detail(requester, scene.request_id)
    assert data["viewerRole"] == "requester"
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


def test_the_requester_can_cancel_after_the_portal_accepted(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    assert scene.act("super_admin", "accept").status_code == 200

    assert scene.act("requester", "cancel").status_code == 200

    assert scene.status == "cancelled"
    assert scene.history[-1] == ("accepted", "cancelled", "requester")


def test_the_requester_can_not_cancel_once_work_has_started(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    scene.act("super_admin", "accept")
    scene.act("super_admin", "start")

    response = scene.act("requester", "cancel")

    assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")
    assert scene.status == "in-progress"


def test_the_portal_may_cancel_work_in_progress(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    scene.act("super_admin", "accept")
    scene.act("super_admin", "start")

    assert scene.act("services_moderator", "cancel").status_code == 200

    assert scene.status == "cancelled"
    assert scene.history[-1] == ("in-progress", "cancelled", "provider")


def test_the_portal_can_decline_a_request_it_does_not_want(auth_env: AuthEnv) -> None:
    """There is no separate "reject": declining is the provider-side cancel from ``submitted``, and
    the requester sees a plain ``cancelled`` — the existing state machine, unchanged."""
    scene = Scene(auth_env)

    assert scene.act("services_moderator", "cancel").status_code == 200

    assert scene.status == "cancelled"
    assert scene.history == [
        (None, "submitted", "requester"),
        ("submitted", "cancelled", "provider"),
    ]


@pytest.mark.parametrize("terminal", ["completed", "cancelled"])
@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("actor", ["requester", "super_admin", "services_moderator"])
def test_completed_and_cancelled_are_final(
    auth_env: AuthEnv, terminal: str, action: str, actor: str
) -> None:
    scene = Scene(auth_env)
    scene.put_in(terminal)

    response = scene.act(actor, action)

    # the requester has no authority over accept/start/complete at all (403); everything else 409
    role = ACTORS[actor][1]
    want = 403 if (action, role) not in ALLOWED else 409
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
    assert scene.act("super_admin", action).status_code == 200
    history_after_first = scene.history

    again = scene.act("services_moderator", action)

    assert (again.status_code, error_code(again)) == (409, "invalid_state_transition")
    assert scene.history == history_after_first


def test_a_step_cannot_be_skipped(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    for action in ("start", "complete"):  # straight from submitted
        assert scene.act("super_admin", action).status_code == 409
    assert scene.status == "submitted"
    scene.act("super_admin", "accept")
    assert scene.act("super_admin", "complete").status_code == 409  # straight from accepted
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


def test_a_requester_who_is_also_staff_still_has_only_the_requesters_authority(
    auth_env: AuthEnv,
) -> None:
    """The author of the Provider requests a service from it (nothing forbids that: there is no
    owner to be "requesting their own listing"). On the requester's API they are the requester and
    nothing more; handling the request is a separate, deliberate act on the portal API."""
    w = world(auth_env)
    request_id = sent_id(w.author, w.listing_id)

    assert act_on(w.author, request_id, "accept").status_code == 403  # as the requester
    assert staff_act(w.author, request_id, "accept").status_code == 200  # as portal staff
    assert history_rows(auth_env.session, request_id)[-1] == ("submitted", "accepted", "provider")


def test_no_personal_account_is_the_provider_of_a_request(auth_env: AuthEnv) -> None:
    """A professional — even one who owns listings of their own — is not "the provider" of
    anything: there is no personal recipient. On the portal API they are not staff (``403``); on the
    requester's API they are a non-party (``404``)."""
    scene = Scene(auth_env)
    rival = scene.actor("professional")
    assert rival.get("/users/me/listings").status_code == 200

    for action in ACTIONS:
        assert staff_act(rival, scene.request_id, action).status_code == 403
        assert act_on(rival, scene.request_id, action).status_code == 404
    assert scene.status == "submitted"
    assert rival.get(f"{REQUESTS}/{scene.request_id}").status_code == 404
    assert rival.get(f"{PORTAL_REQUESTS}/{scene.request_id}").status_code == 403


def test_one_request_per_provider_the_portal_handles_all_of_them(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    from tests.db.request_helpers import approved_provider

    second_listing = approved_provider(auth_env, w.author, name="Second Provider Co")
    first = sent_id(w.resident, w.listing_id)
    second = sent_id(w.resident, second_listing)
    moderator_api = moderator(auth_env, "mod-services", StaffScope.SERVICES)

    # any staff with services authority handles either request: authority comes from the staff
    # role and scope, never from which Provider was named or who authored it
    assert staff_act(moderator_api, second, "accept").status_code == 200
    assert staff_act(w.author, first, "accept").status_code == 200
    assert status_of(w.resident, first) == status_of(w.resident, second) == "accepted"


def test_staff_have_no_access_through_the_requesters_api(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    admin = scene.actor("super_admin_on_requester_api")

    assert admin.get(f"{REQUESTS}/{scene.request_id}").status_code == 404
    assert admin.get(REQUESTS).json()["data"] == []  # they list only the requests THEY sent
    for action in ACTIONS:
        assert act_on(admin, scene.request_id, action).status_code == 404
    assert scene.status == "submitted"


def test_a_non_party_cannot_tell_a_real_request_from_a_missing_one(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    stranger = scene.actor("stranger_on_requester_api")
    missing = "00000000-0000-4000-8000-000000000000"

    real = [act_on(stranger, scene.request_id, action) for action in ACTIONS]
    absent = [act_on(stranger, missing, action) for action in ACTIONS]

    assert [r.status_code for r in real] == [r.status_code for r in absent] == [404] * 4
    for first, second in zip(real, absent, strict=True):
        assert first.json()["error"]["code"] == second.json()["error"]["code"]
        assert first.json()["error"]["message"] == second.json()["error"]["message"]


@pytest.mark.parametrize("bad", ["not-a-uuid", "123", "00000000-0000-0000-0000-000000000000"])
def test_a_malformed_or_unknown_id_is_a_plain_404(auth_env: AuthEnv, bad: str) -> None:
    scene = Scene(auth_env)

    assert act_on(scene.actor("requester"), bad, "cancel").status_code == 404
    assert staff_act(scene.actor("super_admin"), bad, "accept").status_code == 404
    assert scene.actor("super_admin").get(f"{PORTAL_REQUESTS}/{bad}").status_code == 404


@pytest.mark.parametrize("field", ["status", "requesterId", "providerId", "actorRole", "reason"])
def test_an_action_accepts_no_body_fields(auth_env: AuthEnv, field: str) -> None:
    scene = Scene(auth_env)

    for actor in ("requester", "super_admin"):
        response = scene.act(actor, "cancel", json={field: "x"})
        assert response.status_code == 422, (actor, response.text)
        assert (field, "not_allowed") in [
            (d["field"], d["code"]) for d in response.json()["error"]["details"]
        ]
    assert scene.status == "submitted"


def test_an_empty_object_or_no_body_is_fine(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    assert scene.act("super_admin", "accept", json={}).status_code == 200
    assert scene.act("super_admin", "start").status_code == 200
    assert scene.status == "in-progress"


def test_a_non_object_body_is_rejected(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)

    bodies: tuple[Any, ...] = ([], "text", 1)
    for actor in ("requester", "super_admin"):
        for body in bodies:
            assert scene.act(actor, "cancel", json=body).status_code == 422
    assert scene.status == "submitted"


@pytest.mark.parametrize("fate", ["rejected", "archived"])
def test_a_request_keeps_working_after_its_listing_is_taken_down_or_archived(
    auth_env: AuthEnv, fate: str
) -> None:
    scene = Scene(auth_env)
    from app.models.enums import ListingStatus
    from tests.db.write_helpers import set_status

    set_status(auth_env.session, scene.w.listing_id, ListingStatus(fate))

    assert scene.act("super_admin", "accept").status_code == 200  # the portal still works it
    assert scene.act("requester", "cancel").status_code == 200  # and so does the requester
    assert scene.status == "cancelled"


def test_the_requests_of_other_users_are_untouched_by_an_action(auth_env: AuthEnv) -> None:
    scene = Scene(auth_env)
    other = requester_signed_in(auth_env, "other-resident@example.org")
    other_request = sent_id(other, scene.w.listing_id)

    assert scene.act("super_admin", "accept").status_code == 200

    assert status_of(other, other_request) == "submitted"
    assert str(stored_request(auth_env.session, other_request)["status"]) == "submitted"
