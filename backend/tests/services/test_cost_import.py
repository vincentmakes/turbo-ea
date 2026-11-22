from io import BytesIO

import pytest
from openpyxl import Workbook

from app.services.cost_import import ImportFileError, parse_workbook


def workbook(headers, rows):
    book = Workbook()
    sheet = book.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    book.save(output)
    return output.getvalue()


def test_parse_optional_renewal_and_reordered_headers():
    data = workbook(["Amount", "Cost Item", "Card ID", "Fiscal Year"], [[0, "lic", "id", 2026]])
    row = parse_workbook(data)[0]
    assert (row.row, row.card_id, row.year, row.key, row.amount, row.renewal) == (
        2,
        "id",
        2026,
        "lic",
        0,
        None,
    )


def test_parse_rejects_malformed_and_missing_headers():
    with pytest.raises(ImportFileError):
        parse_workbook(b"not a workbook")
    with pytest.raises(ImportFileError):
        parse_workbook(workbook(["Card ID"], [["id"]]))


def test_parse_rejects_more_than_ten_thousand_physical_rows():
    data = workbook(
        ["Card ID", "Fiscal Year", "Cost Item", "Amount"], [["id", 2026, "lic", 1]] * 10001
    )
    with pytest.raises(ImportFileError):
        parse_workbook(data)


def test_parse_finds_headers_beyond_column_256():
    data = workbook(
        [None] * 300 + ["Card ID", "Fiscal Year", "Cost Item", "Amount"],
        [[None] * 300 + ["id", 2026, "lic", 1]],
    )
    assert parse_workbook(data)[0].key == "lic"


def test_parse_marks_formula_and_keeps_other_rows():
    data = workbook(
        ["Card ID", "Fiscal Year", "Cost Item", "Amount", "Renewal Date"],
        [["id", 2026, "lic", 1, '=IF(1=1,"","")'], ["id", 2026, "other", 2, None]],
    )
    rows = parse_workbook(data)
    assert rows[0].formula_reason == "invalid_renewal_date"
    assert rows[1].formula_reason is None


def test_duplicate_headers_are_rejected():
    data = workbook(
        ["Card ID", "Fiscal Year", "Cost Item", "Amount", "Renewal Date", "Renewal Date"],
        [["id", 2026, "lic", 1]],
    )
    with pytest.raises(ImportFileError, match="Duplicate"):
        parse_workbook(data)
