from decimal import Decimal

from django.test import TestCase, override_settings

from app.models import PrebuiltCombo, Product, ProductSpec
from app.services.chatbot import _shop_facts


class ShopFactsTests(TestCase):
    """The bot must ground every price in DB data — never invent one."""

    def setUp(self):
        Product.objects.create(
            name="Premium Dupatta", slug="premium-dupatta", kind=Product.Kind.SIMPLE,
            category="dupatta", base_price=Decimal("1600"), active=True,
        )
        Product.objects.create(
            name="Hidden Item", slug="hidden-item", kind=Product.Kind.SIMPLE,
            category="x", base_price=Decimal("999"), active=False,
        )

    def test_lists_active_db_products_without_a_price(self):
        """A Product's own price is only reachable inside the customizer — it is
        never a price on /products, so quoting it hands the customer a number
        they cannot find on the site. Names and details only."""
        facts = _shop_facts()
        self.assertIn("Premium Dupatta", facts)
        self.assertNotIn("1600", facts)

    def test_tells_the_bot_to_hand_off_on_a_part_price(self):
        self.assertIn("[HANDOFF]", _shop_facts())
        self.assertIn("NOT sold as separate priced items", _shop_facts())

    def test_hides_inactive_products(self):
        facts = _shop_facts()
        self.assertNotIn("Hidden Item", facts)
        self.assertNotIn("999", facts)

    def test_includes_combos_with_their_item_list(self):
        book = Product.objects.create(
            name="Nikah Book", slug="nikah-book", kind=Product.Kind.SIMPLE,
            category="book", base_price=Decimal("1500"), active=True,
        )
        pen = Product.objects.create(
            name="Premium Pen", slug="premium-pen", kind=Product.Kind.SIMPLE,
            category="pen", base_price=Decimal("200"), active=True,
        )
        combo = PrebuiltCombo.objects.create(
            name="Combo A", slug="combo-a", price=Decimal("2500"), active=True,
            description="Book plus pen bundle",
        )
        combo.products.set([book, pen])

        facts = _shop_facts()
        self.assertIn("Combo A", facts)
        self.assertIn("2500", facts)
        # The bot must be able to say exactly what is inside the combo.
        self.assertIn("Nikah Book", facts)
        self.assertIn("Premium Pen", facts)
        self.assertIn("Book plus pen bundle", facts)

    def test_includes_product_description_and_specs(self):
        p = Product.objects.get(slug="premium-dupatta")
        p.description = "Soft premium dupatta for the ceremony"
        p.save()
        ProductSpec.objects.create(product=p, label="উপকরণ", value="Silk blend")

        facts = _shop_facts()
        self.assertIn("Soft premium dupatta", facts)
        self.assertIn("Silk blend", facts)

    @override_settings(SHOP={"DELIVERY_CHARGE": "120", "ADVANCE_AMOUNT": "200",
                            "BKASH_NUMBER": "", "NAGAD_NUMBER": ""})
    def test_includes_delivery_charge(self):
        self.assertIn("120", _shop_facts())

    def test_forbids_inventing_prices(self):
        facts = _shop_facts()
        self.assertIn("Never invent", facts)

    def test_never_quotes_zero_for_a_part(self):
        """A dupatta with no options used to price_bounds() to (0,0). No part
        carries a price now, so a "free" quote is impossible by construction."""
        Product.objects.create(
            name="Silk Dupatta", slug="silk-dupatta", kind=Product.Kind.DUPATTA,
            category="dupatta", base_price=Decimal("1600"), active=True,
        )
        facts = _shop_facts()
        self.assertIn("Silk Dupatta", facts)
        self.assertNotIn("৳0", facts)
        self.assertNotIn("1600", facts)

    def test_states_the_only_one_rule(self):
        for slug in ("book-x", "frame-x", "thumb-x"):
            Product.objects.create(
                name=slug, slug=slug, kind=Product.Kind.SIMPLE, category=slug,
                base_price=Decimal("100"), active=True, exclusive_group="nikahnama",
            )
        facts = _shop_facts()
        self.assertIn("একসাথে শুধু একটি নেওয়া যাবে", facts)
        self.assertIn("book-x", facts)
        self.assertIn("thumb-x", facts)

    def test_no_rule_line_for_a_lone_group_member(self):
        Product.objects.create(
            name="only-one", slug="only-one", kind=Product.Kind.SIMPLE, category="x",
            base_price=Decimal("100"), active=True, exclusive_group="solo",
        )
        self.assertNotIn("একসাথে শুধু একটি নেওয়া যাবে", _shop_facts())

    def test_only_listing_prices_are_quotable(self):
        """The catalogue price a customer can actually see is the listing's."""
        part = Product.objects.create(
            name="Lone Book", slug="lone-book", kind=Product.Kind.LAYERED,
            category="book", base_price=Decimal("1100"), active=True,
        )
        combo = PrebuiltCombo.objects.create(
            name="Book Listing", slug="book-listing", price=Decimal("1250"),
            active=True,
        )
        combo.products.set([part])

        facts = _shop_facts()
        self.assertIn("1250", facts)      # what /products shows
        self.assertNotIn("1100", facts)   # customizer-only, never quotable


class BehaviorRuleTests(TestCase):
    """Rules that stop the model filling gaps with plausible-looking numbers."""

    def setUp(self):
        from app.services.chatbot import _BEHAVIOR
        self.rules = _BEHAVIOR

    def test_numbers_must_be_copied_digit_for_digit(self):
        # DeepSeek was re-typing ৳1250 as ৬২৫০ when writing Bengali numerals.
        self.assertIn("Bengali numerals", self.rules)
        self.assertIn("digit", self.rules)

    def test_sizes_and_specs_may_not_be_invented(self):
        # It answered "৮.৫ ইঞ্চি × ৬৬ ইঞ্চি" with no spec row in the DB at all.
        self.assertIn("ইঞ্চি", self.rules)
        self.assertIn("[HANDOFF]", self.rules)
