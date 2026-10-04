"""
Unit tests for Phase 5: Proactive Velocity Engine and Skills Architecture
Strict constraint: ZERO EMOJIS in code, logs, comments, and strings.
"""

import unittest
import uuid
import datetime
from zoneinfo import ZoneInfo
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import (
    create_scheduled_event,
    get_scheduled_event,
    update_scheduled_event,
    list_scheduled_events,
    delete_scheduled_event,
    get_due_scheduled_events,
)
from backend.scheduler import compute_next_run
from backend import skills_manager


class TestPhase5(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_prefix = f"test_{uuid.uuid4().hex[:8]}"

    def tearDown(self):
        # Clean up any test skills created
        custom_skill_id = f"custom_skill_{self.test_prefix}"
        skills_manager.delete_skill(custom_skill_id)

    # -------------------------------------------------------------
    # Scheduled Events Database CRUD Tests
    # -------------------------------------------------------------

    def test_scheduled_events_crud(self):
        event_id = f"evt_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        # 1. Create scheduled event
        created = create_scheduled_event(
            event_id=event_id,
            name="Morning Briefing Test",
            event_type="recurring",
            cron_expression="0 8 * * *",
            next_run_at=now_iso,
            prompt="Generate morning briefing",
            session_id="main",
            timezone_str="Asia/Kolkata",
        )
        self.assertEqual(created["id"], event_id)
        self.assertEqual(created["name"], "Morning Briefing Test")
        self.assertEqual(created["cron_expression"], "0 8 * * *")
        self.assertEqual(created["status"], "active")

        # 2. Get scheduled event
        fetched = get_scheduled_event(event_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["name"], "Morning Briefing Test")

        # 3. Update scheduled event
        updated = update_scheduled_event(
            event_id=event_id,
            name="Updated Briefing",
            status="paused",
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated["name"], "Updated Briefing")
        self.assertEqual(updated["status"], "paused")

        # 4. List scheduled events
        events = list_scheduled_events()
        self.assertTrue(any(e["id"] == event_id for e in events))

        # 5. Delete scheduled event
        deleted = delete_scheduled_event(event_id)
        self.assertTrue(deleted)
        self.assertIsNone(get_scheduled_event(event_id))

    def test_due_scheduled_events_query(self):
        event_id = f"evt_due_{uuid.uuid4().hex[:8]}"
        past_iso = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)).isoformat()

        created = create_scheduled_event(
            event_id=event_id,
            name="Due Event Test",
            event_type="recurring",
            cron_expression="*/5 * * * *",
            next_run_at=past_iso,
            prompt="Due event execution",
            session_id="main",
            timezone_str="Asia/Kolkata",
        )
        self.assertEqual(created["status"], "active")

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        due_events = get_due_scheduled_events(as_of_iso=now_iso)
        due_ids = [e["id"] for e in due_events]
        self.assertIn(event_id, due_ids)

        # Cleanup
        delete_scheduled_event(event_id)

    # -------------------------------------------------------------
    # Scheduler Computation Tests
    # -------------------------------------------------------------

    def test_compute_next_run_cron(self):
        tz_name = "Asia/Kolkata"
        base_time = datetime.datetime(2026, 10, 4, 7, 0, 0, tzinfo=ZoneInfo(tz_name))

        # 8:00 AM daily in Asia/Kolkata
        next_run = compute_next_run(cron_expr="0 8 * * *", timezone_str=tz_name, base_dt=base_time)
        self.assertIsNotNone(next_run)
        next_dt = datetime.datetime.fromisoformat(next_run)
        self.assertEqual(next_dt.astimezone(ZoneInfo(tz_name)).hour, 8)
        self.assertEqual(next_dt.astimezone(ZoneInfo(tz_name)).minute, 0)

    def test_compute_next_run_one_shot(self):
        tz_name = "Asia/Kolkata"
        future_time = datetime.datetime.now(ZoneInfo(tz_name)) + datetime.timedelta(hours=3)
        future_iso = future_time.isoformat()

        # Future timestamp returns its UTC ISO representation
        computed = compute_next_run(run_at=future_iso, timezone_str=tz_name)
        self.assertIsNotNone(computed)
        expected_utc = future_time.astimezone(datetime.timezone.utc).isoformat()
        self.assertEqual(computed, expected_utc)

    # -------------------------------------------------------------
    # Skills Manager Tests
    # -------------------------------------------------------------

    def test_skills_seeding_and_discovery(self):
        skills_manager.seed_skills_if_needed()
        skills = skills_manager.list_skills()
        skill_ids = [s["id"] for s in skills]

        # The 3 seeded skills should be present
        self.assertIn("morning_briefing", skill_ids)
        self.assertIn("evening_reflection", skill_ids)
        self.assertIn("study_coach", skill_ids)

        # Retrieve a single skill
        briefing = skills_manager.get_skill("morning_briefing")
        self.assertIsNotNone(briefing)
        self.assertEqual(briefing["slash_command"], "/briefing")
        self.assertTrue(len(briefing.get("instructions", "")) > 0)

    def test_custom_skill_lifecycle(self):
        custom_id = f"custom_skill_{self.test_prefix}"
        created = skills_manager.create_or_update_skill(
            skill_id=custom_id,
            name="Test Custom Skill",
            description="Custom skill for test suite",
            instructions="Execute test steps carefully.",
            enabled=True,
            slash_command="/testcustom",
        )
        self.assertEqual(created["id"], custom_id)
        self.assertEqual(created["name"], "Test Custom Skill")

        # Slash command lookup
        found = skills_manager.find_skill_by_slash_command("/testcustom")
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], custom_id)

        # Prompt manifest contains custom skill
        manifest_text = skills_manager.get_skills_prompt_manifest()
        self.assertIn("Test Custom Skill", manifest_text)
        self.assertIn(custom_id, manifest_text)

        # Delete skill
        deleted = skills_manager.delete_skill(custom_id)
        self.assertTrue(deleted)
        self.assertIsNone(skills_manager.get_skill(custom_id))

    # -------------------------------------------------------------
    # FastAPI REST Endpoints Tests
    # -------------------------------------------------------------

    def test_api_schedules_lifecycle(self):
        # 1. Create schedule
        resp = self.client.post(
            "/api/schedules",
            json={
                "name": "API Schedule Test",
                "event_type": "recurring",
                "cron_expression": "30 9 * * *",
                "prompt": "Run test prompt",
                "session_id": "main",
                "timezone": "Asia/Kolkata",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        event_id = data["id"]
        self.assertEqual(data["name"], "API Schedule Test")
        self.assertIsNotNone(data["next_run_at"])

        # 2. List schedules
        list_resp = self.client.get("/api/schedules")
        self.assertEqual(list_resp.status_code, 200)
        items = list_resp.json()
        self.assertTrue(any(i["id"] == event_id for i in items))

        # 3. Patch schedule
        patch_resp = self.client.patch(
            f"/api/schedules/{event_id}",
            json={"name": "Patched API Schedule", "status": "paused"},
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertEqual(patch_resp.json()["name"], "Patched API Schedule")
        self.assertEqual(patch_resp.json()["status"], "paused")

        # 4. Delete schedule
        del_resp = self.client.delete(f"/api/schedules/{event_id}")
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()["status"], "deleted")

    def test_api_skills_lifecycle(self):
        skill_id = f"api_skill_{self.test_prefix}"

        # 1. Create skill
        resp = self.client.post(
            "/api/skills",
            json={
                "id": skill_id,
                "name": "API Test Skill",
                "description": "Skill created via REST API",
                "instructions": "Follow API test instructions.",
                "enabled": True,
                "slash_command": "/apiskill",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], skill_id)

        # 2. List skills
        list_resp = self.client.get("/api/skills")
        self.assertEqual(list_resp.status_code, 200)
        skills = list_resp.json()
        self.assertTrue(any(s["id"] == skill_id for s in skills))

        # 3. Update skill
        put_resp = self.client.put(
            f"/api/skills/{skill_id}",
            json={
                "name": "Updated API Test Skill",
                "description": "Updated description",
                "instructions": "Updated instructions.",
                "enabled": True,
                "slash_command": "/updatedskill",
            },
        )
        self.assertEqual(put_resp.status_code, 200)
        self.assertEqual(put_resp.json()["name"], "Updated API Test Skill")

        # 4. Delete skill
        del_resp = self.client.delete(f"/api/skills/{skill_id}")
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()["status"], "deleted")


if __name__ == "__main__":
    unittest.main()
