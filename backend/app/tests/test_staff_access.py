"""
Moderator access control.

Before this, `is_staff` was root: one check (`IsAdminUser`) guarded the whole
/api/admin/ surface. These tests pin the three rules that replaced it —
section levels, owner-only actions, and (most importantly) that no endpoint
slips through unguarded.

Design: docs/superpowers/specs/2026-08-01-moderator-access-control-design.md
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import get_resolver
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from app.models import StaffProfile
from app.permissions import FULL, GRANTABLE, SECTIONS, VIEW, access_level


def staff(username, access=None, active=True):
    user = User.objects.create_user(username, password="x", is_staff=True, is_active=active)
    StaffProfile.objects.create(user=user, access=access or {})
    return user


def owner(username="owner"):
    return User.objects.create_superuser(username, "o@x.com", "x")


def client_for(user):
    api = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return api


class AccessLevelTests(TestCase):
    def test_staff_without_a_profile_has_nothing(self):
        user = User.objects.create_user("bare", password="x", is_staff=True)
        for section in GRANTABLE:
            self.assertEqual(access_level(user, section), "none")

    def test_owner_bypasses_every_section_including_owner_only(self):
        boss = owner()
        for section in SECTIONS:
            self.assertEqual(access_level(boss, section), FULL)

    def test_an_owner_only_section_cannot_be_granted_by_writing_it_in(self):
        # Even if the JSON says "full", bot/settings/staff are never delegable.
        user = staff("sneaky", {"bot": FULL, "settings": FULL, "staff": FULL})
        for section in ("bot", "settings", "staff"):
            self.assertEqual(access_level(user, section), "none")

    def test_a_junk_level_is_not_access(self):
        user = staff("junk", {"orders": "admin"})
        self.assertEqual(access_level(user, "orders"), "none")

    def test_an_inactive_staff_account_holds_nothing(self):
        user = staff("gone", {"orders": FULL}, active=False)
        self.assertEqual(access_level(user, "orders"), "none")


class SectionEnforcementTests(TestCase):
    """The read/write split, on a representative endpoint per level."""

    def test_no_access_cannot_even_read(self):
        api = client_for(staff("none_user", {"gallery": FULL}))
        self.assertEqual(api.get("/api/admin/products/").status_code, 403)

    def test_view_level_reads_but_cannot_write(self):
        api = client_for(staff("viewer", {"products": VIEW}))
        self.assertEqual(api.get("/api/admin/products/").status_code, 200)
        created = api.post("/api/admin/products/", {"name": "x", "kind": "simple"})
        self.assertEqual(created.status_code, 403)

    def test_full_level_writes(self):
        api = client_for(staff("editor", {"products": FULL}))
        created = api.post(
            "/api/admin/products/",
            {"name": "Test", "kind": "simple", "base_price": "100"},
        )
        self.assertIn(created.status_code, (200, 201))

    def test_products_and_customization_share_one_section(self):
        # Both panel pages drive the same endpoints; granting one grants both.
        api = client_for(staff("cust", {"products": VIEW}))
        self.assertEqual(api.get("/api/admin/colors/").status_code, 200)

    def test_finance_is_grantable_but_off_by_default(self):
        api = client_for(staff("packer", {"orders": FULL}))
        self.assertEqual(api.get("/api/admin/expenses/").status_code, 403)
        api = client_for(staff("accounts", {"finance": VIEW}))
        self.assertEqual(api.get("/api/admin/expenses/").status_code, 200)


class OwnerOnlyTests(TestCase):
    def test_bot_instructions_are_never_reachable_by_a_moderator(self):
        api = client_for(staff("mod1", {section: FULL for section in GRANTABLE}))
        self.assertEqual(api.get("/api/admin/bot-config/").status_code, 403)

    def test_site_settings_are_never_reachable_by_a_moderator(self):
        api = client_for(staff("mod2", {section: FULL for section in GRANTABLE}))
        self.assertEqual(api.get("/api/admin/site-settings/").status_code, 403)

    def test_the_owner_reaches_them(self):
        api = client_for(owner())
        self.assertEqual(api.get("/api/admin/bot-config/").status_code, 200)
        self.assertEqual(api.get("/api/admin/site-settings/").status_code, 200)


class OrderRulesTests(TestCase):
    def setUp(self):
        from app.models import Order
        self.order = Order.objects.create(
            customer_name="A", phone="01711010782", address="x",
            status=Order.Status.IN_REVIEW,
        )

    def test_full_orders_access_still_cannot_delete_an_order(self):
        api = client_for(staff("mod", {"orders": FULL}))
        resp = api.delete(f"/api/admin/orders/{self.order.id}/")
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(type(self.order).objects.filter(pk=self.order.pk).exists())

    def test_the_owner_can_delete_a_deletable_order(self):
        api = client_for(owner())
        resp = api.delete(f"/api/admin/orders/{self.order.id}/")
        self.assertEqual(resp.status_code, 204)

    def test_mark_seen_is_allowed_at_view_level(self):
        # The Orders page fires this on open; a 403 would look like a broken page.
        api = client_for(staff("viewer2", {"orders": VIEW}))
        self.assertEqual(api.post("/api/admin/orders/mark_seen/").status_code, 200)

    def test_a_real_order_write_is_still_refused_at_view_level(self):
        api = client_for(staff("viewer3", {"orders": VIEW}))
        resp = api.post(f"/api/admin/orders/{self.order.id}/verify_payment/")
        self.assertEqual(resp.status_code, 403)


class SharedEndpointTests(TestCase):
    def test_the_badge_poll_scopes_each_counter_to_the_caller(self):
        api = client_for(staff("packer2", {"orders": VIEW}))
        body = api.get("/api/admin/chat-unread/").json()
        self.assertEqual(body["waiting"], 0)      # no chats section
        self.assertEqual(body["unread"], 0)
        self.assertIn("new_orders", body)          # orders section: real number

    def test_the_dashboard_hides_money_from_a_moderator_without_finance(self):
        api = client_for(staff("packer3", {"dashboard": VIEW, "orders": VIEW}))
        body = api.get("/api/admin/dashboard/").json()
        self.assertFalse(body["shows_money"])
        self.assertIsNone(body["month_net"])

    def test_the_dashboard_shows_money_to_the_owner(self):
        body = client_for(owner()).get("/api/admin/dashboard/").json()
        self.assertTrue(body["shows_money"])
        self.assertIsNotNone(body["month_net"])


class IdentityTests(TestCase):
    def test_me_reports_the_access_map_and_owner_flag(self):
        api = client_for(staff("mod3", {"orders": FULL, "gallery": VIEW}))
        body = api.get("/api/admin/me/").json()
        self.assertFalse(body["is_owner"])
        self.assertEqual(body["access"]["orders"], FULL)
        self.assertEqual(body["access"]["gallery"], VIEW)
        self.assertEqual(body["access"]["finance"], "none")
        self.assertNotIn("bot", body["access"])    # owner-only never offered

    def test_login_refuses_an_inactive_staff_account(self):
        user = staff("suspended", {"orders": FULL}, active=False)
        resp = APIClient().post(
            "/api/admin/login/", {"username": user.username, "password": "x"},
        )
        self.assertEqual(resp.status_code, 401)

    def test_login_refuses_a_non_staff_account(self):
        User.objects.create_user("customer", password="x")
        resp = APIClient().post(
            "/api/admin/login/", {"username": "customer", "password": "x"},
        )
        self.assertEqual(resp.status_code, 401)


class NoUnguardedEndpointTests(TestCase):
    """
    The real risk is a FORGOTTEN endpoint, not a wrong rule.

    Walk the URLconf and assert every /api/admin/ route resolves to a view that
    declares a section, is owner-only, or is explicitly open to any staff. A new
    endpoint added without one fails here instead of shipping wide open.
    """

    @staticmethod
    def _admin_views():
        """Every leaf route under /api/admin/, mapped to its view callable."""
        found = {}

        def walk(resolver, prefix=""):
            for entry in resolver.url_patterns:
                path = prefix + str(entry.pattern)
                if hasattr(entry, "url_patterns"):
                    walk(entry, path)
                elif path.startswith("api/admin/"):
                    found[path] = entry.callback

        walk(get_resolver())
        return found

    @staticmethod
    def _guards(view):
        """Permission classes DRF will actually apply to this route."""
        cls = getattr(view, "cls", None) or getattr(view, "view_class", None)
        classes = list(getattr(cls, "permission_classes", []) or [])
        return cls, classes

    def test_every_admin_route_declares_its_guard(self):
        unguarded = []
        for path, view in self._admin_views().items():
            if path.endswith("login/"):
                continue                      # login is the door; it has its own check
            cls, permissions = self._guards(view)
            guarded = any(
                getattr(p, "section", None)
                or getattr(p, "owner_only", False)
                or getattr(p, "any_staff", False)
                for p in permissions
            ) or bool(getattr(cls, "section", None))
            if not guarded:
                unguarded.append(path)
        self.assertEqual(
            unguarded, [],
            "These /api/admin/ routes declare no section, owner_only or any_staff "
            "marker, so SectionPermission would refuse them (or worse, they never "
            "reach it). Give each one a guard:\n  " + "\n  ".join(unguarded),
        )

    def test_the_walker_actually_found_the_admin_routes(self):
        # A guard on the guard: an empty sweep would pass the test above vacuously.
        paths = self._admin_views()
        self.assertGreater(len(paths), 20)
        self.assertTrue(any("orders" in p for p in paths))

    def test_every_section_key_is_used_by_at_least_one_route(self):
        used = set()
        for view in self._admin_views().values():
            cls, permissions = self._guards(view)
            for candidate in [cls, *permissions]:
                section = getattr(candidate, "section", None)
                if section:
                    used.add(section)
        # staff/audit arrive in later phases; everything else must be live now.
        expected = set(SECTIONS) - {"staff", "audit", "bot", "settings"}
        self.assertEqual(expected - used, set())


class PushTargetingTests(TestCase):
    """A packing moderator should not be woken by a chat handoff."""

    def setUp(self):
        from app.models import PushSubscription

        self.boss = owner()
        self.packer = staff("packer_push", {"orders": FULL})
        self.agent = staff("chat_agent", {"chats": FULL})
        for i, user in enumerate([self.boss, self.packer, self.agent]):
            PushSubscription.objects.create(
                endpoint=f"https://push.example/{i}", p256dh="k", auth="a", user=user,
            )
        # A device registered before staff accounts existed.
        PushSubscription.objects.create(
            endpoint="https://push.example/legacy", p256dh="k", auth="a", user=None,
        )

    def _names(self, section):
        from app.services.push import _recipients
        return sorted(
            (sub.user.username if sub.user else "legacy") for sub in _recipients(section)
        )

    def test_an_order_alert_skips_the_chat_only_moderator(self):
        self.assertEqual(self._names("orders"), ["legacy", "owner", "packer_push"])

    def test_a_chat_alert_skips_the_orders_only_moderator(self):
        self.assertEqual(self._names("chats"), ["chat_agent", "legacy", "owner"])

    def test_no_section_still_reaches_everyone(self):
        self.assertEqual(len(self._names(None)), 4)
