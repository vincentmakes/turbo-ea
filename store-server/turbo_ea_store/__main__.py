"""CLI entry point: python -m turbo_ea_store [--host 0.0.0.0] [--port 8010]."""

from __future__ import annotations

import argparse

import uvicorn

from turbo_ea_store.config import settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="turbo-ea-store")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=settings.STORE_PORT)
    args = parser.parse_args()
    uvicorn.run("turbo_ea_store.app:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
