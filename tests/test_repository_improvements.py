import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from backend import database, history, repository_tools, usage
from backend.pdf_service import SafeDocumentHTML, generate_artifact_pdf
from test_usage_recovery import DatabaseFixture, FakeStream


class RepositoryFixture(DatabaseFixture):
    def setUp(self):
        super().setUp()
        self.mirror = patch("backend.database.save_artifact_to_vault", return_value=None)
        self.mirror.start()

    def tearDown(self):
        self.mirror.stop()
        super().tearDown()


class RetrievalTests(RepositoryFixture, unittest.TestCase):
    def seed(self):
        database.create_thread("thread", "Calendar planning", initial_summary="Prepare calendar milestones")
        database.create_artifact("document", "thread", "Calendar report", "document", "The quarterly calendar planning report")
        database.add_message("message", "main", "user", "Calendar planning needs a report")

    def test_search_groups_canonical_documents_threads_and_messages(self):
        self.seed()
        result = repository_tools.search_repository("calendar plan")
        self.assertEqual({item["kind"] for item in result["results"]}, {"messages", "documents", "threads"})
        document = next(item for item in result["results"] if item["kind"] == "documents")
        self.assertEqual(document["session_id"], "thread")
        self.assertIn("\uE000", document["snippet"])

    def test_phrases_and_filters_are_literal_and_date_bounded(self):
        self.seed()
        self.assertEqual(repository_tools.search_repository('"calendar planning"', role="user")["results"][0]["message_id"], "message")
        self.assertFalse(repository_tools.search_repository('"planning calendar"')["results"])
        self.assertFalse(repository_tools.search_repository("calendar", role="assistant")["results"])
        self.assertFalse(repository_tools.search_repository("calendar", after="2099-01-01")["results"])
        self.assertEqual(len(repository_tools.search_repository("calendar", session_id="thread")["results"]), 2)
        for query in ("***", '"""', "calendar OR ' DROP TABLE messages --"):
            repository_tools.search_repository(query)

    def test_search_pages_have_no_duplicate_results(self):
        self.seed()
        for index in range(12):
            database.add_message(f"message-{index}", "main", "assistant", f"Calendar report {index}")
        offset = 0
        identities = []
        while True:
            result = repository_tools.search_repository("calendar", limit=3, offset=offset)
            identities.extend((item["kind"], item["id"]) for item in result["results"])
            if not result["has_more"]:
                break
            offset = result["next_offset"]
        self.assertEqual(len(identities), 15)
        self.assertEqual(len(set(identities)), 15)

    def test_indexes_follow_changes_deletions_and_existing_database_restarts(self):
        self.seed()
        database.update_artifact("document", content="Unique revision")
        database.update_session("thread", name="Unique topic")
        self.assertEqual({item["id"] for item in repository_tools.search_repository("unique")["results"]}, {"document", "thread"})
        database.delete_artifact("document")
        database.init_db()
        self.assertEqual([item["id"] for item in repository_tools.search_repository("unique")["results"]], ["thread"])

    def test_read_document_returns_latest_version_in_bounded_pages(self):
        self.seed()
        database.update_artifact("document", content="\n".join(f"Line {index}" for index in range(200)))
        result = repository_tools.read_artifact("document", limit=40)
        self.assertEqual(result["version"], 2)
        self.assertEqual(result["next_line"], 40)
        self.assertTrue(result["truncated"])
        following = repository_tools.read_artifact("document", start_line=result["next_line"], limit=40)
        self.assertTrue(following["content"].startswith("Line 40"))
        with self.assertRaises(LookupError):
            repository_tools.read_artifact("missing")

    def test_thread_reads_summary_first_and_messages_only_on_request(self):
        self.seed()
        for index in range(8):
            database.add_message(f"thread-{index}", "thread", "user", f"Original {index}")
        result = repository_tools.read_thread("thread")
        self.assertNotIn("messages", result)
        result = repository_tools.read_thread("thread", include_messages=True, limit=3)
        self.assertEqual([message["content"] for message in result["messages"]], ["Original 5", "Original 6", "Original 7"])
        older = repository_tools.read_thread("thread", include_messages=True, before=result["oldest_cursor"], limit=3)
        self.assertEqual(older["messages"][-1]["content"], "Original 4")
        with self.assertRaises(LookupError):
            repository_tools.read_thread("main")

    def test_threads_cannot_be_nested_or_branch_from_a_thread(self):
        self.seed()
        with self.assertRaises(ValueError):
            database.create_thread("nested", "Nested", parent_session_id="thread")
        database.add_message("thread-message", "thread", "user", "Branch this")
        with self.assertRaises(ValueError):
            history.branch_message("thread", "thread-message", "Nested")
        database.create_thread("sibling", "Sibling", parent_session_id="main")
        self.assertIsNotNone(database.get_thread("sibling"))

    def test_appearance_does_not_increment_content_version(self):
        self.seed()
        self.assertEqual(database.get_artifact("document")["theme"], "midnight")
        artifact = database.update_artifact("document", theme="midnight")
        self.assertEqual(artifact["theme"], "midnight")
        self.assertEqual(artifact["version"], 1)
        with self.assertRaises(ValueError):
            database.update_artifact("document", theme="sepia")

    def test_document_themes_survive_restart_and_new_documents_default_to_midnight(self):
        self.seed()
        for theme in ("editorial", "technical", "technical-dark"):
            with self.subTest(theme=theme):
                database.update_artifact("document", theme=theme)
                database.init_db()
                self.assertEqual(database.get_artifact("document")["theme"], theme)
        created = database.create_artifact("new-document", "main", "New document", "document", "Body")
        self.assertEqual(created["theme"], "midnight")
        self.assertEqual(database.get_artifact("new-document")["theme"], "midnight")
        self.assertEqual(database.get_artifact("document")["version"], 1)

    def test_document_mirrors_do_not_collide_and_renames_remove_only_owned_files(self):
        working_directory = os.getcwd()
        self.mirror.stop()
        try:
            os.chdir(self.directory.name)
            first = database.create_artifact("first", "main", "Same title", "document", "First body")
            second = database.create_artifact("second", "main", "Same title", "document", "Second body")
            self.assertNotEqual(first["file_path"], second["file_path"])
            renamed = database.update_artifact("first", title="New title")
            self.assertFalse(Path(first["file_path"]).exists())
            self.assertTrue(Path(second["file_path"]).exists())
            database.delete_artifact("first")
            self.assertFalse(Path(renamed["file_path"]).exists())
            self.assertTrue(Path(second["file_path"]).exists())
        finally:
            os.chdir(working_directory)
            self.mirror.start()


class CacheTests(RepositoryFixture, unittest.TestCase):
    def test_completed_request_prefix_is_preserved_without_duplicate_core_memory(self):
        from backend.prompt import compose_responses_input
        context = []
        with patch("backend.vault.get_core_context", return_value="Stable core memory"):
            _, initial = compose_responses_input([], None, ["Original recalled fact"], "First", turn_context_out=context)
        tools = [
            {"type": "function_call", "name": "read_artifact", "call_id": "call", "arguments": '{"artifact_id":"document"}'},
            {"type": "function_call_output", "call_id": "call", "output": '{"content":"Canonical document"}'},
        ]
        messages = [
            {"role": "user", "content": "First", "model_context": json.dumps(context)},
            {"role": "assistant", "content": "Answer", "model_context": json.dumps(tools)},
        ]
        with patch("backend.vault.get_core_context", return_value="Stable core memory"):
            _, following = compose_responses_input(messages, None, ["New recalled fact"], "Second")
        self.assertEqual(following[:len(initial)], initial)
        self.assertEqual(following[len(initial):len(initial) + 2], tools)
        self.assertEqual(sum(item.get("content") == "Stable core memory" for item in following), 1)
        self.assertIn("New recalled fact", following[-2]["content"])

    def test_changed_core_memory_is_appended_after_preserved_history(self):
        from backend.prompt import compose_responses_input
        messages = [{"role": "user", "content": "First", "model_context": [{"role": "system", "content": "Old memory"}]}]
        with patch("backend.vault.get_core_context", return_value="New memory"):
            _, items = compose_responses_input(messages, None, [], "Second")
        self.assertEqual([item["content"] for item in items], ["Old memory", "First", "New memory", "Second"])

    def test_provider_cache_usage_is_separated_by_conversation_and_tool_hop(self):
        for scope in ("main", "thread"):
            call = usage.reserve_call("gpt-5.4-mini", "chat", scope, {"instructions": "stable", "tools": []}, 100, conversation_kind=scope, hop=1)
            usage.finish_call(call, {"input_tokens": 1000, "output_tokens": 100, "input_tokens_details": {"cached_tokens": 750}})
        scopes = usage.usage_stats()["breakdowns"]["today"]["by_conversation"]
        self.assertEqual({row["conversation_kind"] for row in scopes}, {"main", "thread"})
        self.assertTrue(all(row["cache_hit_rate"] == 0.75 and row["prefix_variants"] == 1 and row["tool_hop_calls"] == 1 for row in scopes))

    def test_private_prompt_snapshots_are_not_downloaded_with_history(self):
        database.add_message("message", "main", "user", "Visible text")
        with usage.transaction() as connection:
            connection.execute("UPDATE messages SET model_context=? WHERE id='message'", (json.dumps([{"role": "system", "content": "Private memory"}]),))
        self.assertNotIn("model_context", history.message_page("main")["messages"][0])
        self.assertIn("Private memory", database.get_messages("main")[0]["model_context"])

    def test_existing_usage_is_backfilled_only_when_the_conversation_is_known(self):
        database.create_thread("thread", "Thread")
        for session_id, source in (("main", "chat"), ("thread", "chat"), ("main", "summary")):
            usage.reserve_call("gpt-5.4-mini", source, session_id, "Input", 100)
        usage.init_usage()
        self.assertEqual({row["conversation_kind"] for row in usage.usage_stats()["by_conversation"]}, {"main", "thread", "other"})


class ToolRunnerTests(RepositoryFixture, unittest.IsolatedAsyncioTestCase):
    async def test_read_tools_work_in_threads_and_are_replayed_as_paired_context(self):
        from backend.responses_runner import ResponsesRunner
        database.create_artifact("document", "main", "Title", "document", "Exact original text")
        first = FakeStream([
            SimpleNamespace(type="response.output_item.done", item=SimpleNamespace(type="function_call", call_id="call", name="read_artifact", arguments='{"artifact_id":"document"}')),
            SimpleNamespace(type="response.completed", response=SimpleNamespace(id="first", usage={"input_tokens": 100, "output_tokens": 10})),
        ])
        second = FakeStream([
            SimpleNamespace(type="response.output_text.delta", delta="Answer"),
            SimpleNamespace(type="response.completed", response=SimpleNamespace(id="second", usage={"input_tokens": 200, "output_tokens": 20})),
        ])
        with patch("backend.responses_runner.load_dotenv"):
            runner = ResponsesRunner(hindsight=SimpleNamespace(check_health=lambda: False))
            runner.tavily = SimpleNamespace(is_configured=False)
            runner.client = SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=[first, second])))
            events = [event async for event in runner.stream_turn("system", [], "thread", is_thread=True, read_only=True)]
        payload = json.loads(events[-1]["data"])
        self.assertEqual(payload["tool_context"][0]["type"], "function_call")
        self.assertIn("Exact original text", payload["tool_context"][1]["output"])
        tools = runner.client.responses.create.call_args_list[0].kwargs["tools"]
        self.assertIn("read_artifact", {tool["name"] for tool in tools})
        self.assertNotIn("propose_side_chat", {tool["name"] for tool in tools})
        self.assertNotIn("create_artifact", {tool["name"] for tool in tools})


class PdfTests(unittest.TestCase):
    def test_all_presets_support_unicode_italic_code_and_nested_lists(self):
        content = '# Résumé\n\n*Italic* **Bold** café — €\n\n- First\n    - Nested\n\n```c++\nif (value < 2) { print("<html>"); }\n```\n\n| Field | Value |\n|---|---|\n| Name | André |'
        for theme in ("editorial", "clean", "technical", "technical-dark", "midnight"):
            with self.subTest(theme=theme):
                result = generate_artifact_pdf("Unicode document", content, theme=theme)
                self.assertTrue(result.startswith(b"%PDF-"))
                self.assertIn(b"DejaVuSerif" if theme == "editorial" else b"DejaVuSans", result)

    def test_long_documents_and_tables_paginate(self):
        content = "| Number | Text |\n|---|---|\n" + "\n".join(f"| {index} | A longer row that must continue across pages. |" for index in range(160))
        result = generate_artifact_pdf("Long report", content)
        self.assertGreater(result.count(b"/Type /Page\n"), 1)

    def test_export_never_loads_remote_images_or_executes_raw_html(self):
        parser = SafeDocumentHTML()
        parser.feed('<p>Hello</p><img src="https://example.com/private"><script>secret</script><a href="javascript:alert(1)">Unsafe</a><pre>&lt;html&gt;</pre>')
        output = "".join(parser.parts)
        self.assertNotIn("example.com", output)
        self.assertNotIn("secret", output)
        self.assertNotIn("javascript", output)
        self.assertIn("&lt;html&gt;", output)

    def test_unknown_presets_are_rejected(self):
        with self.assertRaises(ValueError):
            generate_artifact_pdf("Title", "Body", theme="sepia")


class ContractTests(RepositoryFixture, unittest.IsolatedAsyncioTestCase):
    async def test_search_theme_and_nested_thread_routes(self):
        import httpx
        from backend.main import app
        database.create_thread("thread", "Calendar thread")
        database.create_artifact("document", "thread", "Calendar document", "document", "Calendar planning")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/search", params={"q": "calendar", "kind": "documents"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["results"][0]["id"], "document")
            response = await client.get("/api/search", params={"q": "calendar", "kind": "invalid"})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/api/threads", json={"name": "Nested", "parent_session_id": "thread"})
            self.assertEqual(response.status_code, 409)
            response = await client.patch("/api/artifacts/document", json={"theme": "technical"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["theme"], "technical")
            response = await client.get("/api/artifacts/document/export/pdf")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b"%PDF-"))
            response = await client.patch("/api/artifacts/document", json={"theme": "sepia"})
            self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
