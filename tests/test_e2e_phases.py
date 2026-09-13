"""
End-to-End Validation Test for Velocity Phases 1, 2, and 3
Tests:
1. Health check (Backend, Hindsight, SQLite)
2. Session CRUD (Creation, sticky toggles, deletion)
3. Turn Execution & Buffered SSE Streaming
4. Unconditional Recall and Synchronous Retain loop
5. SQLite Persistence & FTS5 Global Search
6. Temporary Session Ephemeral Guarantees
"""

import sys
import json
import uuid
import requests

BASE_URL = "http://localhost:8000"


def test_health():
    print("\n--- 1. Testing Health Endpoint ---")
    resp = requests.get(f"{BASE_URL}/health", timeout=5)
    assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
    data = resp.json()
    print("Health response:", data)
    assert data["backend"] == "healthy"
    assert data["database"] == "healthy"
    assert data["hindsight"] == "healthy"
    print("✓ Health check passed!")


def test_session_lifecycle():
    print("\n--- 2. Testing Session Lifecycle & Sticky Toggles ---")
    sess_id = f"test-sess-{uuid.uuid4().hex[:8]}"
    
    # Create session
    resp = requests.post(f"{BASE_URL}/sessions", json={
        "id": sess_id,
        "name": "Validation Session",
        "recall_budget": "medium",
        "thinking_effort": "low",
    }, timeout=5)
    assert resp.status_code == 200
    sess = resp.json()
    assert sess["id"] == sess_id
    assert sess["name"] == "Validation Session"
    assert sess["recall_budget"] == "medium"
    assert sess["thinking_effort"] == "low"
    print("Created session:", sess["name"], sess["id"])

    # Update session sticky toggle
    patch_resp = requests.patch(f"{BASE_URL}/sessions/{sess_id}", json={
        "name": "Updated Validation Session",
        "recall_budget": "high",
    }, timeout=5)
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["name"] == "Updated Validation Session"
    assert updated["recall_budget"] == "high"
    assert updated["thinking_effort"] == "low"
    print("Updated sticky toggle:", updated["recall_budget"])

    # List sessions
    list_resp = requests.get(f"{BASE_URL}/sessions", timeout=5)
    assert list_resp.status_code == 200
    sessions = list_resp.json()
    assert any(s["id"] == sess_id for s in sessions)
    print("✓ Session lifecycle passed!")
    return sess_id


def stream_turn(session_id: str, message: str, is_temporary: bool = False):
    url = f"{BASE_URL}/chat/stream"
    payload = {
        "session_id": session_id,
        "message": message,
        "is_temporary": is_temporary,
    }
    
    events = []
    full_text = ""
    memory_status = None
    usage = {}

    with requests.post(url, json=payload, stream=True, timeout=120) as r:
        assert r.status_code == 200, f"Chat stream failed: {r.status_code} {r.text}"
        current_event = None
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("event: "):
                current_event = line[len("event: "):].strip()
            elif line.startswith("data: "):
                data_str = line[len("data: "):].strip()
                try:
                    data_obj = json.loads(data_str)
                except Exception:
                    data_obj = {"raw": data_str}

                events.append((current_event, data_obj))
                if current_event == "delta":
                    text_delta = data_obj.get("text", "")
                    full_text += text_delta
                    print(text_delta, end="", flush=True)
                elif current_event == "complete":
                    memory_status = data_obj.get("memory_status")
                    usage = data_obj.get("usage", {})
                    full_text = data_obj.get("text", full_text)

    print()
    return {
        "events": events,
        "full_text": full_text,
        "memory_status": memory_status,
        "usage": usage,
    }


def test_turn_retain_and_recall(sess_id: str):
    print("\n--- 3. Testing Turn 1: Storing Fact via Retain ---")
    print("User: I am designing an autonomous carbon-fiber solar glider called 'Zephyr-9'.")
    res1 = stream_turn(sess_id, "I am designing an autonomous carbon-fiber solar glider called 'Zephyr-9'.")
    print(f"\nTurn 1 finished. Memory Status: {res1['memory_status']}")
    assert res1["memory_status"] in ("ok", "degraded")
    assert len(res1["full_text"]) > 0

    print("\n--- 4. Testing Turn 2: Recalling Stored Fact ---")
    print("User: What is the exact name and type of the glider I am designing?")
    res2 = stream_turn(sess_id, "What is the exact name and type of the glider I am designing?")
    print(f"\nTurn 2 finished. Memory Status: {res2['memory_status']}")
    assert "Zephyr" in res2["full_text"], f"Expected 'Zephyr' in response, got: {res2['full_text']}"
    print("✓ Fact recall verified in Luna's response!")


def test_fts5_search():
    print("\n--- 5. Testing SQLite FTS5 Global Search ---")
    resp = requests.get(f"{BASE_URL}/search", params={"q": "Zephyr"}, timeout=5)
    assert resp.status_code == 200
    hits = resp.json()
    print(f"Found {len(hits)} FTS5 matches for 'Zephyr'")
    assert len(hits) >= 1
    hit = hits[0]
    print("Hit snippet:", hit["snippet"])
    assert "Zephyr" in hit["content"] or "Zephyr" in hit["snippet"]
    print("✓ FTS5 full-text search passed!")


def test_temporary_session():
    print("\n--- 6. Testing Ephemeral Temporary Session ---")
    temp_id = f"temp-{uuid.uuid4().hex[:8]}"
    print("User (Temp session): Testing temporary isolation.")
    res = stream_turn(temp_id, "Testing temporary isolation.", is_temporary=True)
    assert len(res["full_text"]) > 0

    # Verify not in SQLite
    list_resp = requests.get(f"{BASE_URL}/sessions", timeout=5)
    sessions = list_resp.json()
    assert not any(s["id"] == temp_id for s in sessions), "Temporary session must NOT be in SQLite!"

    # Verify messages not in SQLite
    search_resp = requests.get(f"{BASE_URL}/search", params={"q": "isolation"}, timeout=5)
    hits = [h for h in search_resp.json() if h["session_id"] == temp_id]
    assert len(hits) == 0, "Temporary session messages must NOT be in SQLite FTS5!"
    print("✓ Ephemeral isolation verified!")


def main():
    print("==================================================")
    print("   Running Velocity End-to-End Test Suite        ")
    print("==================================================")
    try:
        test_health()
        sess_id = test_session_lifecycle()
        test_turn_retain_and_recall(sess_id)
        test_fts5_search()
        test_temporary_session()
        print("\n==================================================")
        print("   ALL PHASES 1, 2, AND 3 TESTS PASSED! 🎉        ")
        print("==================================================")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
