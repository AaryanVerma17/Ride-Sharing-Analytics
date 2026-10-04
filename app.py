import os
import threading
import time
from datetime import date, datetime
from decimal import Decimal

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from db import get_connection

app = Flask(__name__)
CACHE_TTL = int(os.getenv("CACHE_TTL", "300"))      # seconds
VEHICLES = ["Bike", "Auto", "Sedan", "SUV", "Premium"]
PAYMENTS = ["UPI", "Card", "Cash", "Wallet"]

# Business rule used everywhere: revenue counts COMPLETED trips only.
DONE = "CASE WHEN trip_status='Completed' THEN fare END"
REV = f"ROUND(COALESCE(SUM({DONE}),0),0)"
V = "vw_trip_details"

# __W__ is replaced with the validated WHERE clause (placeholders only; values are bound parameters).
QUERIES = {
    "kpis": f"""
        SELECT COUNT(*) AS total_trips,
               COALESCE(SUM(trip_status='Completed'),0) AS completed_trips,
               COALESCE(SUM(trip_status='Cancelled'),0) AS cancelled_trips,
               ROUND(100*COALESCE(SUM(trip_status='Cancelled'),0)/NULLIF(COUNT(*),0),2) AS cancellation_rate,
               {REV} AS revenue,
               ROUND(COALESCE(SUM(CASE WHEN trip_status='Cancelled' THEN fare END),0),0) AS lost_revenue,
               ROUND(AVG({DONE}),2) AS avg_fare,
               ROUND(AVG(CASE WHEN trip_status='Completed' THEN distance_km END),2) AS avg_distance,
               ROUND(SUM({DONE})/NULLIF(SUM(CASE WHEN trip_status='Completed' THEN distance_km END),0),2) AS fare_per_km,
               COUNT(DISTINCT rider_id) AS active_riders,
               COUNT(DISTINCT driver_id) AS active_drivers
        FROM {V} __W__""",
    "by_city": f"""
        SELECT city, COUNT(*) AS trips, {REV} AS revenue,
               ROUND(100*SUM(trip_status='Cancelled')/COUNT(*),2) AS cancellation_rate
        FROM {V} __W__ GROUP BY city ORDER BY revenue DESC""",
    "by_vehicle": f"""
        SELECT vehicle_type AS vehicle, COUNT(*) AS trips, {REV} AS revenue,
               ROUND(AVG({DONE}),2) AS avg_fare,
               ROUND(SUM({DONE})/NULLIF(SUM(CASE WHEN trip_status='Completed' THEN distance_km END),0),2) AS fare_per_km
        FROM {V} __W__ GROUP BY vehicle_type ORDER BY revenue DESC""",
    "by_payment": f"""
        SELECT payment_method AS method, COUNT(*) AS trips, {REV} AS revenue
        FROM {V} __W__ GROUP BY payment_method ORDER BY trips DESC""",
    "monthly": f"""
        WITH m AS (SELECT trip_month AS month, COUNT(*) AS trips, {REV} AS revenue
                   FROM {V} __W__ GROUP BY trip_month)
        SELECT month, trips, revenue,
               ROUND(100*(revenue - LAG(revenue) OVER (ORDER BY month))
                         / NULLIF(LAG(revenue) OVER (ORDER BY month),0),1) AS revenue_growth_pct
        FROM m ORDER BY month""",
    "by_hour": f"SELECT trip_hour AS hour, COUNT(*) AS trips FROM {V} __W__ GROUP BY trip_hour ORDER BY trip_hour",
    "heatmap": f"SELECT weekday_num AS d, trip_hour AS h, COUNT(*) AS trips FROM {V} __W__ GROUP BY weekday_num, trip_hour",
    "top_drivers": f"""
        SELECT CONCAT(driver_name,' #',driver_id) AS label, city, vehicle_type,
               COUNT(*) AS trips, {REV} AS revenue
        FROM {V} __W__ GROUP BY driver_id, driver_name, city, vehicle_type
        ORDER BY revenue DESC LIMIT 10""",
    "cancel_drivers": f"""
        SELECT CONCAT(driver_name,' #',driver_id) AS label, city, COUNT(*) AS trips,
               ROUND(100*SUM(trip_status='Cancelled')/COUNT(*),1) AS cancel_rate
        FROM {V} __W__ GROUP BY driver_id, driver_name, city
        HAVING COUNT(*) >= 30 ORDER BY cancel_rate DESC, trips DESC LIMIT 10""",
    "top_driver_per_city": f"""
        WITH d AS (SELECT city, driver_id, driver_name, {REV} AS revenue
                   FROM {V} __W__ GROUP BY city, driver_id, driver_name),
             r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY city ORDER BY revenue DESC) AS rn FROM d)
        SELECT city, CONCAT(driver_name,' #',driver_id) AS label, revenue FROM r WHERE rn = 1 ORDER BY revenue DESC""",
    "top_riders": f"""
        SELECT CONCAT(rider_name,' #',rider_id) AS label, COUNT(*) AS trips, {REV} AS spend
        FROM {V} __W__ GROUP BY rider_id, rider_name ORDER BY trips DESC, spend DESC LIMIT 10""",
    "rider_segments": f"""
        WITH r AS (SELECT rider_id, COUNT(*) AS trips FROM {V} __W__ GROUP BY rider_id)
        SELECT CASE WHEN trips=1 THEN '1 trip' WHEN trips<=4 THEN '2-4 trips'
                    WHEN trips<=9 THEN '5-9 trips' ELSE '10+ trips' END AS segment,
               COUNT(*) AS riders
        FROM r GROUP BY segment""",
    "top_routes": f"""
        SELECT route AS label, COUNT(*) AS trips, {REV} AS revenue
        FROM {V} __W__ GROUP BY route ORDER BY revenue DESC LIMIT 10""",
    "top_pickups": f"""
        SELECT pickup_location AS label, COUNT(*) AS trips
        FROM {V} __W__ GROUP BY pickup_location ORDER BY trips DESC LIMIT 10""",
}

# ---------------------------------------------------------------------------- cache
_cache, _lock = {}, threading.Lock()


def cached(key, builder):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]
    value = builder()
    with _lock:
        if len(_cache) > 300:
            _cache.clear()
        _cache[key] = (now, value)
    return value


# ---------------------------------------------------------------------------- helpers
def clean(rows):
    """Convert MySQL Decimal/date values into JSON-friendly types."""
    for row in rows:
        for k, v in row.items():
            if isinstance(v, Decimal):
                row[k] = float(v)
            elif isinstance(v, (date, datetime)):
                row[k] = v.isoformat()
    return rows


def fetch(sql, params=()):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or None)
            return clean(cur.fetchall())
    finally:
        conn.close()


def cities():
    return cached("cities", lambda: [r["city"] for r in fetch("SELECT DISTINCT city FROM drivers ORDER BY city")])


def parse_filters(args):
    """Whitelist-validate filters. Column names are fixed here; values are always bound parameters."""
    clauses, params = [], []
    city, vehicle, payment = args.get("city"), args.get("vehicle"), args.get("payment")
    if city:
        if city not in cities():
            raise ValueError("Invalid city")
        clauses.append("city = %s"); params.append(city)
    if vehicle:
        if vehicle not in VEHICLES:
            raise ValueError("Invalid vehicle")
        clauses.append("vehicle_type = %s"); params.append(vehicle)
    if payment:
        if payment not in PAYMENTS:
            raise ValueError("Invalid payment method")
        clauses.append("payment_method = %s"); params.append(payment)
    for key, op in (("start", ">="), ("end", "<=")):
        value = args.get(key)
        if value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise ValueError(f"Invalid {key} date (use YYYY-MM-DD)")
            clauses.append(f"trip_day {op} %s"); params.append(value)
    return ("WHERE " + " AND ".join(clauses) if clauses else ""), tuple(params)


def build_dashboard(where, params):
    conn = get_connection()
    try:
        out = {}
        with conn.cursor() as cur:                        # one connection for all queries
            for name, sql in QUERIES.items():
                cur.execute(sql.replace("__W__", where), params or None)
                out[name] = clean(cur.fetchall())
    finally:
        conn.close()
    k = out["kpis"] = out["kpis"][0]
    k["trips_per_driver"] = round(k["completed_trips"] / k["active_drivers"], 1) if k["active_drivers"] else None
    k["revenue_per_driver"] = round(k["revenue"] / k["active_drivers"]) if k["active_drivers"] else None
    k["trips_per_rider"] = round(k["total_trips"] / k["active_riders"], 2) if k["active_riders"] else None
    return out


# ---------------------------------------------------------------------------- routes
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/filters")
def filters():
    def build():
        r = fetch(f"SELECT MIN(trip_day) AS min_date, MAX(trip_day) AS max_date FROM {V}")[0]
        return {"cities": cities(), "vehicles": VEHICLES, "payments": PAYMENTS, **r}
    return jsonify(cached("filters", build))


@app.route("/api/dashboard")
def dashboard():
    try:
        where, params = parse_filters(request.args)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    data = cached((where, params), lambda: build_dashboard(where, params))
    resp = jsonify(data)
    resp.headers["Cache-Control"] = "public, max-age=60"
    return resp


@app.route("/health")
def health():
    try:
        conn = get_connection(); conn.ping(); conn.close()
        return jsonify(status="ok")
    except Exception:
        return jsonify(status="database unreachable"), 503


@app.after_request
def security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    return resp


@app.errorhandler(Exception)
def on_error(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception("Unhandled error")
    return jsonify(error="Internal server error"), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")