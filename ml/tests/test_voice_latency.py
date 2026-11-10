import json

from blunderprint_ml.voice_latency import summarize, main


def _session(model, totals):
    return {"model": model, "startedAt": "2026-11-10T00:00:00Z",
            "reports": [{"total_latency": t, "tts_latency": t / 4} for t in totals],
            "functionCalls": [{"name": "get_report", "at": 0}]}


def test_summarize_groups_by_model_and_computes_percentiles():
    out = summarize([_session("a", [1.0, 2.0, 3.0, 4.0]), _session("a", [5.0]), _session("b", [0.5])])
    assert out["a"]["turns"] == 5
    assert out["a"]["function_calls"] == 2
    assert out["a"]["total_latency"] == {"p50": 3.0, "p95": 4.8, "n": 5}
    assert out["b"]["total_latency"]["n"] == 1


def test_missing_metrics_are_skipped_not_zeroed():
    s = {"model": "a", "startedAt": "", "reports": [{}, {"stt_latency": 0.2}], "functionCalls": []}
    out = summarize([s])
    assert out["a"]["turns"] == 2
    assert out["a"]["stt_latency"] == {"p50": 0.2, "p95": 0.2, "n": 1}
    assert "total_latency" not in out["a"]


def test_cli_reads_a_directory_and_writes_json(tmp_path):
    d = tmp_path / "sessions"
    d.mkdir()
    (d / "s1.json").write_text(json.dumps(_session("a", [1.0, 3.0])))
    out = tmp_path / "voice_latency.json"
    main([str(d), "--out", str(out)])
    data = json.loads(out.read_text())
    assert data["models"]["a"]["total_latency"]["p50"] == 2.0
    assert data["sessions"] == ["s1.json"]
