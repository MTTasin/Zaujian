from django.apps import AppConfig


class AppConfig(AppConfig):
    name = 'app'

    def ready(self):
        # Cache invalidation receivers (see app/signals.py).
        from . import signals  # noqa: F401
