from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings

from app.models import ExtraConsignment, Order
from app.services import steadfast_order


class ExtraConsignmentModelTests(TestCase):
    def test_row_belongs_to_order(self):
        o = Order.objects.create(customer_name="A", phone="017",
                                 subtotal=Decimal("1000"), delivery_charge=Decimal("80"))
        ec = ExtraConsignment.objects.create(
            order=o, invoice=f"{o.uid}-2", cod_amount=Decimal("500"),
            recipient_name="A", recipient_phone="017",
        )
        self.assertEqual(list(o.extra_consignments.all()), [ec])
        self.assertEqual(ec.cod_amount, Decimal("500"))


class _Resp:
    status_code = 200
    def json(self):
        return {"consignment": {"consignment_id": 99, "tracking_code": "TRK", "status": "in_review"}}


@override_settings(COURIER={"STEADFAST_API_KEY": "k", "STEADFAST_SECRET_KEY": "s", "TIMEOUT_SECONDS": 3})
class CreateConsignmentOverridesTests(TestCase):
    def _order(self):
        return Order.objects.create(customer_name="Real", phone="017111",
                                    subtotal=Decimal("1000"), delivery_charge=Decimal("80"))

    def test_overrides_replace_payload_fields(self):
        o = self._order()
        with patch.object(steadfast_order.requests, "post", return_value=_Resp()) as post:
            steadfast_order.create_consignment(
                o, invoice="X-2",
                overrides={"recipient_name": "Other", "cod_amount": Decimal("250"),
                           "recipient_address": "New addr", "item_description": "Book"},
            )
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["recipient_name"], "Other")
        self.assertEqual(payload["cod_amount"], 250.0)
        self.assertEqual(payload["recipient_address"], "New addr")
        self.assertEqual(payload["item_description"], "Book")
        self.assertEqual(payload["invoice"], "X-2")

    def test_no_overrides_uses_order(self):
        o = self._order()
        with patch.object(steadfast_order.requests, "post", return_value=_Resp()) as post:
            steadfast_order.create_consignment(o)
        self.assertEqual(post.call_args.kwargs["json"]["recipient_name"], "Real")


from django.contrib.auth.models import User
from rest_framework.test import APITestCase


@override_settings(COURIER={"STEADFAST_API_KEY": "k", "STEADFAST_SECRET_KEY": "s", "TIMEOUT_SECONDS": 3})
class BookExtraApiTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("admin", password="x", is_staff=True))
        self.order = Order.objects.create(customer_name="Real", phone="017111",
                                          subtotal=Decimal("1000"), delivery_charge=Decimal("80"))

    def _ok(self):
        return patch("app.admin_api.create_consignment", return_value={
            "consignment_id": "99", "tracking_code": "TRK", "status": "in_review",
            "cod_amount": Decimal("250"),
        })

    def test_book_extra_creates_row_with_unique_invoice(self):
        with self._ok():
            r1 = self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                                  {"cod_amount": "250", "recipient_name": "Other"}, format="json")
            r2 = self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                                  {"cod_amount": "300"}, format="json")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["invoice"], f"{self.order.uid}-2")
        self.assertEqual(r2.json()["invoice"], f"{self.order.uid}-3")
        self.assertEqual(self.order.extra_consignments.count(), 2)

    def test_steadfast_error_creates_no_row(self):
        from app.services.steadfast_order import SteadfastError
        with patch("app.admin_api.create_consignment", side_effect=SteadfastError("down")):
            r = self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                                 {"cod_amount": "250"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.order.extra_consignments.count(), 0)

    def test_serializer_lists_extras(self):
        with self._ok():
            self.client.post(f"/api/admin/orders/{self.order.id}/book_extra/",
                             {"cod_amount": "250"}, format="json")
        r = self.client.get(f"/api/admin/orders/{self.order.id}/")
        self.assertEqual(len(r.json()["extra_consignments"]), 1)
