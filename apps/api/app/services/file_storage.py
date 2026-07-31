"""文件存储适配层。

当前只实现本地原子写入；接口把临时文件、最终提交和清理隔离出来，后续可替换为
S3 multipart upload、病毒扫描或 DLP 扫描，而不改变文件领域状态机。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from app.config import settings


class UploadSink(Protocol):
    temp_path: Path
    final_path: Path

    def write(self, chunk: bytes) -> None: ...
    def finalize(self) -> None: ...
    def abort(self) -> None: ...


class LocalUploadSink:
    def __init__(self, storage_key: str) -> None:
        storage_root = Path(settings.LOCAL_STORAGE_DIR).resolve()
        final_path = (storage_root / storage_key).resolve()
        if storage_root not in final_path.parents:
            raise ValueError("非法 storage key")
        final_path.parent.mkdir(parents=True, exist_ok=True)
        self.final_path = final_path
        self.temp_path = final_path.with_name(
            f".{final_path.name}.{uuid4().hex}.part"
        )
        self._handle = self.temp_path.open("xb")
        self._closed = False

    def write(self, chunk: bytes) -> None:
        self._handle.write(chunk)

    def finalize(self) -> None:
        if not self._closed:
            self._handle.flush()
            os.fsync(self._handle.fileno())
            self._handle.close()
            self._closed = True
        os.replace(self.temp_path, self.final_path)

    def abort(self) -> None:
        if not self._closed:
            self._handle.close()
            self._closed = True
        self.temp_path.unlink(missing_ok=True)


def create_upload_sink(storage_key: str) -> UploadSink:
    if settings.FILE_STORAGE_DRIVER != "local":
        raise RuntimeError(
            f"尚未配置文件存储驱动：{settings.FILE_STORAGE_DRIVER!r}"
        )
    return LocalUploadSink(storage_key)


def remove_local_file(storage_key: str) -> None:
    if settings.FILE_STORAGE_DRIVER != "local":
        return
    storage_root = Path(settings.LOCAL_STORAGE_DIR).resolve()
    file_path = (storage_root / storage_key).resolve()
    if storage_root in file_path.parents:
        file_path.unlink(missing_ok=True)


def local_file_exists(storage_key: str) -> bool:
    if settings.FILE_STORAGE_DRIVER != "local":
        return False
    storage_root = Path(settings.LOCAL_STORAGE_DIR).resolve()
    file_path = (storage_root / storage_key).resolve()
    return storage_root in file_path.parents and file_path.is_file()
