import * as XLSX from "xlsx";
import type { User } from "@/types";

const EXPORT_COLUMNS = [
  "email",
  "display_name",
  "role",
  "is_active",
  "auth_provider",
  "locale",
  "last_login",
  "created_at",
] as const;

export function exportUsersToXlsx(users: User[]): void {
  const rows: Record<string, unknown>[] = users.map((u) => ({
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    is_active: u.is_active ? "TRUE" : "FALSE",
    auth_provider: u.auth_provider || "local",
    locale: u.locale || "",
    last_login: u.last_login || "",
    created_at: u.created_at || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_COLUMNS] });

  ws["!cols"] = EXPORT_COLUMNS.map((h) => {
    let maxLen = h.length;
    for (const r of rows) {
      const v = String(r[h] ?? "");
      if (v.length > maxLen) maxLen = v.length;
    }
    return { wch: Math.min(maxLen + 2, 60) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Users");

  XLSX.writeFile(wb, `users_export_${exportTimestamp()}.xlsx`);
}

function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  return `${y}-${mo}-${d}_${h}${mi}`;
}
