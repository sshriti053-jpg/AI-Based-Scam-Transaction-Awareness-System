"""
Flask backend for AI-Based Scam Transaction Awareness System
"""

import os
import json
import sqlite3
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, render_template, g

# Make sure the ml package is importable when running from project root
import sys
sys.path.insert(0, os.path.dirname(__file__))
from ml.model import analyze_transaction

# ---------------------------------------------------------------------------
# App & DB setup
# ---------------------------------------------------------------------------

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), "transactions.db")


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_db(exc):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT    NOT NULL,
                amount          REAL    NOT NULL,
                txn_time        TEXT,
                payment_method  TEXT,
                recipient       TEXT,
                user_location   TEXT,
                txn_location    TEXT,
                txn_count_last_hour INTEGER DEFAULT 0,
                risk_score      INTEGER NOT NULL,
                label           TEXT    NOT NULL,
                reasons         TEXT,
                tips            TEXT,
                feature_scores  TEXT
            )
        """)
        db.commit()


# ---------------------------------------------------------------------------
# Routes — pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(force=True, silent=True) or {}

    # Basic validation
    try:
        amount = float(data.get("amount", 0))
        if amount <= 0:
            return jsonify({"error": "Amount must be greater than 0"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount"}), 400

    # Compute average & std from recent history for contextual scoring
    db = get_db()
    rows = db.execute(
        "SELECT amount FROM transactions ORDER BY id DESC LIMIT 20"
    ).fetchall()
    amounts = [r["amount"] for r in rows] if rows else []
    avg = float(sum(amounts) / len(amounts)) if amounts else 500.0
    std = float(
        (sum((x - avg) ** 2 for x in amounts) / len(amounts)) ** 0.5
    ) if len(amounts) > 1 else 300.0

    data["avg_amount"] = avg
    data["std_amount"] = std

    result = analyze_transaction(data)

    # Persist
    now = datetime.utcnow().isoformat()
    db.execute(
        """INSERT INTO transactions
           (created_at, amount, txn_time, payment_method, recipient,
            user_location, txn_location, txn_count_last_hour,
            risk_score, label, reasons, tips, feature_scores)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            now,
            amount,
            data.get("time", ""),
            data.get("payment_method", ""),
            data.get("recipient", ""),
            data.get("user_location", ""),
            data.get("txn_location", ""),
            int(data.get("txn_count_last_hour", 0)),
            result["risk_score"],
            result["label"],
            json.dumps(result["reasons"]),
            json.dumps(result["tips"]),
            json.dumps(result["feature_scores"]),
        ),
    )
    db.commit()

    result["id"] = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    result["created_at"] = now
    return jsonify(result)


@app.route("/api/dashboard", methods=["GET"])
def api_dashboard():
    db = get_db()
    total = db.execute("SELECT COUNT(*) as c FROM transactions").fetchone()["c"]
    safe  = db.execute("SELECT COUNT(*) as c FROM transactions WHERE label='Safe'").fetchone()["c"]
    susp  = db.execute("SELECT COUNT(*) as c FROM transactions WHERE label='Suspicious'").fetchone()["c"]
    high  = db.execute("SELECT COUNT(*) as c FROM transactions WHERE label='High Risk'").fetchone()["c"]

    recent = db.execute(
        """SELECT id, created_at, amount, payment_method, recipient,
                  risk_score, label
           FROM transactions ORDER BY id DESC LIMIT 8"""
    ).fetchall()

    # Chart — last 7 days breakdown
    chart = []
    for i in range(6, -1, -1):
        day = (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d")
        row = db.execute(
            """SELECT
                 SUM(label='Safe')      as s,
                 SUM(label='Suspicious') as su,
                 SUM(label='High Risk') as h
               FROM transactions WHERE created_at LIKE ?""",
            (day + "%",),
        ).fetchone()
        chart.append({
            "date": day,
            "safe":      row["s"]  or 0,
            "suspicious": row["su"] or 0,
            "high_risk":  row["h"]  or 0,
        })

    return jsonify({
        "total": total,
        "safe": safe,
        "suspicious": susp,
        "high_risk": high,
        "recent": [dict(r) for r in recent],
        "chart": chart,
    })


@app.route("/api/history", methods=["GET"])
def api_history():
    db = get_db()
    q        = request.args.get("q", "").strip()
    label_f  = request.args.get("label", "").strip()
    page     = max(int(request.args.get("page", 1)), 1)
    per_page = 10

    base = "FROM transactions WHERE 1=1"
    params = []
    if q:
        base += " AND (recipient LIKE ? OR payment_method LIKE ? OR txn_location LIKE ?)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    if label_f:
        base += " AND label = ?"
        params.append(label_f)

    total_row = db.execute(f"SELECT COUNT(*) as c {base}", params).fetchone()
    total_count = total_row["c"]

    rows = db.execute(
        f"""SELECT id, created_at, amount, txn_time, payment_method,
                   recipient, user_location, txn_location,
                   txn_count_last_hour, risk_score, label,
                   reasons, tips, feature_scores
            {base} ORDER BY id DESC LIMIT ? OFFSET ?""",
        params + [per_page, (page - 1) * per_page],
    ).fetchall()

    records = []
    for r in rows:
        d = dict(r)
        d["reasons"]        = json.loads(d["reasons"] or "[]")
        d["tips"]           = json.loads(d["tips"] or "[]")
        d["feature_scores"] = json.loads(d["feature_scores"] or "{}")
        records.append(d)

    return jsonify({
        "records": records,
        "total": total_count,
        "page": page,
        "per_page": per_page,
        "pages": max(1, -(-total_count // per_page)),  # ceil division
    })


@app.route("/api/history/<int:txn_id>", methods=["DELETE"])
def api_delete(txn_id):
    db = get_db()
    db.execute("DELETE FROM transactions WHERE id=?", (txn_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
