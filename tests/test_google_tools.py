import asyncio
import base64
import json
import unittest
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from jsonschema import ValidationError

from backend import database, workspace_jobs
from backend.google_service import GoogleWorkspaceService
from backend.workspace_tools import WORKSPACE_READ_ONLY, WORKSPACE_TOOLS, validate_arguments
from test_usage_recovery import DatabaseFixture, FakeStream


class GoogleToolTests(DatabaseFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        workspace_jobs.init_jobs()
        self.service = GoogleWorkspaceService()
        self.api = Mock()
        self.factory = patch.object(self.service, "_service", return_value=self.api)
        self.factory.start()
        self.account = patch.object(self.service, "get_user_email", return_value="owner@example.com")
        self.account.start()

    def tearDown(self):
        self.factory.stop()
        self.account.stop()
        super().tearDown()

    def test_calendar_customization_preserves_false_values_and_destination(self):
        self.api.events().insert().execute.return_value = {"id": "event", "summary": "Plan"}
        self.service.create_calendar_event(
            "Plan", "2030-04-01T10:00:00+05:30", "2030-04-01T11:00:00+05:30",
            calendar_id="work", location="Office", time_zone="Asia/Kolkata", recurrence=["RRULE:FREQ=WEEKLY"],
            reminders={"useDefault": False, "overrides": [{"method": "popup", "minutes": 15}]},
            visibility="private", showAs="free", colorId="7", guestsCanModify=False,
            guestsCanInviteOthers=False, guestsCanSeeOtherGuests=False, add_meet=False,
        )
        arguments = self.api.events().insert.call_args.kwargs
        self.assertEqual(arguments["calendarId"], "work")
        self.assertEqual(arguments["body"]["transparency"], "transparent")
        self.assertEqual(arguments["body"]["location"], "Office")
        self.assertFalse(arguments["body"]["guestsCanInviteOthers"])
        self.assertEqual(arguments["body"]["start"]["timeZone"], "Asia/Kolkata")
        self.assertNotIn("conferenceData", arguments["body"])
        self.assertEqual(arguments["sendUpdates"], "none")

    def test_invalid_calendar_dates_fail_before_insert(self):
        with self.assertRaises(ValueError):
            self.service.create_calendar_event("Bad", "2030-01-02", "2030-01-01")
        with self.assertRaises(ValueError):
            self.service.create_calendar_event("Bad", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", recurrence=["RRULE:FREQ=DAILY"])
        self.api.events().insert.assert_not_called()

    def test_calendar_patch_does_not_reset_other_settings(self):
        self.api.events().get().execute.return_value = {"start": {"date": "2030-01-01"}, "end": {"date": "2030-01-02"}}
        self.api.events().patch().execute.return_value = {"id": "event"}
        self.service.update_calendar_event("event", calendar_id="work", location="New office", guestsCanModify=False)
        body = self.api.events().patch.call_args.kwargs["body"]
        self.assertEqual(body, {"location": "New office", "guestsCanModify": False})

    def test_task_metadata_is_not_sent_as_nonexistent_google_fields(self):
        self.api.tasks().insert().execute.side_effect = [{"id": "parent", "title": "Plan"}, {"id": "child", "title": "Step"}]
        result = self.service.create_task("Plan", notes="Details", due_at="2030-01-01T10:30:00+05:30", start_at="2030-01-01T09:00:00+05:30", priority="high", labels=["work"], subtasks=["Step"], tasklist_id="work-list")
        calls = self.api.tasks().insert.call_args_list
        body = calls[-2].kwargs["body"]
        self.assertEqual(body["due"], "2030-01-01T00:00:00.000Z")
        self.assertNotIn("priority", body)
        self.assertIn('"priority": "high"', body["notes"])
        self.assertEqual(calls[-1].kwargs["parent"], "parent")
        self.assertEqual(calls[-1].kwargs["tasklist"], "work-list")
        self.assertEqual(result["subtasks"][0]["id"], "child")

    def test_task_updates_preserve_existing_metadata(self):
        self.api.tasks().get().execute.return_value = {"notes": 'Old\n\n[Velocity metadata]\n{"priority":"high","labels":["work"]}'}
        self.api.tasks().patch().execute.return_value = {"id": "task"}
        self.service.update_task("task", notes="New", status="completed")
        notes = self.api.tasks().patch.call_args.kwargs["body"]["notes"]
        self.assertIn("New", notes)
        self.assertIn('"priority": "high"', notes)

    def test_tasks_expose_next_page_token(self):
        self.api.tasks().list().execute.return_value = {"items": [{"id": "task", "parent": "parent"}], "nextPageToken": "next"}
        result = self.service.list_tasks(tasklist_id="work", page_token="previous", include_completed=True)
        self.assertEqual(result["next_page_token"], "next")
        arguments = self.api.tasks().list.call_args.kwargs
        self.assertTrue(arguments["showHidden"])
        self.assertEqual(arguments["pageToken"], "previous")

    def test_email_reply_and_cc_bcc_are_preserved(self):
        payload = self.service._mail_payload("to@example.com", "Re: Subject", "Body", cc="cc@example.com", bcc="bcc@example.com", thread_id="thread", in_reply_to="<rfc@example.com>")
        message = message_from_bytes(base64.urlsafe_b64decode(payload["raw"]))
        self.assertEqual(message["Bcc"], "bcc@example.com")
        self.assertEqual(message["In-Reply-To"], "<rfc@example.com>")
        self.assertEqual(payload["threadId"], "thread")
        with self.assertRaises(ValueError):
            self.service._mail_payload("to@example.com", "Subject", "Body", thread_id="thread")

    def test_gmail_actions_target_threads_and_existing_labels(self):
        self.service.modify_mail("thread", "thread", "archive")
        arguments = self.api.users().threads().modify.call_args.kwargs
        self.assertEqual(arguments["id"], "thread")
        self.assertEqual(arguments["body"]["removeLabelIds"], ["INBOX"])
        self.service.modify_mail("message", "message", "labels", add_labels=["Label_1"])
        self.assertEqual(self.api.users().messages().modify.call_args.kwargs["body"]["addLabelIds"], ["Label_1"])

    def test_future_send_requires_approval_and_runs_without_llm(self):
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        parameters = {"to": "to@example.com", "subject": "Subject", "body": "Body", "send_at": future.isoformat()}
        with patch.object(self.service, "send_email", return_value={"status": "sent"}) as sender:
            approved = self.service.approve_email("action", parameters)
            self.assertEqual(approved["status"], "scheduled")
            sender.assert_not_called()
            workspace_jobs.run_due(self.service, future + timedelta(seconds=1))
            workspace_jobs.run_due(self.service, future + timedelta(seconds=2))
            sender.assert_called_once_with(to="to@example.com", subject="Subject", body="Body")
        self.assertEqual(workspace_jobs.get_job("action")["status"], "completed")

    def test_uncertain_delivery_is_not_retried_after_restart(self):
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        job = workspace_jobs.create_job("gmail_send", {"to": "to@example.com", "subject": "Subject", "body": "Body"}, run_at=future.isoformat())
        service = Mock()
        service.send_email.side_effect = TimeoutError("delivery unknown")
        workspace_jobs.run_due(service, future + timedelta(seconds=1))
        workspace_jobs.init_jobs()
        workspace_jobs.run_due(service, future + timedelta(seconds=2))
        service.send_email.assert_called_once()
        self.assertEqual(workspace_jobs.get_job(job["id"])["status"], "paused")

    def test_snooze_cancellation_restores_inbox(self):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        with patch.object(self.service, "get_thread", return_value={"messages": [{"labels": ["INBOX"]}]}), patch.object(self.service, "modify_mail") as modifier:
            job = self.service.execute_tool("gmail_snooze", {"thread_id": "thread", "wake_at": future})
            self.assertEqual(job["status"], "pending")
            workspace_jobs.cancel_job(job["id"], self.service)
            self.assertEqual(modifier.call_args.args, ("thread", "thread", "labels"))
            self.assertEqual(modifier.call_args.kwargs, {"add_labels": ["INBOX"]})

    def test_recurring_tasks_create_new_occurrences_without_llm(self):
        future = datetime.now(timezone.utc) + timedelta(days=1)
        job = workspace_jobs.create_job("task_recurrence", {"title": "Daily", "due": datetime.now(timezone.utc).date().isoformat()}, run_at=future.isoformat(), cron_expression="0 8 * * *", time_zone="UTC")
        service = Mock()
        service.create_task.return_value = {"id": "task"}
        workspace_jobs.run_due(service, future + timedelta(seconds=1))
        self.assertEqual(service.create_task.call_args.kwargs["due"], future.date().isoformat())
        self.assertEqual(workspace_jobs.get_job(job["id"])["status"], "pending")

    def test_schema_rejects_unknown_fields_and_invalid_reminders(self):
        with self.assertRaises(ValidationError):
            validate_arguments("gtasks_create_task", {"title": "Task", "made_up": True})
        with self.assertRaises(ValidationError):
            validate_arguments("gcal_create_event", {"summary": "Event", "start_time": "2030-01-01", "end_time": "2030-01-02", "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": -1}]}})
        names = [definition["name"] for definition in WORKSPACE_TOOLS]
        self.assertEqual(len(names), len(set(names)))
        self.assertNotIn("gmail_send_email", WORKSPACE_READ_ONLY)

    def test_account_switch_never_delivers_another_accounts_job(self):
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        job = workspace_jobs.create_job("gmail_send", {"to": "to@example.com", "subject": "Subject", "body": "Body"}, run_at=future.isoformat(), account_email="original@example.com")
        with patch.object(self.service, "send_email") as sender:
            workspace_jobs.run_due(self.service, future + timedelta(seconds=1))
            sender.assert_not_called()
        self.assertEqual(workspace_jobs.get_job(job["id"])["status"], "paused")
        with self.assertRaises(ValueError):
            self.service.approve_email("action", {"to": "to@example.com", "subject": "Subject", "body": "Body", "_account_email": "original@example.com"})


class GoogleRunnerTests(DatabaseFixture, unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_approval_claims_send_only_once(self):
        import httpx
        from backend.main import app

        parameters = {"to": "to@example.com", "subject": "Subject", "body": "Body"}
        database.create_staged_action("action", "main", "gmail", "send_email", parameters)
        with patch("backend.google_service.google_workspace.approve_email", return_value={"status": "sent"}) as sender:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                responses = await asyncio.gather(client.post("/api/actions/action/respond", json={"action": "confirm"}), client.post("/api/actions/action/respond", json={"action": "confirm"}))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        sender.assert_called_once()
        self.assertEqual(database.get_staged_action("action")["status"], "executed")

    async def test_all_send_parameters_are_staged_until_approval(self):
        from backend.responses_runner import ResponsesRunner

        parameters = {"to": "to@example.com", "subject": "Subject", "body": "Body", "cc": "cc@example.com", "bcc": "bcc@example.com", "send_at": "2030-01-01T10:00:00Z"}
        first = FakeStream([
            SimpleNamespace(type="response.output_item.done", item=SimpleNamespace(type="function_call", call_id="call", name="gmail_send_email", arguments=json.dumps(parameters))),
            SimpleNamespace(type="response.completed", response=SimpleNamespace(id="response-1", usage={"input_tokens": 10, "output_tokens": 5})),
        ])
        second = FakeStream([SimpleNamespace(type="response.completed", response=SimpleNamespace(id="response-2", usage={"input_tokens": 10, "output_tokens": 5}))])
        runner = ResponsesRunner(hindsight=SimpleNamespace(check_health=lambda: False))
        runner.tavily = SimpleNamespace(is_configured=False)
        runner.client = SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=[first, second])))
        with patch("backend.responses_runner.load_dotenv"), patch("backend.google_service.google_workspace.is_connected", return_value=True), patch("backend.google_service.google_workspace._job_account", return_value="owner@example.com"), patch("backend.google_service.google_workspace.send_email") as sender:
            events = [event async for event in runner.stream_turn("system", [], "main", model="gpt-5.4-mini")]
        proposal = next(json.loads(event["data"]) for event in events if event["event"] == "action_proposal")
        self.assertEqual(proposal["parameters"], {**parameters, "_account_email": "owner@example.com"})
        sender.assert_not_called()
        self.assertEqual(database.get_staged_action(proposal["id"])["status"], "pending")

    async def test_regeneration_blocks_mutating_tool_calls_even_if_model_requests_them(self):
        from backend.responses_runner import ResponsesRunner

        first = FakeStream([
            SimpleNamespace(type="response.output_item.done", item=SimpleNamespace(type="function_call", call_id="call", name="gcal_create_event", arguments='{"summary":"Event"}')),
            SimpleNamespace(type="response.completed", response=SimpleNamespace(id="response-1", usage={"input_tokens": 10, "output_tokens": 5})),
        ])
        second = FakeStream([SimpleNamespace(type="response.completed", response=SimpleNamespace(id="response-2", usage={"input_tokens": 10, "output_tokens": 5}))])
        runner = ResponsesRunner(hindsight=SimpleNamespace(check_health=lambda: False))
        runner.tavily = SimpleNamespace(is_configured=False)
        runner.client = SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=[first, second])))
        with patch("backend.responses_runner.load_dotenv"), patch("backend.google_service.google_workspace.execute_tool") as executor:
            events = [event async for event in runner.stream_turn("system", [], "main", model="gpt-5.4-mini", read_only=True)]
        executor.assert_not_called()
        self.assertTrue(events)


if __name__ == "__main__":
    unittest.main()
