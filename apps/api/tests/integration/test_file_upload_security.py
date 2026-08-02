"""OPT-06：流式上传、所有权、大小、类型、签名与校验和。"""

from pathlib import Path

from app.config import settings
from app.models.file import FileObject


def _create_file(client, auth_owner, owner_id, **overrides):
    body = {
        "fileName": "dataset.csv",
        "mimeType": "text/csv",
        "size": 8,
        "purpose": "DATASET_IMPORT",
        "ownerType": "USER",
        "ownerId": owner_id,
    }
    body.update(overrides)
    return client.post(
        "/api/v1/files/upload-url",
        json=body,
        headers=auth_owner,
    )


def test_stream_upload_and_confirm_records_size_and_checksum(
    client, auth, users, db_session
):
    content = b"a,b\n1,2\n"
    created = _create_file(
        client, auth["OWNER"], users["OWNER"].id, size=len(content)
    )
    assert created.status_code == 201, created.text
    file_id = created.json()["file"]["id"]

    uploaded = client.post(
        f"/api/v1/files/{file_id}/upload",
        content=content,
        headers={**auth["OWNER"], "Content-Type": "text/csv"},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["uploadedSize"] == len(content)
    checksum = uploaded.json()["checksumSha256"]
    assert len(checksum) == 64

    confirmed = client.post(
        f"/api/v1/files/{file_id}/confirm",
        json={"checksum": f"sha256:{checksum}"},
        headers=auth["OWNER"],
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["file"]["status"] == "READY"
    assert confirmed.json()["file"]["uploadedSize"] == len(content)

    db_session.expire_all()
    file_obj = db_session.get(FileObject, file_id)
    assert file_obj.status == "READY"
    assert file_obj.checksum_sha256 == checksum
    assert (
        Path(settings.LOCAL_STORAGE_DIR) / file_obj.storage_key
    ).read_bytes() == content


def test_declared_and_actual_size_mismatch_marks_failed_and_removes_temp(
    client, auth, users, db_session
):
    created = _create_file(
        client, auth["OWNER"], users["OWNER"].id, size=20
    )
    file_id = created.json()["file"]["id"]

    response = client.post(
        f"/api/v1/files/{file_id}/upload",
        content=b"short",
        headers={**auth["OWNER"], "Content-Type": "text/csv"},
    )
    assert response.status_code == 422

    db_session.expire_all()
    file_obj = db_session.get(FileObject, file_id)
    assert file_obj.status == "FAILED"
    assert "大小" in file_obj.failure_reason
    storage_root = Path(settings.LOCAL_STORAGE_DIR)
    assert not list(storage_root.rglob("*.part"))
    assert not (storage_root / file_obj.storage_key).exists()


def test_oversized_file_rejected_before_record_creation(
    client, auth, users, db_session
):
    response = _create_file(
        client,
        auth["OWNER"],
        users["OWNER"].id,
        size=settings.MAX_UPLOAD_SIZE_BYTES + 1,
    )
    assert response.status_code == 422
    assert db_session.query(FileObject).count() == 0


def test_extension_and_mime_mismatch_rejected(client, auth, users, db_session):
    response = _create_file(
        client,
        auth["OWNER"],
        users["OWNER"].id,
        fileName="dataset.exe",
        mimeType="text/csv",
    )
    assert response.status_code == 422
    assert db_session.query(FileObject).count() == 0


def test_owner_relationship_checked_when_creating_upload(
    client, auth, users, db_session
):
    response = _create_file(
        client,
        auth["OWNER"],
        users["LABELER"].id,
    )
    assert response.status_code == 403
    assert db_session.query(FileObject).count() == 0


def test_binary_signature_mismatch_marks_failed(
    client, auth, users, db_session
):
    content = b"not-a-real-png"
    created = _create_file(
        client,
        auth["OWNER"],
        users["OWNER"].id,
        fileName="evidence.png",
        mimeType="image/png",
        size=len(content),
    )
    file_id = created.json()["file"]["id"]

    response = client.post(
        f"/api/v1/files/{file_id}/upload",
        content=content,
        headers={**auth["OWNER"], "Content-Type": "image/png"},
    )
    assert response.status_code == 422
    db_session.expire_all()
    assert db_session.get(FileObject, file_id).status == "FAILED"


def test_checksum_mismatch_cannot_enter_ready(client, auth, users, db_session):
    content = b"a,b\n1,2\n"
    created = _create_file(
        client, auth["OWNER"], users["OWNER"].id, size=len(content)
    )
    file_id = created.json()["file"]["id"]
    assert client.post(
        f"/api/v1/files/{file_id}/upload",
        content=content,
        headers={**auth["OWNER"], "Content-Type": "text/csv"},
    ).status_code == 200

    confirmed = client.post(
        f"/api/v1/files/{file_id}/confirm",
        json={"checksum": "0" * 64},
        headers=auth["OWNER"],
    )
    assert confirmed.status_code == 422
    db_session.expire_all()
    assert db_session.get(FileObject, file_id).status == "UPLOADING"
