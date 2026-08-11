import json
from collections import defaultdict

import azure.functions as func

import function_app
from bp_ba import BA_TABLE, BA_SEQ_PARTITION, _ba_entry_dict

bp = func.Blueprint()

# ===== s6 / タグ集計ビュー (ba-260) — 読み取り専用の派生ビュー =====
# BaLogに新しいテーブルは足さない。newエントリのtagsを「タグ→[{seq,title,status}]」に
# 集約して返すだけ(POSTは無い)。フロント(src/w/s6.html)とrbook(run_ba.py)が
# 「全件fetchして自前で集計する」のをやめ、ここが返す軽量な結果をそのまま使う
# トークン節約が目的(ba-260の要件①)。
#
# classification(案件/確定仕様/...)はba/bb/rbookのclass:欄が担う別概念なので、
# ここでのタグはBA_CLASSIFICATIONSを除いた自由タグだけを対象にする
# (rbook run_ba.pyの_ba_free_tags/BA_CLASSIFICATIONSと同じ考え方をサーバー側にも複製)。
BA_CLASSIFICATIONS = ("案件", "確定仕様", "気づき", "保留論点", "旧仕様", "記録")


def _free_tags(tags):
    return [t for t in (tags or []) if t not in BA_CLASSIFICATIONS]


def _ba_thread_statuses(items):
    """threadIdごとにopen/closed/voidの3値を返す。判定ロジックはbp_ba._ba_open_thread_ids
    (void優先、次にstatusの最新値、無ければopen)と同じものを3値化して複製している。"""
    voided = set()
    for e in items:
        if e.get("type") != "void":
            continue
        if e.get("ref"):
            voided.add(e["ref"])
        if e.get("threadId"):
            voided.add(e["threadId"])

    latest_status = {}
    for e in items:
        if e.get("type") != "status":
            continue
        tid = e.get("ref")
        if not tid:
            continue
        created = e.get("createdAt", "")
        if tid not in latest_status or created > latest_status[tid][0]:
            latest_status[tid] = (created, e.get("status") or "open")

    statuses = {}
    for e in items:
        if e.get("type") != "new":
            continue
        tid = e["threadId"]
        if tid in voided:
            statuses[tid] = "void"
        else:
            statuses[tid] = latest_status.get(tid, ("", "open"))[1]
    return statuses


@bp.function_name(name="ba-tag-summary")
@bp.route(route="s6", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def ba_tag_summary(req: func.HttpRequest) -> func.HttpResponse:
    # baのGETと同じく無認証公開(読み取り専用の派生ビューなので、baより制限を強める理由がない)。
    table = function_app._table_client(BA_TABLE)
    items = [
        _ba_entry_dict(e) for e in table.list_entities()
        if e["PartitionKey"] != BA_SEQ_PARTITION
    ]
    statuses = _ba_thread_statuses(items)

    tags = defaultdict(list)
    for e in items:
        if e.get("type") != "new":
            continue
        tid = e["threadId"]
        for tag in _free_tags(e.get("tags")):
            tags[tag].append({
                "seq": e.get("seq"),
                "title": e.get("title") or "",
                "status": statuses.get(tid, "open"),
            })
    for entries in tags.values():
        entries.sort(key=lambda x: x["seq"] or 0)

    return func.HttpResponse(
        json.dumps({"tags": tags}, ensure_ascii=False),
        mimetype="application/json",
        headers={"Access-Control-Allow-Origin": "*"},
    )
