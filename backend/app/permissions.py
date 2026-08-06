"""
Staff (moderator) access control for the frontend admin panel.

Before this module every `is_staff` account was effectively root: `IsAdminUser`
was the only check on the whole `/api/admin/` surface. Now each endpoint declares
the **section** it belongs to, and a staff user carries a level per section:

    none  - the section does not exist for them (403, and the nav hides it)
    view  - every GET works, every write is refused
    full  - everything in that section

The owner is `is_superuser` and bypasses all of it. There is no third identity.

Design: docs/superpowers/specs/2026-08-01-moderator-access-control-design.md
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

NONE, VIEW, FULL = "none", "view", "full"
LEVELS = (NONE, VIEW, FULL)

# key -> (label, owner_only). Owner-only sections can never be granted to a
# moderator; they exist here so the frontend can label them and so the
# hole-detector test has one list to check every route against.
SECTIONS = {
    "dashboard": ("Dashboard", False),
    "orders": ("Orders", False),
    "analytics": ("Analytics", False),
    "finance": ("Finance", False),
    "fraud": ("Fraud Check", False),
    "leads": ("Leads", False),
    "capi": ("CAPI Events", False),
    "chats": ("Live Chats", False),
    "custom": ("Custom Requests", False),
    # /admin/products and /admin/customization are two views of the same
    # endpoints — splitting them into two sections would be a lie.
    "products": ("Products & Customization", False),
    "combos": ("Listings", False),
    "homepage": ("Homepage", False),
    "gallery": ("Gallery", False),
    "bot": ("Bot Instructions", True),
    "settings": ("Site Settings", True),
    "staff": ("Staff", True),
    "audit": ("Audit Log", True),
}

GRANTABLE = tuple(k for k, (_, owner_only) in SECTIONS.items() if not owner_only)


def is_owner(user):
    return bool(user and user.is_authenticated and user.is_active and user.is_superuser)


def _usable(user):
    """Can this account touch the admin API at all?"""
    return bool(user and user.is_authenticated and user.is_active and user.is_staff)


def access_level(user, section):
    """Level this user holds for one section. Unknown anything -> NONE."""
    if not _usable(user):
        return NONE
    if user.is_superuser:
        return FULL
    if section not in SECTIONS or SECTIONS[section][1]:
        return NONE            # unmapped or owner-only: never granted
    profile = getattr(user, "staff_profile", None)
    if profile is None:
        return NONE            # a staff user with no profile has nothing
    level = (profile.access or {}).get(section)
    return level if level in LEVELS else NONE


def access_map(user):
    """The whole grantable map, for `admin/me/` and the staff editor."""
    if is_owner(user):
        return {key: FULL for key in GRANTABLE}
    return {key: access_level(user, key) for key in GRANTABLE}


def can_read(user, section):
    return access_level(user, section) in (VIEW, FULL)


def can_write(user, section):
    return access_level(user, section) == FULL


class SectionPermission(BasePermission):
    """
    Staff + section level, read/write split by HTTP method.

    The section comes off the permission class itself (function views, via
    `section_access(...)`) or off the view (`view.section`, for viewsets). A view
    that declares neither is refused rather than left open — the hole-detector
    test in `test_staff_access.py` turns that fail-closed default into a build
    error instead of a silent hole.
    """

    message = "You don't have access to this section."
    section = None
    #: Action names (or True for a whole function view) a VIEW-level user may POST.
    view_writes = ()

    def has_permission(self, request, view):
        user = request.user
        if not _usable(user):
            return False
        if user.is_superuser:
            return True

        section = self.section or getattr(view, "section", None)
        if section is None:
            return False
        level = access_level(user, section)
        if level == NONE:
            return False
        if request.method in SAFE_METHODS:
            return True
        if level == FULL:
            return True
        # A handful of POSTs are not edits: the Orders page fires mark_seen on
        # open, fraud-check POSTs a phone number to look it up. Refusing those
        # would present a view-only moderator with a broken page rather than a
        # read-only one.
        if self.view_writes is True:
            return True
        return getattr(view, "action", None) in (
            tuple(self.view_writes) + tuple(getattr(view, "VIEW_WRITES", ()))
        )


class OwnerPermission(BasePermission):
    """Superuser only — for sections a moderator can never be granted."""

    message = "Owner only."
    owner_only = True

    def has_permission(self, request, view):
        return is_owner(request.user)


class AnyStaffPermission(BasePermission):
    """
    Deliberately open to every staff account, whatever their sections.

    Only for endpoints about the person logged in rather than about business
    data: who am I, my push device, and the badge poll (which scopes its own
    counters to what the caller may see). Marked explicitly so the hole-detector
    test can tell "intentionally open" from "someone forgot a section".
    """

    message = "Staff account required."
    any_staff = True

    def has_permission(self, request, view):
        return _usable(request.user)


def section_access(section, view_writes=False):
    """
    Permission CLASS for a function view: `@permission_classes([section_access("orders")])`.

    A class rather than a bare decorator because DRF's own `permission_classes`
    hangs it on the generated view, which is what makes the guard discoverable
    from the URLconf — the hole-detector test reads it back off `view.cls`.
    """
    return type(
        f"SectionAccess_{section}",
        (SectionPermission,),
        {"section": section, "view_writes": True if view_writes else ()},
    )


class SectionViewSetMixin:
    """Mix into a viewset and set `section`."""

    permission_classes = [SectionPermission]
    section = None
    #: Action names a VIEW-level user may still POST (not real edits).
    VIEW_WRITES = ()
