import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // Try multiple paths for compatibility (local dev vs Vercel)
    const candidates = [
      path.join(process.cwd(), "baxbench.db"),
      path.join(__dirname, "..", "baxbench.db"),
      path.join(__dirname, "baxbench.db"),
    ];
    let dbPath = candidates[0];
    for (const p of candidates) {
      try {
        require("fs").accessSync(p);
        dbPath = p;
        break;
      } catch {}
    }
    db = new Database(dbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
  }
  return db;
}
