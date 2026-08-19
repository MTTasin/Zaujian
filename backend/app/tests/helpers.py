"""Shared test helpers."""


def rows(response):
    """The rows of a list response, paginated or not.

    The admin lists that grow forever (orders, leads, CAPI events, chats, audit)
    are paged; the bounded catalogue lists are not. Tests care about the rows,
    not which shape they arrived in.
    """
    body = response.json() if hasattr(response, "json") else response
    if isinstance(body, dict) and "results" in body:
        return body["results"]
    return body
