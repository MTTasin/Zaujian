"""The Live Chats list is polled every few seconds, so its cost is paid forever.

`last_message` and `unread` were two queries per session on an unpaginated list:
300 sessions meant ~600 queries every 6 seconds, whether or not the admin was
looking at the tab. Both are annotations now, and the list is paged.
"""

from django.contrib.auth.models import User
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from app.models import ChatMessage, ChatSession


def client_for(user):
    api = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return api


def make_session(token, unread=2):
    session = ChatSession.objects.create(token=token)
    ChatMessage.objects.create(session=session, role=ChatMessage.Role.BOT, text="সালাম")
    for i in range(unread):
        ChatMessage.objects.create(
            session=session, role=ChatMessage.Role.CUSTOMER,
            text=f"দাম কত {i}", read_by_admin=False,
        )
    return session


class ChatListQueryTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("owner", "o@x.com", "x")
        self.api = client_for(self.owner)

    def test_the_cost_does_not_grow_with_the_number_of_chats(self):
        for i in range(3):
            make_session(f"t{i}")
        self.api.get("/api/admin/chats/")   # warm up: presence is stamped once
        with CaptureQueriesContext(connection) as few:
            self.api.get("/api/admin/chats/")

        for i in range(3, 15):
            make_session(f"t{i}")
        # Five times the chats, the same number of queries — that is the whole
        # point. A per-row field would have made this 24 more.
        with self.assertNumQueries(len(few.captured_queries)):
            self.api.get("/api/admin/chats/")

    def test_the_summary_still_says_what_it_said(self):
        session = make_session("t", unread=3)
        ChatMessage.objects.create(
            session=session, role=ChatMessage.Role.CUSTOMER,
            text="শেষ বার্তা", read_by_admin=False,
        )

        row = self.api.get("/api/admin/chats/").json()["results"][0]

        self.assertEqual(row["last_message"], "শেষ বার্তা")
        self.assertEqual(row["unread"], 4)

    def test_a_chat_with_no_messages_reports_an_empty_summary(self):
        ChatSession.objects.create(token="quiet")

        row = self.api.get("/api/admin/chats/").json()["results"][0]

        self.assertEqual(row["last_message"], "")
        self.assertEqual(row["unread"], 0)

    def test_a_long_message_is_still_trimmed(self):
        session = ChatSession.objects.create(token="t")
        ChatMessage.objects.create(session=session, role=ChatMessage.Role.CUSTOMER,
                                   text="ক" * 200)

        row = self.api.get("/api/admin/chats/").json()["results"][0]

        self.assertEqual(len(row["last_message"]), 80)

    def test_the_list_is_paged(self):
        for i in range(60):
            ChatSession.objects.create(token=f"t{i}")

        body = self.api.get("/api/admin/chats/").json()

        self.assertEqual(body["count"], 60)
        self.assertEqual(len(body["results"]), 50)
        self.assertIsNotNone(body["next"])

    def test_a_single_session_serializes_without_the_annotation(self):
        """`set_status` returns one plain instance — it must not 500 on a
        missing annotation."""
        session = make_session("t", unread=1)

        resp = self.api.post(f"/api/admin/chats/{session.id}/set_status/",
                             {"status": "closed"}, format="json")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["last_message"], "দাম কত 0")
        self.assertEqual(resp.json()["unread"], 1)


class ChatPollTests(TestCase):
    """A visitor who opens the widget is not a conversation.

    Polling used to CREATE a ChatSession row, so every curious visitor added one
    — growing the very table the admin list reads, with nothing in it.
    """

    def test_polling_does_not_create_a_session(self):
        api = APIClient()
        resp = api.get("/api/chat/poll/", HTTP_X_CART_TOKEN="visitor-1")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["messages"], [])
        self.assertEqual(resp.json()["status"], ChatSession.Status.BOT)
        self.assertIsNone(resp.json()["session"])
        self.assertEqual(ChatSession.objects.count(), 0)

    def test_polling_an_existing_chat_still_returns_it(self):
        session = make_session("visitor-2", unread=1)
        api = APIClient()

        body = api.get("/api/chat/poll/", HTTP_X_CART_TOKEN="visitor-2").json()

        self.assertEqual(body["session"], session.id)
        self.assertEqual(len(body["messages"]), 2)

    def test_sending_a_message_does_create_one(self):
        api = APIClient()
        api.post("/api/chat/send/", {"message": "সালাম"}, format="json",
                 HTTP_X_CART_TOKEN="visitor-3")

        self.assertEqual(ChatSession.objects.filter(token="visitor-3").count(), 1)
