"""
Staff management API (owner only).

The tests that matter here are the escalation attempts: this endpoint hands out
power, so every way of asking for more than the owner intended must be refused
server-side, not merely hidden in the UI.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from app.models import StaffProfile
from app.permissions import FULL, VIEW

URL = "/api/admin/staff/"


def client_for(user):
    api = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return api


class StaffApiAccessTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.mod = User.objects.create_user("mod", password="x", is_staff=True)
        StaffProfile.objects.create(user=self.mod, access={"orders": FULL})

    def test_a_moderator_cannot_see_the_staff_list(self):
        self.assertEqual(client_for(self.mod).get(URL).status_code, 403)

    def test_a_moderator_cannot_create_staff(self):
        resp = client_for(self.mod).post(URL, {"username": "x", "password": "Str0ng!pass9"})
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(username="x").exists())

    def test_the_owner_sees_the_list(self):
        self.assertEqual(client_for(self.owner).get(URL).status_code, 200)


class StaffCrudTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.api = client_for(self.owner)

    def _create(self, **over):
        body = {
            "username": "packer", "password": "Str0ng!pass9",
            "note": "packing desk", "access": {"orders": VIEW},
        }
        body.update(over)
        return self.api.post(URL, body, format="json")

    def test_create_makes_a_staff_account_that_is_never_a_superuser(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201)
        user = User.objects.get(username="packer")
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.staff_profile.access, {"orders": VIEW})

    def test_asking_for_superuser_in_the_payload_is_ignored(self):
        self._create(is_superuser=True, is_staff=False)
        user = User.objects.get(username="packer")
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.is_staff)

    def test_an_owner_only_section_cannot_be_granted(self):
        resp = self._create(access={"bot": FULL})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("access", resp.json())

    def test_an_unknown_section_is_rejected(self):
        self.assertEqual(self._create(access={"nonsense": FULL}).status_code, 400)

    def test_an_invalid_level_is_rejected(self):
        self.assertEqual(self._create(access={"orders": "root"}).status_code, 400)

    def test_a_none_level_is_stored_as_absence(self):
        self._create(access={"orders": VIEW, "finance": "none"})
        self.assertEqual(User.objects.get(username="packer").staff_profile.access,
                         {"orders": VIEW})

    def test_a_weak_password_is_refused(self):
        self.assertEqual(self._create(password="123").status_code, 400)

    def test_access_can_be_changed_and_takes_effect_immediately(self):
        self._create()
        user = User.objects.get(username="packer")
        mod_api = client_for(user)
        self.assertEqual(mod_api.get("/api/admin/expenses/").status_code, 403)

        self.api.patch(f"{URL}{user.id}/", {"access": {"finance": VIEW}}, format="json")
        # Same token, no re-login: the level is read from the DB per request.
        self.assertEqual(mod_api.get("/api/admin/expenses/").status_code, 200)
        self.assertEqual(mod_api.get("/api/admin/orders/").status_code, 403)


class StaffGuardTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.other_owner = User.objects.create_superuser("owner2", "o2@x.com", "x")
        self.mod = User.objects.create_user("mod", password="x", is_staff=True)
        StaffProfile.objects.create(user=self.mod, access={"orders": VIEW})
        self.api = client_for(self.owner)

    def test_an_owner_row_cannot_be_edited_through_the_panel(self):
        resp = self.api.patch(f"{URL}{self.other_owner.id}/",
                              {"is_active": False}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.other_owner.refresh_from_db()
        self.assertTrue(self.other_owner.is_active)

    def test_you_cannot_edit_yourself(self):
        resp = self.api.patch(f"{URL}{self.owner.id}/", {"is_active": False}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_an_owner_row_cannot_be_deleted(self):
        self.assertEqual(self.api.delete(f"{URL}{self.other_owner.id}/").status_code, 403)

    def test_deactivating_a_moderator_kills_their_token_now(self):
        mod_api = client_for(self.mod)
        self.assertEqual(mod_api.get("/api/admin/orders/").status_code, 200)

        self.api.patch(f"{URL}{self.mod.id}/", {"is_active": False}, format="json")
        self.assertFalse(Token.objects.filter(user=self.mod).exists())
        self.assertEqual(mod_api.get("/api/admin/orders/").status_code, 401)

    def test_resetting_a_password_kills_the_old_session(self):
        mod_api = client_for(self.mod)
        resp = self.api.post(f"{URL}{self.mod.id}/set_password/",
                             {"password": "An0ther!pass7"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mod_api.get("/api/admin/orders/").status_code, 401)

    def test_deleting_a_moderator_removes_the_account_and_the_token(self):
        self.assertEqual(self.api.delete(f"{URL}{self.mod.id}/").status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.mod.pk).exists())
        self.assertFalse(Token.objects.filter(user_id=self.mod.pk).exists())

    def test_the_section_list_comes_from_the_backend_registry(self):
        body = self.api.get(f"{URL}sections/").json()
        keys = [s["key"] for s in body["sections"]]
        self.assertIn("orders", keys)
        self.assertNotIn("bot", keys)      # owner-only is never offered
        self.assertNotIn("staff", keys)
