import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from backend import database, turns, usage


class DatabaseFixture:
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "SQLITE_DB_PATH": os.path.join(self.directory.name, "test.db"),
            "OPENAI_API_KEY": "test-key",
            "OPENAI_BASE_URL": "https://api.openai.com/v1",
            "USAGE_MODEL_PRICES": "{}",
        })
        self.environment.start()
        self.dotenv = patch("dotenv.load_dotenv")
        self.dotenv.start()
        self.google = patch("backend.google_service.google_workspace.is_connected", return_value=False)
        self.google.start()
        database.init_db()
        usage.init_usage()
        turns.init_turns()

    def tearDown(self):
        self.google.stop()
        self.dotenv.stop()
        self.environment.stop()
        self.directory.cleanup()


class UsageTests(DatabaseFixture, unittest.TestCase):
    def test_daily_history_is_zero_filled_and_does_not_double_count_reasoning(self):
        current = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
        with patch("backend.usage.datetime") as clock:
            clock.now.return_value = current
            call_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
            usage.finish_call(call_id, {"input_tokens": 100, "output_tokens": 20, "output_tokens_details": {"reasoning_tokens": 10}})
            stats = usage.usage_stats()
        self.assertEqual(len(stats["daily"]), 30)
        self.assertEqual(stats["daily"][0]["date"], "2026-09-07")
        self.assertEqual(stats["daily"][-1]["date"], "2026-10-06")
        self.assertEqual(stats["daily"][-1]["total_tokens"], 120)
        self.assertEqual(sum(day["total_tokens"] for day in stats["daily"]), 120)
        self.assertEqual(stats["daily"][0]["calls"], 0)
        self.assertEqual(stats["daily"][-1]["cost_usd"], stats["today"]["cost_usd"])

    def test_breakdowns_follow_utc_periods_and_keep_legacy_all_time_fields(self):
        current = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
        dates = ["2026-10-06T00:00:00+00:00", "2026-09-30T23:59:59+00:00", "2025-01-01T00:00:00+00:00"]
        for date in dates:
            call_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
            usage.finish_call(call_id, {"input_tokens": 100, "output_tokens": 20})
            connection = database.get_connection()
            with connection:
                connection.execute("UPDATE usage_calls SET created_at=? WHERE id=?", (date, call_id))
            connection.close()
        with patch("backend.usage.datetime") as clock:
            clock.now.return_value = current
            stats = usage.usage_stats()
        self.assertEqual(stats["breakdowns"]["today"]["by_model"][0]["calls"], 1)
        self.assertEqual(stats["breakdowns"]["month"]["by_source"][0]["calls"], 1)
        self.assertEqual(stats["breakdowns"]["all_time"]["by_model"][0]["calls"], 3)
        self.assertEqual(stats["by_model"], stats["breakdowns"]["all_time"]["by_model"])
        self.assertEqual(sum(day["calls"] for day in stats["daily"]), 2)

    def test_daily_unknown_cost_is_explained_not_counted_as_actual_spending(self):
        call_id = usage.reserve_call("unknown-model", "scheduled", "main", "test", 100)
        usage.finish_call(call_id, {"input_tokens": 100, "output_tokens": 20})
        interrupted = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
        usage.mark_call(interrupted, "unreported")
        day = usage.usage_stats()["daily"][-1]
        self.assertEqual(day["unpriced_calls"], 1)
        self.assertEqual(day["unreported_calls"], 1)
        self.assertEqual(day["total_tokens"], 120)
        self.assertEqual(day["cost_usd"], 0)

    def test_empty_dashboard_has_no_fake_usage(self):
        stats = usage.usage_stats()
        self.assertTrue(all(day["calls"] == 0 and day["cost_usd"] == 0 for day in stats["daily"]))
        self.assertTrue(all(not entry["by_model"] and not entry["by_source"] for entry in stats["breakdowns"].values()))

    def test_cached_and_reasoning_tokens_are_not_billed_twice(self):
        call_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
        metrics = usage.finish_call(call_id, {
            "input_tokens": 1000, "output_tokens": 100,
            "input_tokens_details": {"cached_tokens": 800},
            "output_tokens_details": {"reasoning_tokens": 60},
        }, "response-1")
        usage.finish_call(call_id, metrics, "response-1")
        stats = usage.usage_stats()["today"]
        self.assertEqual(stats["calls"], 1)
        self.assertEqual(stats["total_tokens"], 1100)
        self.assertEqual(stats["reasoning_tokens"], 60)
        self.assertEqual(stats["cache_hit_rate"], 0.8)
        self.assertEqual(stats["reasoning_share"], 0.6)
        self.assertAlmostEqual(stats["cost_usd"], 0.00066)
        self.assertAlmostEqual(stats["cache_savings_usd"], 0.00054)
        self.assertEqual(stats["reserved_usd"], 0)

    def test_chat_completion_usage_and_missing_detail_reporting(self):
        metrics = usage.normalize_usage({
            "prompt_tokens": 900, "completion_tokens": 70,
            "prompt_tokens_details": {"cached_tokens": 300},
            "completion_tokens_details": {"reasoning_tokens": 20},
        })
        self.assertEqual(metrics["total_tokens"], 970)
        self.assertEqual(metrics["reasoning_tokens"], 20)
        self.assertEqual(metrics["cached_tokens"], 300)
        missing = usage.normalize_usage({"input_tokens": 10, "output_tokens": 5})
        self.assertEqual(missing["cache_reported"], 0)
        self.assertEqual(missing["reasoning_reported"], 0)

    def test_proxy_does_not_assume_official_prices(self):
        with patch.dict(os.environ, {"OPENAI_BASE_URL": "https://custom.example/v1"}):
            call_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
            usage.finish_call(call_id, {"input_tokens": 10, "output_tokens": 5})
            self.assertEqual(usage.usage_stats()["today"]["unpriced_calls"], 1)
            usage.update_settings({"gpt-5.4-mini": {"input": 1, "cached_input": 0.1, "output": 2}})
            next_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
            usage.finish_call(next_id, {"input_tokens": 10, "output_tokens": 5})
            self.assertAlmostEqual(usage.usage_stats()["today"]["cost_usd"], 0.00002)

    def test_actual_model_and_dated_models_are_recorded(self):
        call_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
        usage.finish_call(call_id, {"input_tokens": 100, "output_tokens": 10}, model="gpt-5.4-2026-03-05")
        model = usage.usage_stats()["by_model"][0]
        self.assertEqual(model["model"], "gpt-5.4-2026-03-05")
        self.assertAlmostEqual(model["cost_usd"], 0.0004)

    def test_interrupted_calls_do_not_pretend_to_have_zero_usage(self):
        call_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
        usage.mark_call(call_id, "unreported")
        stats = usage.usage_stats()["today"]
        self.assertEqual(stats["unreported_calls"], 1)
        self.assertGreater(stats["reserved_usd"], 0)
        self.assertEqual(stats["cost_usd"], 0)

    def test_failed_calls_release_estimates_and_restart_marks_unknown(self):
        failed_id = usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
        usage.mark_call(failed_id, "failed")
        self.assertEqual(usage.usage_stats()["today"]["reserved_usd"], 0)
        usage.reserve_call("gpt-5.4-mini", "chat", "main", "test", 100)
        usage.init_usage()
        self.assertEqual(usage.usage_stats()["today"]["unreported_calls"], 1)

    def test_periods_and_source_breakdowns(self):
        call_id = usage.reserve_call("gpt-5.4-mini", "scheduled", "main", "test", 100)
        usage.finish_call(call_id, {"input_tokens": 10, "output_tokens": 5})
        with usage.transaction() as connection:
            connection.execute("UPDATE usage_calls SET created_at='2000-01-01T00:00:00+00:00'")
        stats = usage.usage_stats()
        self.assertEqual(stats["today"]["calls"], 0)
        self.assertEqual(stats["month"]["calls"], 0)
        self.assertEqual(stats["all_time"]["calls"], 1)
        self.assertEqual(stats["by_source"][0]["source"], "scheduled")


class TurnTests(DatabaseFixture, unittest.IsolatedAsyncioTestCase):
    async def test_metadata_survives_cancellation(self):
        turns.claim_turn("turn-1", "main", "hello")
        artifact = database.create_artifact("artifact-1", "main", "Document", "document", "body")
        action = database.create_staged_action("action-1", "main", "gmail", "send_email", {"to": "test@example.com"})
        turns.save_event("turn-1", {"event": "artifact_created", "data": json.dumps(artifact)})
        turns.save_event("turn-1", {"event": "action_proposal", "data": json.dumps(action)})
        turns.save_event("turn-1", {"event": "thread_proposal", "data": json.dumps({"title": "Thread", "status": "pending"})})
        turns.finish_turn("turn-1", "cancelled")
        message = database.get_messages("main")[-1]
        self.assertEqual(message["artifact_id"], "artifact-1")
        self.assertEqual(json.loads(message["thread_proposal"])["title"], "Thread")
        self.assertEqual(database.get_staged_action("action-1")["message_id"], message["id"])

    async def test_duplicate_requests_and_cursor_replay(self):
        _, created = turns.claim_turn("turn-1", "main", "hello")
        self.assertTrue(created)
        _, created = turns.claim_turn("turn-1", "main", "hello")
        self.assertFalse(created)
        with self.assertRaises(ValueError):
            turns.claim_turn("turn-1", "main", "different")
        with self.assertRaises(ValueError):
            turns.claim_turn("turn-2", "main", "another")
        turns.save_event("turn-1", {"event": "delta", "data": json.dumps({"text": "Hello "})})
        turns.save_event("turn-1", {"event": "delta", "data": json.dumps({"text": "world"})})
        turns.finish_turn("turn-1", "completed")
        events = [event async for event in turns.replay_events("turn-1", after=1)]
        self.assertEqual(len(events), 1)
        self.assertEqual(json.loads(events[0]["data"])["text"], "world")
        messages = database.get_messages("main")
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[-1]["content"], "Hello world")
        self.assertEqual(turns.enrich_message(messages[-1])["turn_status"], "completed")

    async def test_cancellation_keeps_partial_text(self):
        turns.claim_turn("turn-1", "main", "hello")
        reached = asyncio.Event()

        async def generator():
            yield {"event": "delta", "data": json.dumps({"text": "partial"})}
            reached.set()
            await asyncio.sleep(60)

        task = asyncio.create_task(turns.run_turn("turn-1", generator()))
        turns.tasks["turn-1"] = task
        await reached.wait()
        task.cancel()
        await task
        self.assertEqual(turns.get_turn("turn-1")["status"], "cancelled")
        self.assertEqual(database.get_messages("main")[-1]["content"], "partial")
        events = [event async for event in turns.replay_events("turn-1")]
        self.assertEqual(events[-1]["event"], "cancelled")

    async def test_restart_preserves_and_marks_interrupted_turn(self):
        turns.claim_turn("turn-1", "main", "hello")
        turns.save_event("turn-1", {"event": "delta", "data": json.dumps({"text": "partial"})})
        turns.init_turns()
        self.assertEqual(turns.get_turn("turn-1")["status"], "interrupted")
        events = [event async for event in turns.replay_events("turn-1")]
        self.assertEqual(events[-1]["event"], "error")
        self.assertEqual(database.get_messages("main")[-1]["content"], "partial")


class FakeStream:
    def __init__(self, events):
        self.events = iter(events)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.events)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


class RunnerTests(DatabaseFixture, unittest.IsolatedAsyncioTestCase):
    async def test_cancelling_closes_the_upstream_stream(self):
        ready = asyncio.Event()

        class BlockingStream(FakeStream):
            async def __anext__(self):
                ready.set()
                await asyncio.sleep(60)
                raise StopAsyncIteration

        stream = BlockingStream([])
        task = asyncio.create_task(self.run_events(self.runner([stream])))
        await ready.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(stream.closed)
        self.assertEqual(usage.usage_stats()["today"]["unreported_calls"], 1)

    def runner(self, streams):
        from backend.responses_runner import ResponsesRunner
        runner = ResponsesRunner(hindsight=SimpleNamespace(check_health=lambda: False))
        runner.tavily = SimpleNamespace(is_configured=False)
        runner.client = SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=streams)))
        return runner

    async def run_events(self, runner):
        with patch("backend.responses_runner.load_dotenv"):
            return [event async for event in runner.stream_turn("system", [], "main", model="gpt-5.4-mini")]

    async def test_usage_sums_every_tool_hop(self):
        first = FakeStream([
            SimpleNamespace(type="response.output_item.done", item=SimpleNamespace(type="function_call", call_id="call-1", name="unknown", arguments="{}")),
            SimpleNamespace(type="response.completed", response=SimpleNamespace(id="response-1", usage={"input_tokens": 100, "output_tokens": 20, "output_tokens_details": {"reasoning_tokens": 10}})),
        ])
        second = FakeStream([
            SimpleNamespace(type="response.output_text.delta", delta="answer"),
            SimpleNamespace(type="response.completed", response=SimpleNamespace(id="response-2", usage={"input_tokens": 150, "output_tokens": 30, "input_tokens_details": {"cached_tokens": 100}, "output_tokens_details": {"reasoning_tokens": 5}})),
        ])
        events = await self.run_events(self.runner([first, second]))
        total = json.loads(events[-1]["data"])["usage"]
        self.assertEqual(events[-1]["event"], "done")
        self.assertEqual(total["total_tokens"], 300)
        self.assertEqual(total["reasoning_tokens"], 15)
        self.assertEqual(total["cached_tokens"], 100)
        self.assertEqual(usage.usage_stats()["today"]["calls"], 2)
        self.assertTrue(first.closed and second.closed)

    async def test_stream_end_without_terminal_is_not_success(self):
        stream = FakeStream([SimpleNamespace(type="response.output_text.delta", delta="partial")])
        events = await self.run_events(self.runner([stream]))
        self.assertEqual(events[-1]["event"], "error")
        self.assertEqual(events[0]["event"], "delta")
        self.assertEqual(usage.usage_stats()["today"]["unreported_calls"], 1)
        self.assertTrue(stream.closed)

    async def test_output_limit_keeps_tail_and_actual_usage(self):
        stream = FakeStream([
            SimpleNamespace(type="response.output_text.delta", delta="partial"),
            SimpleNamespace(type="response.incomplete", response=SimpleNamespace(id="response-1", usage={"input_tokens": 100, "output_tokens": 10})),
        ])
        events = await self.run_events(self.runner([stream]))
        self.assertEqual(events[-1]["event"], "error")
        self.assertEqual(events[0]["event"], "delta")
        self.assertEqual(usage.usage_stats()["today"]["output_tokens"], 10)


class ContextTests(DatabaseFixture, unittest.IsolatedAsyncioTestCase):
    async def test_unsummarized_history_is_not_silently_discarded(self):
        from backend.prompt import compose_responses_input
        history = [{"role": "user", "content": f"message-{index}"} for index in range(40)]
        with patch("backend.vault.get_core_context", return_value="volatile memory"):
            instructions, items = compose_responses_input(history, None, [], "new message")
        self.assertIn("message-0", [item["content"] for item in items])
        self.assertNotIn("volatile memory", instructions)
        self.assertGreater(next(index for index, item in enumerate(items) if item["content"] == "volatile memory"), 39)

    async def test_incremental_summary_covers_new_segments_once(self):
        with patch("dotenv.load_dotenv"):
            from backend import main
        for index in range(40):
            database.add_message(f"message-{index}", "main", "user" if index % 2 == 0 else "assistant", f"content-{index}")
        segments = []

        def summarize(existing, messages):
            segments.append([message["id"] for message in messages])
            return f"summary-{len(segments)}"

        async def model_stream(**kwargs):
            yield {"event": "delta", "data": json.dumps({"text": "answer"})}
            yield {"event": "done", "data": json.dumps({"text": "answer", "usage": {"total_tokens": 100}})}

        from starlette.requests import Request
        http_request = Request({"type": "http", "headers": []})
        with patch.object(main, "generate_summary", side_effect=summarize), patch.object(main.hindsight_client, "recall", return_value=([], "ok")), patch.object(main.hindsight_client, "get_hot_context", return_value={}), patch.object(main.hindsight_client, "retain_turn", return_value="ok"), patch.object(main.responses_runner, "stream_turn", side_effect=model_stream), patch("backend.vault.get_core_context", return_value=""):
            response = await main.chat_stream(main.ChatRequest(session_id="main", message="first", message_id="turn-1"), http_request)
            events = [event async for event in response.body_iterator]
            self.assertEqual(events[-1]["event"], "complete")
            response = await main.chat_stream(main.ChatRequest(session_id="main", message="second", message_id="turn-2"), http_request)
            events = [event async for event in response.body_iterator]
            self.assertEqual(events[-1]["event"], "complete")
            await asyncio.sleep(0)
        self.assertEqual(segments[0], [f"message-{index}" for index in range(24)])
        self.assertEqual(len(segments), 1)
        self.assertEqual(len(database.get_messages("main")), 44)


class ContractTests(DatabaseFixture, unittest.IsolatedAsyncioTestCase):
    async def test_usage_routes_and_validation(self):
        import httpx
        from backend.main import app
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/usage")
            self.assertEqual(response.status_code, 200)
            self.assertIn("reasoning_tokens", response.json()["today"])
            self.assertNotIn("daily_limit_usd", response.json()["settings"])
            response = await client.put("/api/usage/prices", json={"prices": {"custom": {"input": 1, "cached_input": 0.1, "output": 2}}})
            self.assertEqual(response.status_code, 200)
            response = await client.put("/api/usage/prices", json={"prices": {"custom": {"input": -1, "cached_input": 0.1, "output": 2}}})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/chat/stream", json={"session_id": "main", "message": " "})
            self.assertEqual(response.status_code, 422)

    async def test_history_and_cancel_contracts(self):
        import httpx
        from backend.main import app
        turns.claim_turn("turn-1", "main", "hello")
        turns.save_event("turn-1", {"event": "delta", "data": json.dumps({"text": "partial"})})
        turns.finish_turn("turn-1", "interrupted", "Server restart")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/sessions/main")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["messages"][-1]["turn_status"], "interrupted")
            response = await client.post("/api/chat/turns/turn-1/cancel")
            self.assertEqual(response.status_code, 200)
            response = await client.post("/chat/stream", headers={"Last-Event-ID": "1"}, json={"session_id": "main", "message": "hello", "message_id": "turn-1"})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("event: delta", response.text)
            self.assertIn("event: error", response.text)
            self.assertEqual(len(database.get_messages("main")), 2)


if __name__ == "__main__":
    unittest.main()
