import json
import unittest
import os
from unittest.mock import patch

from backend import database, history
from test_usage_recovery import DatabaseFixture


class HistoryTests(DatabaseFixture, unittest.TestCase):
    def seed_messages(self, count=95):
        for index in range(count):
            database.add_message(f"message-{index}", "main", "user" if index % 2 == 0 else "assistant", f"Text {index}")
        connection = database.get_connection()
        with connection:
            connection.execute("UPDATE messages SET created_at='2026-01-01T00:00:00Z'")
        connection.close()

    def test_keyset_pages_have_no_duplicates_or_gaps(self):
        self.seed_messages()
        latest = history.message_page("main")
        self.assertEqual(len(latest["messages"]), 40)
        self.assertTrue(latest["has_more"])
        older = history.message_page("main", before=latest["oldest_cursor"])
        oldest = history.message_page("main", before=older["oldest_cursor"])
        combined = oldest["messages"] + older["messages"] + latest["messages"]
        self.assertEqual([message["id"] for message in combined], [f"message-{index}" for index in range(95)])
        self.assertFalse(oldest["has_more"])

    def test_cursor_survives_append_but_not_removal(self):
        self.seed_messages()
        latest = history.message_page("main")
        database.add_message("new", "main", "assistant", "New reply")
        self.assertEqual(len(history.message_page("main", before=latest["oldest_cursor"])["messages"]), 40)
        database.truncate_messages_from("main", latest["oldest_cursor"])
        with self.assertRaises(ValueError):
            history.message_page("main", before=latest["oldest_cursor"])
        self.assertEqual(history.message_page("main")["history_revision"], 1)

    def test_edit_uses_insertion_order_when_timestamps_collide(self):
        self.seed_messages(5)
        self.assertEqual(database.truncate_messages_from("main", "message-3"), 2)
        self.assertEqual([message["id"] for message in history.message_page("main")["messages"]], ["message-0", "message-1", "message-2"])

    def test_artifact_metadata_does_not_download_full_content(self):
        database.create_artifact("artifact", "main", "Title", "document", "private long content")
        database.add_message("reply", "main", "assistant", "Document ready", artifact_id="artifact")
        artifact = history.message_page("main")["messages"][0]["artifact"]
        self.assertEqual(artifact["id"], "artifact")
        self.assertNotIn("content", artifact)

    def test_branch_copies_prefix_without_replaying_pending_actions(self):
        self.seed_messages(5)
        database.create_staged_action("pending", "main", "gmail", "send_email", {"to": "test@example.com"}, "message-1")
        branch = history.branch_message("main", "message-2", "Branch")
        self.assertEqual(branch["parent_session_id"], "main")
        self.assertEqual(branch["parent_message_id"], "message-2")
        messages = history.message_page(branch["id"])["messages"]
        self.assertEqual([message["content"] for message in messages], ["Text 0", "Text 1", "Text 2"])
        self.assertTrue(all(message["staged_action"] is None for message in messages))
        self.assertTrue(all(not message.get("thread_proposal") for message in messages))

    def test_missing_conversation_and_foreign_cursor_are_rejected(self):
        with self.assertRaises(LookupError):
            history.message_page("missing")
        database.create_thread("thread", "Thread")
        database.add_message("foreign", "thread", "user", "Hello")
        with self.assertRaises(ValueError):
            history.message_page("main", before="foreign")

    def test_pending_actions_include_all_confirmation_fields(self):
        database.add_message("reply", "main", "assistant", "Ready")
        parameters = {"to": "test@example.com", "bcc": "hidden@example.com", "send_at": "2030-01-01T10:00:00+05:30"}
        database.create_staged_action("action", "main", "gmail", "send_email", parameters, "reply")
        action = history.message_page("main")["messages"][0]["staged_action"]
        self.assertEqual(action["parameters"], parameters)
        self.assertTrue(database.claim_staged_action("action"))
        self.assertFalse(database.claim_staged_action("action"))


class HistoryContractTests(DatabaseFixture, unittest.IsolatedAsyncioTestCase):
    async def test_android_history_branch_and_truncate_routes(self):
        import httpx
        from backend.main import app

        for index in range(5):
            database.add_message(f"message-{index}", "main", "user" if index % 2 == 0 else "assistant", f"Text {index}")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/sessions/main/history", params={"limit": 2})
            self.assertEqual(response.status_code, 200)
            self.assertEqual([message["id"] for message in response.json()["messages"]], ["message-3", "message-4"])
            response = await client.get("/api/sessions/main/history", params={"before": "missing"})
            self.assertEqual(response.status_code, 409)
            response = await client.get("/api/sessions/main/history", params={"limit": 101})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/api/sessions/main/messages/message-2/branch", json={"name": "Branch"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["parent_message_id"], "message-2")
            response = await client.delete("/api/sessions/main/messages", params={"from_message_id": "message-3"})
            self.assertEqual(response.status_code, 200)
            response = await client.get("/api/sessions/main/history")
            self.assertEqual(response.json()["history_revision"], 1)

    async def test_version_reports_backend_web_mismatch(self):
        import httpx
        from backend.main import app

        with open(os.path.join(self.directory.name, "build-info.json"), "w") as manifest:
            json.dump({"revision": "old-web"}, manifest)
        with patch("backend.main.dist_dir", self.directory.name), patch.dict(os.environ, {"APP_REVISION": "new-backend"}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/api/version")
        self.assertEqual(response.json()["backend_revision"], "new-backend")
        self.assertFalse(response.json()["matches"])


if __name__ == "__main__":
    unittest.main()
