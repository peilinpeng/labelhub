"""密码哈希与兼容迁移工具。

新密码统一使用 Argon2id。历史 bcrypt 哈希仅用于验证，并在用户成功登录后
由调用方持久化为 Argon2id，实现无需强制重置密码的渐进迁移。
"""

from __future__ import annotations

import bcrypt
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError
from pwdlib.hashers.argon2 import Argon2Hasher
from pwdlib.hashers.bcrypt import BcryptHasher

_BCRYPT_PASSWORD_LIMIT_BYTES = 72


class _LegacyBcryptHasher(BcryptHasher):
    """只读兼容 bcrypt 的历史 72-byte 截断语义。

    bcrypt 5 对超过 72 bytes 的输入改为抛出 ``ValueError``。已有哈希是在旧版
    bcrypt 的截断语义下生成的，因此验证旧哈希时显式复现该语义；验证成功后会
    立即用完整明文生成 Argon2id 哈希，不再继续保留该限制。
    """

    def verify(self, password: str | bytes, hash: str | bytes) -> bool:
        password_bytes = password.encode("utf-8") if isinstance(password, str) else password
        hash_bytes = hash.encode("utf-8") if isinstance(hash, str) else hash
        try:
            return bcrypt.checkpw(
                password_bytes[:_BCRYPT_PASSWORD_LIMIT_BYTES],
                hash_bytes,
            )
        except ValueError:
            # 数据库中的损坏哈希或不受支持的 bcrypt 变体不能让登录接口退化为 500。
            return False


_password_hash = PasswordHash((Argon2Hasher(), _LegacyBcryptHasher()))


def hash_password(password: str) -> str:
    """使用当前首选算法 Argon2id 生成密码哈希。"""
    return _password_hash.hash(password)


def verify_password_and_update(
    password: str,
    hashed_password: str,
) -> tuple[bool, str | None]:
    """验证密码，并在算法或参数过时时返回新的 Argon2id 哈希。"""
    try:
        return _password_hash.verify_and_update(password, hashed_password)
    except (UnknownHashError, ValueError):
        # 未知/损坏哈希按认证失败处理，禁止向外暴露存储状态或触发 500。
        return False, None


# 未知邮箱也执行一次真实 Argon2 验证，降低通过响应耗时枚举账号的风险。
DUMMY_PASSWORD_HASH = hash_password("labelhub-dummy-password-not-an-account")
