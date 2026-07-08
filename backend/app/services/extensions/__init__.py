"""Extension Store services.

- ``license``      — signed license-file parsing + entitlement state
- ``registry``     — process-wide cache of installed extensions + active license
- ``gate``         — ``require_extension()`` FastAPI dependency (soft-disable)
- ``bundle``       — signed ``.teax`` bundle verification
- ``installer``    — bundle extraction / removal on the extensions volume
- ``content_pack`` — preview/apply of data-only extension content
"""
