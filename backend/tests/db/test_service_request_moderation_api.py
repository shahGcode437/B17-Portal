"""Saved items and service requests meet Admin moderation (Phase 12F x 12E), through the real
Admin API.

Policy under test:

* a taken-down (or otherwise non-approved) listing disappears from every Saved list without a trace
  — nothing about it leaks — but its saved row is kept, so it reappears if it is approved again;
* an EXISTING request is never cancelled, hidden or altered by a takedown, an archive or an owner
  edit: both parties can still read it and keep working it;
* a NEW request (or save) needs the listing to be approved at that moment.
"""

from tests.db.admin_helpers import admin_signed_in, approve, reject
from tests.db.auth_helpers import AuthEnv
from tests.db.request_helpers import (
    LEADS,
    REQUESTS,
    SAVED,
    act,
    detail,
    error_code,
    provider_signed_in,
    request_count,
    requester_signed_in,
    saved_ids,
    saved_rows,
    send,
    sent_id,
)
from tests.db.write_helpers import created_id, patch
from tests.write_payloads import provider_body

NAME = "Moderated Wiring Services"


class Scene:
    """A provider listing taken through the REAL moderation API, an admin and two residents."""

    def __init__(self, env: AuthEnv) -> None:
        self.env = env
        self.owner = provider_signed_in(env)
        self.admin = admin_signed_in(env)
        self.resident = requester_signed_in(env)
        self.other = requester_signed_in(env, "other@example.org")
        self.listing_id = created_id(self.owner, provider_body(name=NAME))
        assert approve(self.admin, self.listing_id, 1).status_code == 200

    def take_down(self) -> None:
        response = reject(self.admin, self.listing_id, 1, reason="Reported as closed for good.")
        assert response.status_code == 200, response.text

    def resubmit_and_reapprove(self, revision: int = 1) -> None:
        edited = patch(self.owner, self.listing_id, revision, name="Moderated Wiring Services Ltd")
        assert edited.status_code == 200, edited.text
        new_revision = edited.json()["data"]["revision"]
        assert approve(self.admin, self.listing_id, new_revision).status_code == 200


# -- Saved x moderation ------------------------------------------------------------------------------


def test_a_taken_down_saved_listing_vanishes_without_a_trace_and_returns_when_re_approved(
    auth_env: AuthEnv,
) -> None:
    s = Scene(auth_env)
    assert s.resident.request("PUT", f"{SAVED}/{s.listing_id}").status_code == 204
    assert saved_ids(s.resident) == [s.listing_id]

    s.take_down()

    body = s.resident.get(SAVED)
    assert body.json() == {"data": [], "meta": {"total": 0, "limit": 12, "offset": 0}}
    for trace in (s.listing_id, NAME, "closed", "rejected", "takedown"):
        assert trace not in body.text, trace
    assert saved_rows(auth_env.session, "resident@example.org") == [s.listing_id]  # row kept

    s.resubmit_and_reapprove()

    assert saved_ids(s.resident) == [s.listing_id]  # back, as the (renamed) approved listing
    assert (
        s.resident.get(SAVED).json()["data"][0]["item"]["name"] == "Moderated Wiring Services Ltd"
    )


def test_a_taken_down_listing_can_not_be_saved_until_it_is_approved_again(
    auth_env: AuthEnv,
) -> None:
    s = Scene(auth_env)
    s.take_down()

    refused = s.other.request("PUT", f"{SAVED}/{s.listing_id}")
    assert (refused.status_code, error_code(refused)) == (404, "not_found")

    s.resubmit_and_reapprove()
    assert s.other.request("PUT", f"{SAVED}/{s.listing_id}").status_code == 204


def test_an_owner_edit_pulls_a_saved_listing_until_the_edit_is_approved(auth_env: AuthEnv) -> None:
    s = Scene(auth_env)
    s.resident.request("PUT", f"{SAVED}/{s.listing_id}")

    assert patch(s.owner, s.listing_id, 1, name="Edited Before Review").status_code == 200

    assert saved_ids(s.resident) == []  # pending again: not public, so not shown
    assert saved_rows(auth_env.session, "resident@example.org") == [s.listing_id]
    assert approve(s.admin, s.listing_id, 2).status_code == 200
    assert saved_ids(s.resident) == [s.listing_id]


def test_unsaving_works_while_the_listing_is_down(auth_env: AuthEnv) -> None:
    s = Scene(auth_env)
    s.resident.request("PUT", f"{SAVED}/{s.listing_id}")
    s.take_down()

    assert s.resident.request("DELETE", f"{SAVED}/{s.listing_id}").status_code == 204

    s.resubmit_and_reapprove()
    assert saved_ids(s.resident) == []  # it was removed on purpose, so it does not come back


# -- requests x moderation ---------------------------------------------------------------------------


def test_an_existing_request_survives_a_takedown_and_both_parties_keep_working_it(
    auth_env: AuthEnv,
) -> None:
    s = Scene(auth_env)
    request_id = sent_id(s.resident, s.listing_id)

    s.take_down()

    for api in (s.resident, s.owner):
        data = detail(api, request_id)
        assert data["status"] == "submitted" and data["providerName"] == NAME
    assert [r["id"] for r in s.resident.get(REQUESTS).json()["data"]] == [request_id]
    assert [r["id"] for r in s.owner.get(LEADS).json()["data"]] == [request_id]
    # it is not cancelled for them, and it can still be progressed
    assert act(s.owner, request_id, "accept").status_code == 200
    assert act(s.resident, request_id, "cancel").status_code == 200
    assert detail(s.resident, request_id)["status"] == "cancelled"


def test_no_new_request_can_be_created_while_the_listing_is_down(auth_env: AuthEnv) -> None:
    s = Scene(auth_env)
    existing = sent_id(s.resident, s.listing_id)
    s.take_down()
    before = request_count(auth_env.session)

    refused = send(s.other, s.listing_id)
    again = send(s.resident, s.listing_id)

    assert (refused.status_code, error_code(refused)) == (404, "not_found")
    # the requester who already asked today meets the per-provider limit first (limits are
    # checked before eligibility, as for listing creates): either way nothing is created
    assert again.status_code == 429
    assert request_count(auth_env.session) == before
    assert detail(s.resident, existing)["status"] == "submitted"


def test_requests_open_up_again_when_the_listing_is_re_approved(auth_env: AuthEnv) -> None:
    s = Scene(auth_env)
    s.take_down()
    assert send(s.other, s.listing_id).status_code == 404

    s.resubmit_and_reapprove()

    assert send(s.other, s.listing_id).status_code == 201


def test_a_request_made_while_the_listing_was_approved_is_unaffected_by_an_owner_rename(
    auth_env: AuthEnv,
) -> None:
    s = Scene(auth_env)
    request_id = sent_id(s.resident, s.listing_id)

    s.resubmit_and_reapprove()  # renamed and re-approved

    data = detail(s.resident, request_id)
    assert data["providerName"] == NAME  # the snapshot, not the new name
    assert data["providerListingId"] == s.listing_id


def test_the_audit_trail_of_a_request_is_independent_of_moderation(auth_env: AuthEnv) -> None:
    s = Scene(auth_env)
    request_id = sent_id(s.resident, s.listing_id)
    act(s.owner, request_id, "accept")

    s.take_down()
    act(s.owner, request_id, "start")

    history = [(h.get("fromStatus"), h["toStatus"]) for h in detail(s.owner, request_id)["history"]]
    assert history == [(None, "submitted"), ("submitted", "accepted"), ("accepted", "in-progress")]
