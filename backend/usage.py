import json
import os
import re
import uuid
from openai import APIStatusError
from contextlib import contextmanager
from datetime import datetime, timezone

from backend.database import get_connection


DEFAULT_PRICES = {
    "gpt-5.4-mini": {"input": 0.75, "cached_input": 0.075, "output": 4.5},
    "gpt-5.4": {"input": 2.5, "cached_input": 0.25, "output": 15.0},
    "gpt-4o-mini": {"input": 0.15, "cached_input": 0.075, "output": 0.6},
}


@contextmanager
def transaction():
    connection = get_connection()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_usage():
    with transaction() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS usage_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                prices_json TEXT NOT NULL DEFAULT '{}'
            );
            INSERT OR IGNORE INTO usage_settings(id) VALUES (1);
            CREATE TABLE IF NOT EXISTS usage_calls (
                id TEXT PRIMARY KEY, response_id TEXT, model TEXT NOT NULL,
                source TEXT NOT NULL, session_id TEXT, created_at TEXT NOT NULL,
                status TEXT NOT NULL, reserved_usd REAL NOT NULL DEFAULT 0,
                cost_usd REAL, input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens INTEGER NOT NULL DEFAULT 0,
                cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_reported INTEGER NOT NULL DEFAULT 0,
                cache_reported INTEGER NOT NULL DEFAULT 0,
                rates_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_calls(created_at);
        """)
        connection.execute("UPDATE usage_calls SET status='unreported' WHERE status='pending'")


def settings(connection=None):
    owned = connection is None
    connection = connection or get_connection()
    try:
        row = dict(connection.execute("SELECT * FROM usage_settings WHERE id = 1").fetchone())
        base_url = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        prices = dict(DEFAULT_PRICES) if base_url == "https://api.openai.com/v1" else {}
        prices.update(json.loads(os.getenv("USAGE_MODEL_PRICES", "{}")))
        prices.update(json.loads(row.pop("prices_json")))
        row.pop("id")
        row.pop("daily_limit_usd", None)
        row.pop("monthly_limit_usd", None)
        return {**row, "prices": prices, "currency": "USD", "period_timezone": "UTC"}
    finally:
        if owned:
            connection.close()


def update_settings(prices):
    with transaction() as connection:
        connection.execute("UPDATE usage_settings SET prices_json=? WHERE id=1", (json.dumps(prices),))
    return settings()


def estimate_tokens(value):
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8")) + 1024


def model_rates(model, config):
    dated = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", model)
    return config["prices"].get(model, config["prices"].get(dated))


def reserve_call(model, source, session_id, input_value, max_output_tokens):
    connection = get_connection()
    try:
        connection.execute("BEGIN IMMEDIATE")
        config = settings(connection)
        rates = model_rates(model, config)
        input_bound = estimate_tokens(input_value)
        multiplier = 2 if model.startswith("gpt-5.4") and model != "gpt-5.4-mini" and input_bound > 272000 else 1
        reserved = 0 if rates is None else (input_bound * rates["input"] * multiplier + max_output_tokens * rates["output"] * (1.5 if multiplier == 2 else 1)) / 1_000_000
        now = datetime.now(timezone.utc).isoformat()
        call_id = str(uuid.uuid4())
        connection.execute("INSERT INTO usage_calls(id,model,source,session_id,created_at,status,reserved_usd,rates_json) VALUES(?,?,?,?,?,'pending',?,?)", (call_id, model, source, session_id, now, reserved, json.dumps(rates or {})))
        connection.commit()
        return call_id
    finally:
        connection.close()


def normalize_usage(usage):
    data = usage.model_dump() if hasattr(usage, "model_dump") else (usage or {})
    input_details = data.get("input_tokens_details") or data.get("prompt_tokens_details") or {}
    output_details = data.get("output_tokens_details") or data.get("completion_tokens_details") or {}
    input_tokens = int(data.get("input_tokens", data.get("prompt_tokens", 0)) or 0)
    output_tokens = int(data.get("output_tokens", data.get("completion_tokens", 0)) or 0)
    return {
        "input_tokens": input_tokens, "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cached_tokens": int(input_details.get("cached_tokens", 0) or 0),
        "cache_write_tokens": int(input_details.get("cache_write_tokens", 0) or 0),
        "reasoning_tokens": int(output_details.get("reasoning_tokens", 0) or 0),
        "cache_reported": int("cached_tokens" in input_details),
        "reasoning_reported": int("reasoning_tokens" in output_details),
    }


def finish_call(call_id, usage, response_id=None, model=None):
    metrics = normalize_usage(usage)
    with transaction() as connection:
        row = connection.execute("SELECT model,rates_json,status FROM usage_calls WHERE id=?", (call_id,)).fetchone()
        if row is None or row["status"] == "completed":
            return metrics
        rates = json.loads(row["rates_json"])
        actual_model = model or row["model"]
        if actual_model != row["model"]:
            rates = model_rates(actual_model, settings(connection)) or {}
            connection.execute("UPDATE usage_calls SET model=?,rates_json=? WHERE id=?", (actual_model, json.dumps(rates), call_id))
        cost = None
        if rates:
            cached = min(metrics["cached_tokens"], metrics["input_tokens"])
            writes = min(metrics["cache_write_tokens"], metrics["input_tokens"] - cached)
            uncached = metrics["input_tokens"] - cached - writes
            long_context = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", actual_model) == "gpt-5.4" and metrics["input_tokens"] > 272000
            cost = (uncached * rates["input"] + cached * rates["cached_input"] + writes * rates.get("cache_write", rates["input"]) + metrics["output_tokens"] * rates["output"] * (1.5 if long_context else 1)) / 1_000_000
            if long_context:
                cost += (uncached * rates["input"] + cached * rates["cached_input"]) / 1_000_000
        connection.execute("""UPDATE usage_calls SET status='completed',response_id=?,cost_usd=?,input_tokens=?,output_tokens=?,cached_tokens=?,cache_write_tokens=?,reasoning_tokens=?,cache_reported=?,reasoning_reported=? WHERE id=?""", (response_id, cost, metrics["input_tokens"], metrics["output_tokens"], metrics["cached_tokens"], metrics["cache_write_tokens"], metrics["reasoning_tokens"], metrics["cache_reported"], metrics["reasoning_reported"], call_id))
    return metrics


def mark_call(call_id, status):
    with transaction() as connection:
        connection.execute("UPDATE usage_calls SET status=? WHERE id=? AND status='pending'", (status, call_id))


def call_chat_completion(client, source, session_id=None, **kwargs):
    call_id = reserve_call(kwargs["model"], source, session_id, kwargs["messages"], kwargs.get("max_completion_tokens", kwargs.get("max_tokens", 1000)))
    try:
        response = client.chat.completions.create(**kwargs)
        if response.usage is not None:
            finish_call(call_id, response.usage, response.id, getattr(response, "model", None))
        else:
            mark_call(call_id, "unreported")
        return response
    except Exception as error:
        mark_call(call_id, "failed" if isinstance(error, APIStatusError) and error.status_code < 500 else "unreported")
        raise


def usage_stats():
    now = datetime.now(timezone.utc).isoformat()
    connection = get_connection()
    try:
        rows = [dict(row) for row in connection.execute("SELECT * FROM usage_calls ORDER BY created_at DESC")]
    finally:
        connection.close()

    def aggregate(selected):
        savings = 0
        for row in selected:
            rates = json.loads(row["rates_json"])
            if rates and row["status"] == "completed":
                multiplier = 2 if re.sub(r"-\d{4}-\d{2}-\d{2}$", "", row["model"]) == "gpt-5.4" and row["input_tokens"] > 272000 else 1
                savings += min(row["cached_tokens"], row["input_tokens"]) * (rates["input"] - rates["cached_input"]) * multiplier / 1_000_000
        result = {key: sum(row[key] for row in selected) for key in ("input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens", "reasoning_tokens", "cache_reported", "reasoning_reported")}
        cache_input = sum(row["input_tokens"] for row in selected if row["cache_reported"])
        reasoning_output = sum(row["output_tokens"] for row in selected if row["reasoning_reported"])
        result.update({
            "total_tokens": result["input_tokens"] + result["output_tokens"],
            "calls": len(selected), "cost_usd": sum(row["cost_usd"] or 0 for row in selected),
            "reserved_usd": sum(row["reserved_usd"] for row in selected if row["status"] in ("pending", "unreported")),
            "unpriced_calls": sum(row["cost_usd"] is None and row["status"] == "completed" for row in selected),
            "unreported_calls": sum(row["status"] == "unreported" for row in selected),
            "cache_hit_rate": result["cached_tokens"] / cache_input if cache_input else 0,
            "cache_savings_usd": savings,
            "cache_hit_calls": sum(row["cached_tokens"] > 0 for row in selected),
            "reasoning_share": result["reasoning_tokens"] / reasoning_output if reasoning_output else 0,
        })
        return result

    return {
        "settings": settings(), "today": aggregate([row for row in rows if row["created_at"] >= now[:10]]),
        "month": aggregate([row for row in rows if row["created_at"] >= now[:7]]), "all_time": aggregate(rows),
        "by_model": [{"model": model, **aggregate([row for row in rows if row["model"] == model])} for model in sorted({row["model"] for row in rows})],
        "by_source": [{"source": source, **aggregate([row for row in rows if row["source"] == source])} for source in sorted({row["source"] for row in rows})],
        "coverage": "Tracked model calls only. Hindsight internal LLM/embedding calls and external tool charges are excluded. USD costs are estimates from configured rates; interrupted calls retain a conservative reservation when usage is unavailable.",
    }
