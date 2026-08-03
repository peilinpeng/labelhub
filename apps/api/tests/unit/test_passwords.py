"""密码哈希算法、旧 bcrypt 兼容与渐进迁移测试。"""

import bcrypt

from app.passwords import hash_password, verify_password_and_update


def _legacy_bcrypt_hash(password: str) -> str:
    password_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=4)).decode("utf-8")


def test_new_password_hash_uses_argon2id() -> None:
    hashed = hash_password("correct horse battery staple")

    assert hashed.startswith("$argon2id$")
    valid, updated_hash = verify_password_and_update(
        "correct horse battery staple",
        hashed,
    )
    assert valid is True
    assert updated_hash is None


def test_wrong_argon2_password_is_rejected() -> None:
    hashed = hash_password("correct password")

    assert verify_password_and_update("wrong password", hashed) == (False, None)


def test_legacy_bcrypt_is_upgraded_to_argon2id() -> None:
    legacy_hash = _legacy_bcrypt_hash("legacy password")

    valid, updated_hash = verify_password_and_update("legacy password", legacy_hash)

    assert valid is True
    assert updated_hash is not None
    assert updated_hash.startswith("$argon2id$")
    assert verify_password_and_update("legacy password", updated_hash) == (True, None)


def test_wrong_legacy_bcrypt_password_is_not_upgraded() -> None:
    legacy_hash = _legacy_bcrypt_hash("legacy password")

    assert verify_password_and_update("wrong password", legacy_hash) == (False, None)


def test_long_legacy_bcrypt_password_can_migrate_without_bcrypt5_error() -> None:
    # bcrypt 4 及更早版本会截断到 72 bytes；bcrypt 5 改为直接抛 ValueError。
    # 兼容层只在验证旧哈希时复现截断，随后使用完整明文生成 Argon2id。
    password = "x" * 72 + "完整后缀"
    legacy_hash = _legacy_bcrypt_hash(password)

    valid, updated_hash = verify_password_and_update(password, legacy_hash)

    assert valid is True
    assert updated_hash is not None
    assert updated_hash.startswith("$argon2id$")
    assert verify_password_and_update(password, updated_hash) == (True, None)
    assert verify_password_and_update("x" * 72 + "错误后缀", updated_hash) == (
        False,
        None,
    )


def test_unknown_or_malformed_hash_is_authentication_failure() -> None:
    assert verify_password_and_update("password", "not-a-password-hash") == (
        False,
        None,
    )
    assert verify_password_and_update("password", "$2b$12$broken") == (False, None)
