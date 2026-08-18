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
"""
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
import yaml
from azure.data.tables import TableServiceClient

BACKUP_TABLES_YML = Path(__file__).resolve().parent / "backup_tables.yml"
TOKEN_URI = "https://oauth2.googleapis.com/token"
FILES_URL = "https://www.googleapis.com/drive/v3/files"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"


def _load_backup_tables():
    with open(BACKUP_TABLES_YML, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return [t["name"] for t in data["tables"]]


def _fetch_table_entities(table_name):
    conn_str = os.environ["TABLE_CONNECTION_STRING"]
    service = TableServiceClient.from_connection_string(conn_str)
    table = service.get_table_client(table_name)
    return [dict(e) for e in table.list_entities()]


def _get_access_token():
    resp = requests.post(TOKEN_URI, data={
        "client_id": os.environ["GDRIVE_OAUTH_CLIENT_ID"],
        "client_secret": os.environ["GDRIVE_OAUTH_CLIENT_SECRET"],
        "refresh_token": os.environ["GDRIVE_OAUTH_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    })
    resp.raise_for_status()
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
    resp = requests.get(
        FILES_URL,
        headers=headers,
        params={"q": query, "fields": "files(id,name)", "spaces": "drive"},
    )
    resp.raise_for_status()
    files = resp.json().get("files", [])
    if files:
        return files[0]["id"]

    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    resp = requests.post(
        FILES_URL,
        headers={**headers, "Content-Type": "application/json"},
        data=json.dumps(metadata),
    )
    resp.raise_for_status()
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

    resp = requests.post(
        UPLOAD_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        data=body,
    )
    resp.raise_for_status()
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


if __name__ == "__main__":
    main()
