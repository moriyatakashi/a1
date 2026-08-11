import json
import function_app as fa
import azure.functions as func


def make_request(method, route, json_body=None, params=None):
    body = json.dumps(json_body).encode() if json_body is not None else b""
    return func.HttpRequest(method=method, url=f"http://localhost/api/{route}",
                            headers={}, params=params or {}, route_params={}, body=body)


def _new(pc_key="pc-secret", title="t", tags=None):
    return json.loads(fa.ba_log(make_request(
        "POST", "ba",
        json_body={"claude_key": pc_key, "type": "new", "title": title, "body": "b", "tags": tags or []},
    )).get_body())


def test_s6_is_public_no_auth_and_empty_by_default(tables):
    resp = fa.ba_tag_summary(make_request("GET", "s6"))
    assert resp.status_code == 200
    assert json.loads(resp.get_body()) == {"tags": {}}


def test_s6_groups_new_entries_by_free_tag(monkeypatch, tables):
    monkeypatch.setenv("BA_CLAUDE_KEY_PC", "pc-secret")
    a = _new(title="A", tags=["設計", "案件"])  # 案件は分類語なので集計から除外される
    b = _new(title="B", tags=["設計", "バグ"])

    body = json.loads(fa.ba_tag_summary(make_request("GET", "s6")).get_body())
    tags = body["tags"]

    assert "案件" not in tags
    assert {e["seq"] for e in tags["設計"]} == {a["seq"], b["seq"]}
    assert [e["title"] for e in tags["設計"]] == ["A", "B"]
    assert all(e["status"] == "open" for e in tags["設計"])
    assert {e["seq"] for e in tags["バグ"]} == {b["seq"]}


def test_s6_reflects_void_and_closed_status(monkeypatch, tables):
    monkeypatch.setenv("BA_CLAUDE_KEY_PC", "pc-secret")
    closed = _new(title="Closed one", tags=["設計"])
    voided = _new(title="Voided one", tags=["設計"])

    fa.ba_log(make_request("POST", "ba", json_body={
        "claude_key": "pc-secret", "type": "status", "status": "closed", "ref": closed["id"],
    }))
    fa.ba_log(make_request("POST", "ba", json_body={
        "claude_key": "pc-secret", "type": "void", "ref": voided["id"],
    }))

    body = json.loads(fa.ba_tag_summary(make_request("GET", "s6")).get_body())
    status_by_seq = {e["seq"]: e["status"] for e in body["tags"]["設計"]}
    assert status_by_seq[closed["seq"]] == "closed"
    assert status_by_seq[voided["seq"]] == "void"
