"""
Unit tests for Phase 4: Google Workspace Integration & Staged Actions
"""

import unittest
import uuid
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import (
    save_integration_token,
    get_integration_token,
    delete_integration_token,
    create_staged_action,
    get_staged_action,
    update_staged_action_status,
    list_staged_actions,
    update_staged_action_message_id,
    create_session,
)
from backend.google_service import google_workspace


class TestPhase4(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.session_id = f"test_session_{uuid.uuid4().hex[:8]}"
        create_session(self.session_id, name="Phase 4 Test Session")

    def test_integration_token_crud(self):
        # 1. Clean up first
        delete_integration_token("test_provider")

        # 2. Save token
        saved = save_integration_token(
            provider="test_provider",
            access_token="test_access_123",
            refresh_token="test_refresh_456",
            scopes="read write",
            metadata={"email": "tester@example.com"},
        )
        self.assertEqual(saved["provider"], "test_provider")
        self.assertEqual(saved["access_token"], "test_access_123")
        self.assertEqual(saved["metadata"]["email"], "tester@example.com")

        # 3. Retrieve token
        fetched = get_integration_token("test_provider")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["access_token"], "test_access_123")

        # 4. Delete token
        deleted = delete_integration_token("test_provider")
        self.assertTrue(deleted)
        self.assertIsNone(get_integration_token("test_provider"))

    def test_staged_actions_crud(self):
        action_id = f"act_{uuid.uuid4().hex[:8]}"
        params = {"to": "colleague@example.com", "subject": "Quarterly Update", "body": "Hello"}

        # 1. Create staged action
        created = create_staged_action(
            action_id=action_id,
            session_id=self.session_id,
            provider="gmail",
            action_type="send_email",
            parameters=params,
        )
        self.assertEqual(created["status"], "pending")
        self.assertEqual(created["parameters"]["to"], "colleague@example.com")

        # 2. Retrieve staged action
        fetched = get_staged_action(action_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["parameters"]["subject"], "Quarterly Update")

        # 3. Update message_id
        update_staged_action_message_id(action_id, "msg_12345")
        fetched = get_staged_action(action_id)
        self.assertEqual(fetched["message_id"], "msg_12345")

        # 4. List staged actions
        actions = list_staged_actions(session_id=self.session_id, status="pending")
        self.assertTrue(any(a["id"] == action_id for a in actions))

        # 5. Update status
        updated = update_staged_action_status(action_id, status="declined", result={"reason": "Declined by user"})
        self.assertEqual(updated["status"], "declined")

    def test_api_integrations_status(self):
        response = self.client.get("/api/integrations/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("google_connected", data)
        self.assertIn("services", data)
        self.assertIn("calendar", data["services"])
        self.assertIn("tasks", data["services"])
        self.assertIn("gmail", data["services"])

    def test_api_action_respond_decline(self):
        action_id = f"act_{uuid.uuid4().hex[:8]}"
        create_staged_action(
            action_id=action_id,
            session_id=self.session_id,
            provider="gmail",
            action_type="send_email",
            parameters={"to": "user@example.com", "subject": "Test", "body": "Hi"},
        )

        response = self.client.post(
            f"/api/actions/{action_id}/respond",
            json={"action": "decline"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "declined")


if __name__ == "__main__":
    unittest.main()
