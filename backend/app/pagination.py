"""Paging for the admin lists that grow forever.

Orders, leads, CAPI events, chats and the audit trail all accumulate: nothing
ever deletes them, so an unpaginated list is a payload that gets bigger every
week until the panel reads as broken. The query COUNT is already flat for these
(see `AdminOrderListSerializer` and the chat annotations) — this bounds the
number of rows serialized and shipped.

Deliberately NOT applied to the catalogue lists (products, combos, categories,
finance categories, suppliers): those are bounded by how much the shop sells,
the admin UI expects to see all of them at once, and paging them would break
pickers that search across the whole list.
"""

from rest_framework.pagination import PageNumberPagination


class AdminPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
