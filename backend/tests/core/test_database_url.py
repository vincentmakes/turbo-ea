"""The DSN must survive credentials that carry URL-reserved characters.

Managed-database consoles (RDS, Azure Flexible Server, Cloud SQL) generate
passwords containing ``@ / : # ? %``; an unencoded value splits the URL at the
wrong place and the backend fails to boot with a confusing connection error.
"""

from sqlalchemy.engine import make_url

from app.config import Settings


def _settings(**overrides: str) -> Settings:
    s = Settings()
    for key, value in overrides.items():
        setattr(s, key, value)
    return s


def test_reserved_characters_round_trip():
    password = "p@ss/w:rd#1?%x"
    s = _settings(POSTGRES_USER="turbo@ea", POSTGRES_PASSWORD=password, POSTGRES_HOST="db.internal")
    url = make_url(s.database_url)
    assert url.username == "turbo@ea"
    assert url.password == password
    assert url.host == "db.internal"
    assert url.database == s.POSTGRES_DB


def test_plain_credentials_unchanged():
    s = _settings(POSTGRES_USER="turboea", POSTGRES_PASSWORD="turboea", POSTGRES_HOST="db")
    assert (
        s.database_url
        == f"postgresql+asyncpg://turboea:turboea@db:{s.POSTGRES_PORT}/{s.POSTGRES_DB}"
    )
