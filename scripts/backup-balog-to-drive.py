"""指定テーブル(Azure Table Storage)を全件JSONダンプし、Google Driveの
既存フォルダ(ba-backup)の直下にある「週フォルダ」へ新規ファイルとして追加する。

2026-08-18: 保存先をba-backup直下のべた置きから、月曜始まりの週フォルダ
(例 2026-08-18_08-24)配下へ変更。週フォルダは実行時にfind-or-createする。
週が変われば新しいフォルダを1つ作るだけなので、古い分は「フォルダごと削除」で
まとめて片付けられる。週の区切りはファイル名と同じUTC日付・月曜始まりで一貫させる。

対象テーブルはscripts/backup_tables.ymlが正(2026-07-31、ハードコードのリストから
切り出し)。ここに追記すればコード変更なしで次回実行から対象に入る
(rbook run yml listにも自動的に載る)。テーブルごとに1ファイル、同じ実行の
中で順番にアップロードする。

追記のみを徹底するため、Drive側の呼び出しはfiles.create(新規作成)のみで、
files.update/files.deleteは一切呼ばない。週フォルダの作成もfiles.create。
認可はOAuth(drive.fileスコープ)のリフレッシュトークンを使う想定(このスコープ
自体、このスクリプトが作成したファイル・フォルダ以外には触れられない)。
つまり週フォルダのfind-or-createも、このスクリプトが作った週フォルダだけが
検索対象になる(同じ週の2回目以降の実行で再利用される)。サービスアカウントは
使わない(個人Googleアカウントの共有フォルダには書き込めないため)。

必須環境変数:
  TABLE_CONNECTION_STRING   - 対象テーブルへの接続文字列(同一ストレージアカウント)
  GDRIVE_OAUTH_CLIENT_ID
  GDRIVE_OAUTH_CLIENT_SECRET
  GDRIVE_OAUTH_REFRESH_TOKEN
  GDRIVE_FOLDER_ID          - 週フォルダを作る親フォルダ(ba-backup)のID
任意:
  AA_BACKUP_KEY             - Firestore を aa-lane の fs-get で読むための、バックアップ専用の読むだけの鍵(ab-166)。
                              無ければ今までどおり匿名で読み、読めないコレクションは飛ばす
"""
import json
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
import yaml
from azure.data.tables import TableServiceClient

BACKUP_TABLES_YML = Path(__file__).resolve().parent / "backup_tables.yml"
TOKEN_URI = "https://oauth2.googleapis.com/token"
FILES_URL = "https://www.googleapis.com/drive/v3/files"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"

# ab-51(2026-10-02): 10/1 朝、Visits のアップロードが Google の一時的な 502 で落ち、
# リトライが無いため1回のエラーで全体が終了コード1になった。Google 側の一時エラー
# (429・5xx)と通信エラーだけを、間隔を倍々にして数回やり直す。4xx(認証・権限・
# リクエスト不正)はやり直しても直らないので即座に失敗させる。
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 5
BACKOFF_BASE_SEC = 2

# 2026-10-10(ab-166): Rules 第1段で visits・ab・ac などの匿名の読みが閉じた。鍵があれば aa-lane の fs-get
# (バックアップ専用の読むだけの鍵 backup_key)で読み、無ければ匿名で読む。匿名で 403 のコレクションは
# 飛ばしてログに出し、ほかの分は取り続ける(1つ読めないだけで全体を落とさない)。
AA_LANE_URL = "https://asia-northeast2-{project}.cloudfunctions.net/aa-lane"
FS_PAGE_SIZE = 300


def _request_with_retry(method, url, *, sleep=time.sleep, **kwargs):
    """requests.request に一時エラーのリトライを足したもの。最後は raise_for_status。"""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = requests.request(method, url, timeout=120, **kwargs)
        except (requests.ConnectionError, requests.Timeout) as e:
            if attempt == MAX_ATTEMPTS:
                raise
            print(f"通信エラー、やり直し {attempt}/{MAX_ATTEMPTS - 1}: {type(e).__name__}")
        else:
            if resp.status_code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS:
                resp.raise_for_status()
                return resp
            print(f"HTTP {resp.status_code}、やり直し {attempt}/{MAX_ATTEMPTS - 1}")
        sleep(BACKOFF_BASE_SEC * (2 ** (attempt - 1)))


def _load_backup_config():
    with open(BACKUP_TABLES_YML, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _load_backup_tables():
    return [t["name"] for t in _load_backup_config()["tables"]]


def _load_firestore_collections():
    """[(コレクション名, サブコレクション名のリスト)]。subcollections は省略可。"""
    data = _load_backup_config()
    return data.get("firestore_project"), [
        (c["name"], c.get("subcollections") or []) for c in data.get("firestore_collections") or []]


def _fetch_firestore_collection(project, collection, subcollections=()):
    """Firestore REST で読みが無認証のコレクションを全件取る(ページ送りあり)。

    返り値はドキュメントごとに {"id": ドキュメントID, "fields": REST の生の fields} と
    updateTime。型付きの生値をそのまま残す(戻すときに型が分かるように)。

    2026-10-03 ab-111: abThreads・acThreads の note は各ドキュメントの下のサブコレクション
    (notes)にあり、親だけ取ると本文しか残らない。subcollections に名前があれば、
    ドキュメントごとにそのサブコレクションも全件取って "subcollections" に入れる。
    読み取りは「親の件数ぶんの一覧呼び出し+子の件数」だけ増える(ab-95)。
    """
    docs = _list_firestore_documents(project, collection)
    for doc in docs:
        if subcollections:
            doc["subcollections"] = {
                sub: _list_firestore_documents(project, f"{collection}/{doc['id']}/{sub}")
                for sub in subcollections}
    return docs


def _firestore_page(project, path, page_token):
    """1ページ分を取る。AA_BACKUP_KEY があれば aa-lane の fs-get、無ければ匿名 REST。返事の形はどちらも同じ。"""
    key = os.environ.get("AA_BACKUP_KEY")
    if key:
        body = {"action": "fs-get", "backup_key": key, "path": path, "pageSize": FS_PAGE_SIZE}
        if page_token:
            body["pageToken"] = page_token
        return _request_with_retry("POST", AA_LANE_URL.format(project=project), json=body).json()
    params = {"pageSize": FS_PAGE_SIZE}
    if page_token:
        params["pageToken"] = page_token
    url = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/{path}"
    return _request_with_retry("GET", url, params=params).json()


def _list_firestore_documents(project, path):
    docs, page_token = [], None
    while True:
        data = _firestore_page(project, path, page_token)
        for d in data.get("documents", []):
            docs.append({
                "id": d["name"].rsplit("/", 1)[1],
                "fields": d.get("fields", {}),
                "updateTime": d.get("updateTime"),
            })
        page_token = data.get("nextPageToken")
        if not page_token:
            return docs


def _fetch_table_entities(table_name):
    conn_str = os.environ["TABLE_CONNECTION_STRING"]
    service = TableServiceClient.from_connection_string(conn_str)
    table = service.get_table_client(table_name)
    return [dict(e) for e in table.list_entities()]


def _get_access_token():
    resp = _request_with_retry("POST", TOKEN_URI, data={
        "client_id": os.environ["GDRIVE_OAUTH_CLIENT_ID"],
        "client_secret": os.environ["GDRIVE_OAUTH_CLIENT_SECRET"],
        "refresh_token": os.environ["GDRIVE_OAUTH_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    })
    return resp.json()["access_token"]


def _week_folder_name(now_utc):
    """月曜始まりの週フォルダ名。例: 2026-08-18_08-24 (月曜フル_日曜の月日)。"""
    d = now_utc.date()
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return f"{monday.isoformat()}_{sunday.strftime('%m-%d')}"


def _find_or_create_week_folder(access_token, parent_id, name):
    """親フォルダ直下の同名週フォルダを探し、無ければ作ってIDを返す。

    drive.fileスコープのため、検索対象はこのスクリプトが作成したフォルダのみ。
    同じ週の2回目以降の実行では既存が見つかり、週が変わると新規作成される。
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    escaped = name.replace("'", "\\'")
    query = (
        f"name = '{escaped}' and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    resp = _request_with_retry(
        "GET",
        FILES_URL,
        headers=headers,
        params={"q": query, "fields": "files(id,name)", "spaces": "drive"},
    )
    files = resp.json().get("files", [])
    if files:
        return files[0]["id"]

    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    resp = _request_with_retry(
        "POST",
        FILES_URL,
        headers={**headers, "Content-Type": "application/json"},
        data=json.dumps(metadata),
    )
    return resp.json()["id"]


def _upload_to_drive(access_token, filename, content_bytes, parent_id):
    boundary = "balog_backup_boundary"
    metadata = {"name": filename, "parents": [parent_id]}
    body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(metadata)}\r\n"
        f"--{boundary}\r\n"
        "Content-Type: application/json\r\n\r\n"
    ).encode("utf-8") + content_bytes + f"\r\n--{boundary}--".encode("utf-8")

    resp = _request_with_retry(
        "POST",
        UPLOAD_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        data=body,
    )
    return resp.json()


def main():
    access_token = _get_access_token()
    now = datetime.now(timezone.utc)
    timestamp = now.strftime('%Y-%m-%dT%H%M%SZ')

    week_name = _week_folder_name(now)
    week_folder_id = _find_or_create_week_folder(
        access_token, os.environ["GDRIVE_FOLDER_ID"], week_name)
    print(f"週フォルダ: {week_name} (folderId={week_folder_id})")

    for table_name in _load_backup_tables():
        entities = _fetch_table_entities(table_name)
        content = json.dumps(entities, ensure_ascii=False, default=str).encode("utf-8")
        filename = f"{table_name.lower()}_full_{timestamp}.json"
        result = _upload_to_drive(access_token, filename, content, week_folder_id)
        print(f"バックアップ完了: {table_name} {len(entities)}件 -> {week_name}/{filename} (fileId={result['id']})")

    project, collections = _load_firestore_collections()
    skipped = []
    for collection, subcollections in collections:
        try:
            docs = _fetch_firestore_collection(project, collection, subcollections)
        except requests.HTTPError as e:
            if e.response is None or e.response.status_code not in (401, 403):
                raise
            skipped.append(collection)
            print(f"::warning::Firestore {collection} は読めないので飛ばした(HTTP {e.response.status_code})。"
                  f"AA_BACKUP_KEY が無いか効いていない(ab-166)")
            continue
        content = json.dumps(docs, ensure_ascii=False).encode("utf-8")
        filename = f"firestore_{collection.lower()}_full_{timestamp}.json"
        result = _upload_to_drive(access_token, filename, content, week_folder_id)
        sub_counts = "".join(
            f" +{sub} {sum(len(d['subcollections'][sub]) for d in docs)}件" for sub in subcollections)
        print(f"バックアップ完了: Firestore {collection} {len(docs)}件{sub_counts} -> {week_name}/{filename} (fileId={result['id']})")
    if skipped:
        print(f"飛ばした Firestore のコレクション: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
