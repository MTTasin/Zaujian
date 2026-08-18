"""
Staff (moderator) management — owner only.

The owner creates moderator accounts here and grants each one a level per
section. Everything that could be used to climb is refused server-side: you
cannot create a superuser, cannot touch a superuser's row, cannot edit yourself,
and cannot grant a section the design says is owner-only.

Design: docs/superpowers/specs/2026-08-01-moderator-access-control-design.md
"""

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .models import AdminAuditLog, StaffProfile
from .permissions import GRANTABLE, LEVELS, NONE, SECTIONS, OwnerPermission


def clean_access(raw):
    """Keep only real, grantable sections at a real level. Everything else is
    dropped rather than stored — a saved profile can never out-rank the code."""
    if not isinstance(raw, dict):
        raise serializers.ValidationError({"access": "Expected an object of section -> level."})
    cleaned, bad = {}, []
    for key, value in raw.items():
        if key not in SECTIONS:
            bad.append(f"unknown section '{key}'")
            continue
        if SECTIONS[key][1]:
            bad.append(f"'{key}' is owner-only and cannot be granted")
            continue
        if value not in LEVELS:
            bad.append(f"'{key}' has invalid level '{value}'")
            continue
        if value != NONE:
            cleaned[key] = value
    if bad:
        raise serializers.ValidationError({"access": bad})
    return cleaned


class StaffSerializer(serializers.ModelSerializer):
    access = serializers.JSONField(source="staff_profile.access", required=False)
    note = serializers.CharField(
        source="staff_profile.note", required=False, allow_blank=True, max_length=200,
    )
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    is_owner = serializers.BooleanField(source="is_superuser", read_only=True)
    # Null for an account that has never opened the panel. The panel turns it
    # into "Active now" / "Active 20m ago" — the freshness rule is a display
    # choice, so the API hands over the timestamp and nothing more.
    last_seen = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "email", "is_active", "is_owner",
            "last_login", "last_seen", "date_joined", "access", "note", "password",
        ]
        read_only_fields = ["id", "last_login", "date_joined"]

    def get_last_seen(self, obj):
        # RelatedObjectDoesNotExist subclasses AttributeError, so a user with no
        # presence row falls through to None rather than exploding the list.
        presence = getattr(obj, "presence", None)
        return presence.last_seen if presence else None

    def validate_password(self, value):
        if value:
            try:
                validate_password(value)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(list(exc.messages))
        return value

    def validate_access(self, value):
        return clean_access(value)

    def create(self, validated):
        profile_data = validated.pop("staff_profile", {})
        password = validated.pop("password", "") or ""
        if not password:
            raise serializers.ValidationError({"password": "A password is required."})
        # is_staff/is_superuser are set HERE, never taken from the request — a
        # payload asking for superuser must not be able to get it.
        user = User.objects.create_user(
            username=validated["username"],
            email=validated.get("email", ""),
            first_name=validated.get("first_name", ""),
            password=password,
            is_staff=True,
            is_superuser=False,
            is_active=validated.get("is_active", True),
        )
        StaffProfile.objects.create(
            user=user,
            access=profile_data.get("access", {}),
            note=profile_data.get("note", ""),
        )
        return user

    def update(self, instance, validated):
        profile_data = validated.pop("staff_profile", {})
        password = validated.pop("password", "") or ""
        for field in ("username", "email", "first_name", "is_active"):
            if field in validated:
                setattr(instance, field, validated[field])
        if password:
            instance.set_password(password)
        instance.save()

        profile, _ = StaffProfile.objects.get_or_create(user=instance)
        if "access" in profile_data:
            profile.access = profile_data["access"]
        if "note" in profile_data:
            profile.note = profile_data["note"]
        profile.save()

        # A password change or a deactivation must end the session NOW, not
        # whenever the browser next happens to log out.
        if password or instance.is_active is False:
            Token.objects.filter(user=instance).delete()
        return instance


class AdminStaffViewSet(viewsets.ModelViewSet):
    """Owner-only CRUD over moderator accounts."""

    permission_classes = [OwnerPermission]
    section = "staff"
    serializer_class = StaffSerializer
    queryset = (
        User.objects.filter(is_staff=True)
        .select_related("staff_profile", "presence")
        .order_by("-is_superuser", "username")
    )

    def _guard(self, target, request):
        """Refuse the two moves that would let the panel damage its own owner."""
        if target.is_superuser:
            return "The owner account is not editable from the panel."
        if target.pk == request.user.pk:
            return "You cannot change your own access."
        return None

    def update(self, request, *args, **kwargs):
        problem = self._guard(self.get_object(), request)
        if problem:
            return Response({"error": problem}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        problem = self._guard(self.get_object(), request)
        if problem:
            return Response({"error": problem}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        target = self.get_object()
        problem = self._guard(target, request)
        if problem:
            return Response({"error": problem}, status=status.HTTP_403_FORBIDDEN)
        Token.objects.filter(user=target).delete()
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def set_password(self, request, pk=None):
        target = self.get_object()
        problem = self._guard(target, request)
        if problem:
            return Response({"error": problem}, status=status.HTTP_403_FORBIDDEN)
        password = (request.data or {}).get("password") or ""
        try:
            validate_password(password, user=target)
        except DjangoValidationError as exc:
            return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        target.set_password(password)
        target.save(update_fields=["password"])
        Token.objects.filter(user=target).delete()   # old sessions die with the old password
        return Response({"ok": True})

    @action(detail=False, methods=["get"])
    def sections(self, request):
        """The grantable section list, so the panel's matrix is never a second
        copy of the registry that can drift out of step with the backend."""
        return Response({
            "sections": [
                {"key": key, "label": SECTIONS[key][0]} for key in GRANTABLE
            ],
            "levels": list(LEVELS),
        })


# --------------------------------------------------------------------------- #
# Audit log (read-only, owner only)
# --------------------------------------------------------------------------- #

class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdminAuditLog
        fields = ["id", "username", "method", "path", "section", "status_code",
                  "object_repr", "payload", "ip", "created_at"]


class AuditLogPagination(PageNumberPagination):
    """Pages, not a hard cap.

    The list used to be sliced to the newest 500 rows, which silently hid
    everything older — on a 180-day trail that is most of it, and the whole
    point of the log is answering a question about something that already
    happened. Paging keeps each response small AND every row reachable.
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class AdminAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """The trail is append-only: no create, no update, no delete — not even for
    the owner. A log you can edit answers nothing."""

    permission_classes = [OwnerPermission]
    section = "audit"
    serializer_class = AuditLogSerializer
    queryset = AdminAuditLog.objects.all()
    pagination_class = AuditLogPagination

    def get_queryset(self):
        qs = self.queryset.all()
        params = self.request.query_params
        if params.get("user"):
            qs = qs.filter(username=params["user"])
        if params.get("section"):
            qs = qs.filter(section=params["section"])
        if params.get("start"):
            qs = qs.filter(created_at__date__gte=params["start"])
        if params.get("end"):
            qs = qs.filter(created_at__date__lte=params["end"])
        return qs
