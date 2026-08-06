"""
Admin audit trail.

Two things must hold or the log is worse than useless: it records what actually
happened (including refusals), and it never leaks a secret or breaks the request
it is watching.
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from app.models import AdminAuditLog, Product, StaffProfile
from app.permissions import FULL, VIEW


def client_for(user):
    api = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return api


class AuditWritingTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.api = client_for(self.owner)
        self.product = Product.objects.create(name="Book", kind=Product.Kind.LAYERED)

    def _add_spec(self, label="Red"):
        # A spec row: a plain JSON write with no file upload, so the body is
        # exactly what the audit log should be storing.
        return self.api.post(
            "/api/admin/product-specs/",
            {"product": self.product.id, "label": label, "value": "v", "order": 1},
            format="json",
        )

    def test_a_write_is_recorded_with_who_what_and_the_outcome(self):
        self.assertEqual(self._add_spec().status_code, 201)
        entry = AdminAuditLog.objects.latest("id")
        self.assertEqual(entry.username, "owner")
        self.assertEqual(entry.method, "POST")
        self.assertEqual(entry.section, "products")
        self.assertEqual(entry.status_code, 201)
        self.assertEqual(entry.payload.get("label"), "Red")

    def test_reads_are_not_logged(self):
        AdminAuditLog.objects.all().delete()
        self.api.get("/api/admin/product-specs/")
        self.assertEqual(AdminAuditLog.objects.count(), 0)

    def test_a_refusal_is_logged_too(self):
        mod = User.objects.create_user("mod", password="x", is_staff=True)
        StaffProfile.objects.create(user=mod, access={"products": VIEW})
        AdminAuditLog.objects.all().delete()

        client_for(mod).post("/api/admin/product-specs/",
                             {"product": self.product.id, "label": "X", "value": "v"},
                             format="json")
        entry = AdminAuditLog.objects.latest("id")
        self.assertEqual(entry.username, "mod")
        self.assertEqual(entry.status_code, 403)

    def test_a_password_never_reaches_the_log(self):
        self.api.post(
            "/api/admin/staff/",
            {"username": "newmod", "password": "Str0ng!pass9", "access": {"orders": VIEW}},
            format="json",
        )
        entry = AdminAuditLog.objects.filter(path__contains="staff").latest("id")
        self.assertEqual(entry.payload["password"], "***")
        self.assertEqual(entry.payload["username"], "newmod")

    def test_badge_clearing_is_not_logged_as_a_decision(self):
        AdminAuditLog.objects.all().delete()
        self.api.post("/api/admin/orders/mark_seen/")
        self.assertEqual(AdminAuditLog.objects.count(), 0)

    def test_an_anonymous_request_writes_nothing(self):
        AdminAuditLog.objects.all().delete()
        APIClient().post("/api/admin/product-specs/",
                         {"product": self.product.id, "label": "X", "value": "v"},
                         format="json")
        self.assertEqual(AdminAuditLog.objects.count(), 0)

    def test_the_section_comes_from_the_route_not_the_url_text(self):
        # home-categories/ has no "homepage" in its path; the view declares it.
        self.api.post("/api/admin/home-categories/", {"title": "T"}, format="json")
        entry = AdminAuditLog.objects.latest("id")
        self.assertEqual(entry.section, "homepage")

    def test_a_logging_failure_never_breaks_the_request(self):
        with patch("app.models.AdminAuditLog.objects.create", side_effect=RuntimeError("boom")):
            resp = self._add_spec("Blue")
        self.assertEqual(resp.status_code, 201)      # the write went through anyway


class AuditApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.mod = User.objects.create_user("mod", password="x", is_staff=True)
        StaffProfile.objects.create(user=self.mod, access={"orders": FULL})
        AdminAuditLog.objects.create(username="mod", method="POST",
                                     path="/api/admin/orders/1/set_status/",
                                     section="orders", status_code=200)

    def test_a_moderator_cannot_read_the_audit_log(self):
        self.assertEqual(client_for(self.mod).get("/api/admin/audit-log/").status_code, 403)

    def test_the_owner_can_read_and_filter_it(self):
        api = client_for(self.owner)
        self.assertEqual(api.get("/api/admin/audit-log/").status_code, 200)
        body = api.get("/api/admin/audit-log/?section=orders").json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertTrue(any(r["username"] == "mod" for r in rows))
        empty = api.get("/api/admin/audit-log/?section=gallery").json()
        empty_rows = empty["results"] if isinstance(empty, dict) else empty
        self.assertEqual(empty_rows, [])

    def test_the_trail_cannot_be_edited_or_deleted_even_by_the_owner(self):
        api = client_for(self.owner)
        entry = AdminAuditLog.objects.latest("id")
        self.assertEqual(api.delete(f"/api/admin/audit-log/{entry.id}/").status_code, 405)
        self.assertEqual(
            api.patch(f"/api/admin/audit-log/{entry.id}/", {"username": "x"},
                      format="json").status_code, 405)


class PurgeTests(TestCase):
    def test_purge_removes_only_entries_past_the_window(self):
        from django.core.management import call_command

        old = AdminAuditLog.objects.create(username="a", method="POST", path="/x")
        AdminAuditLog.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timezone.timedelta(days=400))
        fresh = AdminAuditLog.objects.create(username="b", method="POST", path="/y")

        call_command("purge_audit_log", "--days", "180")
        self.assertFalse(AdminAuditLog.objects.filter(pk=old.pk).exists())
        self.assertTrue(AdminAuditLog.objects.filter(pk=fresh.pk).exists())
