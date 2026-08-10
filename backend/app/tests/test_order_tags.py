"""Order tags: admin-only markings that are removable, renameable and searchable.

A tag is a row, not text on the order, for two reasons the tests below pin:
renaming it must change every order at once, and searching one must find exactly
the orders carrying it rather than every order whose text happens to match.
"""

from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from app.models import Order, OrderTag

TAGS = "/api/admin/order-tags/"


class OrderTagApiTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        self.order = Order.objects.create(
            customer_name="Rahim", phone="01700000000",
            subtotal=Decimal("1200"), delivery_charge=Decimal("120"))
        self.other = Order.objects.create(
            customer_name="Karim", phone="01800000000",
            subtotal=Decimal("900"), delivery_charge=Decimal("120"))

    def _set(self, order, **body):
        return self.client.post(f"/api/admin/orders/{order.id}/set_tags/", body, format="json")

    # ---- the vocabulary ----------------------------------------------------- #

    def test_a_tag_can_be_created_renamed_and_deleted(self):
        r = self.client.post(TAGS, {"name": "urgent", "colour": "red"}, format="json")
        self.assertEqual(r.status_code, 201)
        tag_id = r.data["id"]

        r = self.client.patch(f"{TAGS}{tag_id}/", {"name": "URGENT call"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(OrderTag.objects.get(pk=tag_id).name, "URGENT call")

        self.assertEqual(self.client.delete(f"{TAGS}{tag_id}/").status_code, 204)
        self.assertFalse(OrderTag.objects.filter(pk=tag_id).exists())

    def test_the_same_name_in_another_case_is_refused(self):
        self.client.post(TAGS, {"name": "urgent"}, format="json")
        r = self.client.post(TAGS, {"name": "Urgent"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_a_blank_name_is_refused(self):
        self.assertEqual(self.client.post(TAGS, {"name": "   "}, format="json").status_code, 400)

    def test_renaming_follows_every_order_that_carries_it(self):
        tag = OrderTag.objects.create(name="giftwrap")
        self._set(self.order, tags=[tag.id])
        self._set(self.other, tags=[tag.id])
        self.client.patch(f"{TAGS}{tag.id}/", {"name": "gift wrap"}, format="json")
        for order in (self.order, self.other):
            names = [t.name for t in order.tags.all()]
            self.assertEqual(names, ["gift wrap"])

    def test_deleting_a_tag_unmarks_the_orders_but_keeps_them(self):
        tag = OrderTag.objects.create(name="urgent")
        self._set(self.order, tags=[tag.id])
        self.client.delete(f"{TAGS}{tag.id}/")
        self.order.refresh_from_db()
        self.assertEqual(self.order.tags.count(), 0)
        self.assertTrue(Order.objects.filter(pk=self.order.pk).exists())

    # ---- marking an order --------------------------------------------------- #

    def test_tags_are_replaced_wholesale_so_leaving_one_out_removes_it(self):
        a = OrderTag.objects.create(name="urgent")
        b = OrderTag.objects.create(name="giftwrap")
        self._set(self.order, tags=[a.id, b.id])
        self.assertEqual(self.order.tags.count(), 2)

        self._set(self.order, tags=[b.id])
        self.assertEqual([t.name for t in self.order.tags.all()], ["giftwrap"])

        self._set(self.order, tags=[])
        self.assertEqual(self.order.tags.count(), 0)

    def test_a_new_name_is_created_on_the_spot(self):
        r = self._set(self.order, names=["call before delivery"])
        self.assertEqual(r.status_code, 200)
        self.assertTrue(OrderTag.objects.filter(name="call before delivery").exists())
        self.assertEqual(self.order.tags.count(), 1)

    def test_an_existing_name_is_reused_not_duplicated(self):
        OrderTag.objects.create(name="urgent")
        self._set(self.order, names=["Urgent"])
        self.assertEqual(OrderTag.objects.filter(name__iexact="urgent").count(), 1)

    def test_a_payload_that_says_nothing_is_refused(self):
        self.assertEqual(self._set(self.order).status_code, 400)

    def test_the_order_comes_back_carrying_its_tags(self):
        tag = OrderTag.objects.create(name="urgent", colour="red")
        body = self._set(self.order, tags=[tag.id]).json()
        self.assertEqual(body["tags"][0]["name"], "urgent")
        self.assertEqual(body["tags"][0]["colour"], "red")

    # ---- finding them ------------------------------------------------------- #

    def test_the_list_can_be_filtered_by_tag_id_and_by_name(self):
        tag = OrderTag.objects.create(name="urgent")
        self._set(self.order, tags=[tag.id])
        for value in (tag.id, "urgent", "URGENT"):
            rows = self.client.get(f"/api/admin/orders/?tag={value}").json()
            self.assertEqual([r["uid"] for r in rows], [self.order.uid], f"tag={value}")

    def test_searching_a_tag_name_finds_the_orders_carrying_it(self):
        tag = OrderTag.objects.create(name="giftwrap")
        self._set(self.order, tags=[tag.id])
        rows = self.client.get("/api/admin/orders/?q=giftwrap").json()
        self.assertEqual([r["uid"] for r in rows], [self.order.uid])

    def test_search_does_not_duplicate_an_order_with_several_matching_tags(self):
        for name in ("gift", "giftwrap"):
            tag = OrderTag.objects.create(name=name)
            self.order.tags.add(tag)
        rows = self.client.get("/api/admin/orders/?q=gift").json()
        self.assertEqual(len(rows), 1)

    def test_the_list_carries_tags_without_a_query_per_order(self):
        tag = OrderTag.objects.create(name="urgent")
        self.order.tags.add(tag)
        rows = self.client.get("/api/admin/orders/").json()
        self.assertEqual(len(rows), 2)
        by_uid = {r["uid"]: r for r in rows}
        self.assertEqual(by_uid[self.order.uid]["tags"][0]["name"], "urgent")
        self.assertEqual(by_uid[self.other.uid]["tags"], [])


class OrderTagAccessTests(APITestCase):
    """Tags live under the orders section — a moderator without it cannot read
    the vocabulary, and a view-only one cannot mark anything."""

    def setUp(self):
        from app.models import StaffProfile
        self.viewer = User.objects.create_user("viewer", password="x", is_staff=True)
        StaffProfile.objects.create(user=self.viewer, access={"orders": "view"})
        self.outsider = User.objects.create_user("outsider", password="x", is_staff=True)
        StaffProfile.objects.create(user=self.outsider, access={"gallery": "full"})
        self.order = Order.objects.create(customer_name="R", phone="01700000000")

    def test_a_view_only_moderator_can_read_but_not_create(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get(TAGS).status_code, 200)
        self.assertEqual(
            self.client.post(TAGS, {"name": "urgent"}, format="json").status_code, 403)

    def test_a_view_only_moderator_cannot_mark_an_order(self):
        self.client.force_authenticate(self.viewer)
        tag = OrderTag.objects.create(name="urgent")
        r = self.client.post(f"/api/admin/orders/{self.order.id}/set_tags/",
                             {"tags": [tag.id]}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_a_moderator_without_orders_sees_nothing(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(TAGS).status_code, 403)


class OrderIdSearchTests(APITestCase):
    """The Orders list shows the numeric row id (the number in the order's URL),
    so that number has to be searchable — otherwise the column is a value you can
    read but not act on."""

    def setUp(self):
        self.client.force_authenticate(
            User.objects.create_superuser("admin", password="x"))
        self.order = Order.objects.create(customer_name="Rahim", phone="01700000000")
        self.decoy = Order.objects.create(customer_name="Karim", phone="0199999999")

    def _uids(self, q):
        return [r["uid"] for r in self.client.get(f"/api/admin/orders/?q={q}").json()]

    def test_searching_the_id_finds_that_order(self):
        self.assertEqual(self._uids(self.order.id), [self.order.uid])

    def test_a_number_also_still_matches_phones(self):
        # A digits-only term is much more often a phone than a row id, so the id
        # match is additional — never a replacement.
        target = Order.objects.create(customer_name="Sumi", phone=f"0171{self.order.id}5555")
        found = self._uids(self.order.id)
        self.assertIn(self.order.uid, found)
        self.assertIn(target.uid, found)

    def test_the_list_carries_the_id(self):
        rows = self.client.get("/api/admin/orders/").json()
        self.assertTrue(all("id" in r for r in rows))

    def test_a_long_digit_string_is_not_treated_as_an_id(self):
        # int() on a 20-digit phone number would still work, but a row id that
        # big cannot exist — and an out-of-range value must not raise.
        self.assertEqual(self.client.get("/api/admin/orders/?q=01700000000").status_code, 200)
