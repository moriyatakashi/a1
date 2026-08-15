# aa-lane -- Claudeレーン専用の最小HTTPSエンドポイント(P4、ba-242参照。2026-08-14にca-laneから改名)。
#
# 役割はclaude_keyの照合とFirestore(aaThreads)へのAdmin SDK書き込みだけ。
# 読み取り・人間の書き込みはこのFunctionを経由しない(aa.htmlからFirestoreへ直接、
# Security Rules(../../firestore.rules)が認可を担う)。
#
# ba(aa/api/function_app.py の _ba_claude_lane)と同じ判定パターン:
# AA_CLAUDE_KEY_PC / AA_CLAUDE_KEY_MOBILE のどちらと一致したかでby(claude-pc/claude-mobile)を決める。

import os
import json
from datetime import datetime, timezone

import functions_framework
import firebase_admin
from firebase_admin import firestore

if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client()

# 通し番号(seq)。baの_next_ba_seq(aa/api/bp_ba.py)と同じ「専用カウンタを
# アトミックにインクリメント」方式。Firestoreはトランザクションで
# read-modify-writeを保証できるので、新規スレッド作成と同じトランザクション内で
# カウンタ更新とスレッドsetを両方行い、採番の重複・欠番を防ぐ。
_AA_SEQ_COUNTER_REF = db.collection("_meta").document("aa_seq")


@firestore.transactional
def _create_thread_with_seq(transaction, doc_ref, thread_data):
    snapshot = _AA_SEQ_COUNTER_REF.get(transaction=transaction)
    current = snapshot.get("value") if snapshot.exists else 0
    seq = (current or 0) + 1
    transaction.set(_AA_SEQ_COUNTER_REF, {"value": seq})
    transaction.set(doc_ref, {**thread_data, "seq": seq})
    return seq


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def _json_response(payload, status=200):
    headers = {"Content-Type": "application/json", **CORS_HEADERS}
    return (json.dumps(payload, ensure_ascii=False), status, headers)


def _claude_lane(claude_key):
    """渡された鍵がPC用/スマホ用のどちらと一致するかを判定する。
    一致しなければNone(ba-244で指摘されたクライアント側の偏りは、
    サーバー側はba同様もとから両方チェックしているので踏襲するだけでよい)。"""
    if not claude_key:
        return None
    pc_key = os.environ.get("AA_CLAUDE_KEY_PC", "")
    mobile_key = os.environ.get("AA_CLAUDE_KEY_MOBILE", "")
    if pc_key and claude_key == pc_key:
        return "claude-pc"
    if mobile_key and claude_key == mobile_key:
        return "claude-mobile"
    return None


@functions_framework.http
def aa_lane(request):
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method != "POST":
        return _json_response({"error": "POST only"}, 405)

    body = request.get_json(silent=True) or {}

    by = _claude_lane(body.get("claude_key", ""))
    if not by:
        return _json_response({"error": "invalid or missing claude_key"}, 403)

    action = body.get("action")
    # c1.html設計方針「書き込みは--dry-run標準搭載」(ba-242 note)。dry_run=trueは
    # 検証(必須項目・rootless防止チェック)だけ行い、実際のset()は呼ばない。
    dry_run = bool(body.get("dry_run"))
    now = datetime.now(timezone.utc).isoformat()

    if action == "new":
        title = (body.get("title") or "").strip()
        if not title:
            return _json_response({"error": "title required"}, 400)
        # ba-289改訂(スキーマ見直し): statusは持たない(open/closedの概念自体なし)。
        # 代わりにba側のスレッドと1:1で紐づけるbaSeqを必須にする。baのlink(relSeq)と
        # 同じ「人間が呼ぶseq番号をそのまま持つ」形。TODO: 実在確認は今回未実装
        # (aa_laneはFirebase側、ba本体はAzure Table Storage側にあり、クラウドをまたいだ
        # 問い合わせが要る。ひとまず正の整数であることのみ検証)。
        ba_seq = body.get("baSeq")
        if not isinstance(ba_seq, int) or isinstance(ba_seq, bool) or ba_seq <= 0:
            return _json_response({"error": "baSeq must be a positive integer"}, 400)
        body_format = (body.get("bodyFormat") or "text").strip()
        if body_format not in ("text", "md", "html", "json", "other"):
            return _json_response({"error": f"invalid bodyFormat: {body_format}"}, 400)
        if dry_run:
            return _json_response({"ok": True, "dry_run": True, "by": by, "title": title})
        doc_ref = db.collection("aaThreads").document()
        seq = _create_thread_with_seq(db.transaction(), doc_ref, {
            "title": title,
            "body": body.get("body", ""),
            "bodyFormat": body_format,
            "tags": body.get("tags", ""),
            "baSeq": ba_seq,
            "by": by,
            "createdAt": now,
            "void": False,
        })
        return _json_response({"ok": True, "threadId": doc_ref.id, "seq": seq, "by": by})

    if action == "void":
        # ba-289改訂: baと紐づいた後に不要になったスレッドを退役させる。
        # 番号(seq)の再利用防止も兼ねる。内容フィールド(title/body/tags/bodyFormat)は
        # null化するが、メタ情報(createdAt/by)と、void判断の根拠でもあるbaSeqは残す
        # (「ゴミを消す/経緯は残す」の切り分け。3-8と同じ理屈をbaSeqにも適用)。
        thread_id = body.get("threadId")
        if not thread_id:
            return _json_response({"error": "threadId required"}, 400)
        thread_ref = db.collection("aaThreads").document(thread_id)
        if not thread_ref.get().exists:
            # rootless防止(note-addと同じ考え方)
            return _json_response({"error": "thread not found (rootless防止)", "threadId": thread_id}, 400)
        if dry_run:
            return _json_response({"ok": True, "dry_run": True, "by": by, "threadId": thread_id})
        thread_ref.update({
            "void": True,
            "title": None,
            "body": None,
            "tags": None,
            "bodyFormat": None,
        })
        return _json_response({"ok": True, "threadId": thread_id, "by": by})

    if action == "note-add":
        thread_id = body.get("threadId")
        note_body = (body.get("body") or "").strip()
        if not thread_id or not note_body:
            return _json_response({"error": "threadId and body required"}, 400)
        thread_ref = db.collection("aaThreads").document(thread_id)
        if not thread_ref.get().exists:
            # rootless防止(ba-72/ba-101と同じ考え方)。dry_runでも実データで確認する
            # (存在チェックまでが検証の一部、これをスキップすると事故防止にならない)。
            return _json_response({"error": "thread not found (rootless防止)", "threadId": thread_id}, 400)
        if dry_run:
            return _json_response({"ok": True, "dry_run": True, "by": by, "threadId": thread_id})
        note_ref = thread_ref.collection("notes").document()
        note_ref.set({
            "body": note_body,
            "by": by,
            "createdAt": now,
        })
        return _json_response({"ok": True, "noteId": note_ref.id, "by": by})

    return _json_response({"error": f"unknown action: {action}"}, 400)
