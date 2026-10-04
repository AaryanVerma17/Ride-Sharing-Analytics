"""Runs schema.sql using Python (no MySQL command-line client needed)."""
from pathlib import Path
from db import get_connection

sql = Path("schema.sql").read_text(encoding="utf-8")
conn = get_connection()
with conn.cursor() as cur:
    for stmt in sql.split(";"):
        body = "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()
        if not body:
            continue
        cur.execute(body)
        print("OK:", body.splitlines()[0][:70])
conn.close()
print("\nSchema created.")