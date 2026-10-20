"""The Phase 12F request / response schemas (database-free): strict create body, empty action
body, query models, and responses that cannot carry a secret."""

import datetime
import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app.models.enums import ContactChannel
from app.schemas.requests import (
    ActionRequest,
    LeadSummary,
    RequestsQuery,
    ServiceRequestCreate,
    ServiceRequestDetail,
    ServiceRequestSummary,
)
from app.schemas.saved import SavedQuery

LISTING = str(uuid.uuid4())


def body(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "providerListingId": LISTING,
        "service": "Fix wiring",
        "details": "The kitchen socket sparks when I plug the kettle in.",
        "area": "B-17, Block C",
        "preferredDate": "2026-10-18",
    }
    values.update(overrides)
    return values


def problems(error: ValidationError) -> list[tuple[str, str]]:
    return [(str(item["loc"][0]) if item["loc"] else "", item["type"]) for item in error.errors()]


# -- the create body -----------------------------------------------------------------------------------


def test_a_minimal_body_is_valid_and_defaults_the_channel() -> None:
    parsed = ServiceRequestCreate.model_validate(body())

    assert parsed.provider_listing_id == uuid.UUID(LISTING)
    assert parsed.preferred_date == datetime.date(2026, 10, 18)
    assert parsed.preferred_time is None and parsed.notes is None
    assert parsed.preferred_contact_channel is ContactChannel.IN_APP


def test_a_full_body_is_valid() -> None:
    parsed = ServiceRequestCreate.model_validate(
        body(preferredTime="09:05", notes="Ring twice.", preferredContactChannel="whatsapp")
    )

    assert parsed.preferred_time == "09:05"
    assert parsed.notes == "Ring twice."
    assert parsed.preferred_contact_channel is ContactChannel.WHATSAPP


def test_text_is_trimmed() -> None:
    parsed = ServiceRequestCreate.model_validate(
        body(service="  Fix wiring ", area=" B-17 ", details="  A long enough description. ")
    )

    assert (parsed.service, parsed.area) == ("Fix wiring", "B-17")
    assert parsed.details == "A long enough description."


@pytest.mark.parametrize(
    "field",
    [
        "id", "requesterId", "providerId", "providerUserId", "ownerId", "userId", "status",
        "createdAt", "updatedAt", "acceptedAt", "startedAt", "completedAt", "cancelledAt",
        "requestedBy", "requesterName", "providerName", "viewerRole", "history", "roles",
        "revision", "phone", "contactPhone", "whatsappNumber", "email",
    ],
)  # fmt: skip
def test_any_undeclared_key_is_not_allowed_whatever_its_value(field: str) -> None:
    for value in ("x", None, 5, {"a": 1}, [1]):
        with pytest.raises(ValidationError) as caught:
            ServiceRequestCreate.model_validate(body(**{field: value}))
        assert (field, "not_allowed") in problems(caught.value)


def test_snake_case_names_are_not_accepted() -> None:
    values = body()
    values["provider_listing_id"] = values.pop("providerListingId")

    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(values)

    kinds = problems(caught.value)
    assert ("providerListingId", "missing") in kinds
    assert ("provider_listing_id", "not_allowed") in kinds


def test_not_allowed_never_echoes_the_value() -> None:
    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(body(status="top-secret-value"))

    assert "top-secret-value" not in str(caught.value.errors())


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"service": ""}, "service"),
        ({"service": "x" * 81}, "service"),
        ({"service": "bad\x00"}, "service"),
        ({"details": "short"}, "details"),
        ({"details": "x" * 501}, "details"),
        ({"details": "bell\x07 inside the text"}, "details"),
        ({"area": "B"}, "area"),
        ({"area": "x" * 81}, "area"),
        ({"notes": "x" * 501}, "notes"),
        ({"providerListingId": "nope"}, "providerListingId"),
        ({"providerListingId": None}, "providerListingId"),
        ({"preferredContactChannel": "sms"}, "preferredContactChannel"),
        ({"preferredContactChannel": "WhatsApp"}, "preferredContactChannel"),
        ({"preferredContactChannel": None}, "preferredContactChannel"),
    ],
)
def test_invalid_values_are_reported_on_their_field(overrides: dict[str, Any], field: str) -> None:
    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(body(**overrides))

    assert field in [name for name, _ in problems(caught.value)]


@pytest.mark.parametrize(
    "missing", ["providerListingId", "service", "details", "area", "preferredDate"]
)
def test_required_fields(missing: str) -> None:
    values = body()
    del values[missing]

    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(values)

    assert (missing, "missing") in problems(caught.value)


@pytest.mark.parametrize(
    "value",
    ["2026-10-18T00:00:00", "20261018", "18-10-2026", "2026/10/18", " 2026-10-18", "2026-10-18 ",
     "2026-2-30", "2026-02-30", "2026-13-01", 1760000000, 20261018, True, None, "", [], {}],
)  # fmt: skip
def test_the_date_is_an_iso_calendar_string_only(value: Any) -> None:
    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(body(preferredDate=value))

    assert "preferredDate" in [name for name, _ in problems(caught.value)]


@pytest.mark.parametrize("value", ["2026-10-18", "2028-02-29", "2026-12-31", "0001-01-01"])
def test_valid_calendar_dates(value: str) -> None:
    assert ServiceRequestCreate.model_validate(body(preferredDate=value)).preferred_date


@pytest.mark.parametrize("value", ["00:00", "09:05", "12:30", "23:59"])
def test_valid_clock_times(value: str) -> None:
    assert ServiceRequestCreate.model_validate(body(preferredTime=value)).preferred_time == value


@pytest.mark.parametrize(
    "value", ["24:00", "9:30", "10:60", "10:30:00", "noon", "", " 10:30", "1030", 1030, True]
)
def test_invalid_clock_times(value: Any) -> None:
    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(body(preferredTime=value))

    assert "preferredTime" in [name for name, _ in problems(caught.value)]


@pytest.mark.parametrize("channel", ["in_app", "whatsapp", "phone"])
def test_the_closed_channel_set(channel: str) -> None:
    parsed = ServiceRequestCreate.model_validate(body(preferredContactChannel=channel))

    assert parsed.preferred_contact_channel.value == channel


def test_every_problem_is_collected_in_one_pass() -> None:
    with pytest.raises(ValidationError) as caught:
        ServiceRequestCreate.model_validate(
            body(service="", details="x", area="y", status="accepted")
        )

    names = {name for name, _ in problems(caught.value)}
    assert names == {"service", "details", "area", "status"}


# -- the action body ------------------------------------------------------------------------------------


def test_the_action_body_is_empty() -> None:
    assert ActionRequest.model_validate({}) is not None
    assert ActionRequest.model_fields == {}


@pytest.mark.parametrize("field", ["status", "revision", "reason", "actorRole", "to"])
def test_the_action_body_rejects_everything(field: str) -> None:
    with pytest.raises(ValidationError) as caught:
        ActionRequest.model_validate({field: "completed"})

    assert (field, "not_allowed") in problems(caught.value)


# -- queries ----------------------------------------------------------------------------------------------


def test_query_defaults_and_blank_status() -> None:
    query = RequestsQuery.model_validate({"status": ""})

    assert (query.status, query.limit, query.offset) == (None, 12, 0)
    assert SavedQuery.model_validate({}).limit == 12


@pytest.mark.parametrize(
    "value", ["in-progress", "submitted", "accepted", "completed", "cancelled"]
)
def test_every_status_filters(value: str) -> None:
    assert RequestsQuery.model_validate({"status": value}).status is not None


@pytest.mark.parametrize(
    "values",
    [{"status": "in_progress"}, {"status": "ACCEPTED"}, {"status": "done"}, {"limit": 0},
     {"limit": 51}, {"offset": -1}, {"offset": 100_001}],
)  # fmt: skip
def test_invalid_queries(values: dict[str, Any]) -> None:
    for model in (RequestsQuery, SavedQuery):
        if "status" in values and model is SavedQuery:
            continue
        with pytest.raises(ValidationError):
            model.model_validate(values)


# -- responses cannot carry a secret ----------------------------------------------------------------------

FORBIDDEN = {
    "email", "password", "passwordHash", "token", "csrfToken", "sessionId", "roles", "planCode",
    "ownerId", "requesterId", "providerId", "userId", "actorUserId", "phone", "whatsapp",
    "latitude", "longitude", "address", "landmark", "searchDocument",
}  # fmt: skip


@pytest.mark.parametrize("model", [ServiceRequestSummary, LeadSummary, ServiceRequestDetail])
def test_response_models_describe_no_secret(model: Any) -> None:
    properties = set(model.model_json_schema(by_alias=True)["properties"])

    assert not FORBIDDEN & properties, FORBIDDEN & properties


def test_the_three_shapes_differ_exactly_as_designed() -> None:
    def props(model: Any) -> set[str]:
        return set(model.model_json_schema(by_alias=True)["properties"])

    summary, lead, full = (
        props(ServiceRequestSummary),
        props(LeadSummary),
        props(ServiceRequestDetail),
    )
    assert lead - summary == {"requesterName"}
    assert full - lead == {"viewerRole", "history"}
    assert "requesterName" not in summary and "history" not in lead
    assert summary == {
        "id", "providerListingId", "providerName", "service", "details", "area", "preferredDate",
        "preferredTime", "notes", "preferredContactChannel", "status", "createdAt", "updatedAt",
    }  # fmt: skip
