import argparse
import random
import sys
from datetime import datetime, timedelta
from itertools import accumulate

from db import get_connection

# ---- Business assumptions (edit these to reshape the dataset) -----------------------------------
CITIES = {"Delhi": 18, "Mumbai": 17, "Bangalore": 15, "Hyderabad": 10, "Pune": 8,
          "Chennai": 9, "Kolkata": 7, "Ahmedabad": 6, "Jaipur": 5, "Gurugram": 5}      # relative size
VEHICLES = {  # base fare, rate per km, share of fleet, typical distance range (km)
    "Bike":    dict(base=20,  rate=7,  share=30, dist=(1, 12)),
    "Auto":    dict(base=30,  rate=10, share=25, dist=(1, 15)),
    "Sedan":   dict(base=50,  rate=14, share=25, dist=(2, 30)),
    "SUV":     dict(base=70,  rate=19, share=12, dist=(3, 35)),
    "Premium": dict(base=100, rate=26, share=8,  dist=(3, 40)),
}
PAYMENTS = ["UPI", "Card", "Cash", "Wallet"]
PAY_W = {"default": [48, 15, 27, 10], "premium": [40, 45, 5, 10]}   # SUV/Premium riders use cards more
AREAS = {"Airport": 10, "Railway Station": 9, "Tech Park": 8, "Business District": 8, "Mall": 7,
         "University": 6, "Market": 6, "Old City": 5, "Hospital": 4, "Stadium": 3}
HOUR_W = {  # demand by hour of day
    False: [1,1,1,1,1,2,4,8,11,9,6,5,5,5,5,6,8,11,12,10,7,5,3,2],   # weekday: morning + evening peaks
    True:  [3,2,2,1,1,1,2,3,5,7,8,9,9,8,8,8,9,10,11,11,9,7,5,4],   # weekend: flatter, later evening
}
DOW_W = [1.0, 1.0, 1.0, 1.05, 1.25, 1.3, 1.1]                      # Mon..Sun
PEAK_HOURS = {8, 9, 18, 19, 20}
FIRST = ["Aarav", "Vivaan", "Aditya", "Arjun", "Rohan", "Karan", "Ishaan", "Rahul",
         "Ananya", "Diya", "Priya", "Neha", "Sneha", "Kavya", "Meera", "Riya"]
LAST = ["Sharma", "Verma", "Gupta", "Singh", "Patel", "Reddy", "Iyer", "Nair",
        "Khan", "Das", "Mehta", "Joshi", "Kapoor", "Malhotra", "Bose", "Chopra"]


def insert_many(cur, sql, rows, size=5000):
    for i in range(0, len(rows), size):
        cur.executemany(sql, rows[i:i + size])


def build_pool(rng, rows, city_idx, weight_fn):
    """Per-city lists of ids with cumulative weights (so some riders/drivers are far busier than others)."""
    ids = {c: [] for c in CITIES}
    for row in rows:
        ids[row[city_idx]].append(row[0])
    cum = {c: list(accumulate(weight_fn() for _ in v)) for c, v in ids.items()}
    return ids, cum


def generate(a):
    rng = random.Random(a.seed)
    start = datetime.strptime(a.start, "%Y-%m-%d")
    city_names = list(CITIES)
    city_cw = list(accumulate(CITIES.values()))
    veh_names = list(VEHICLES)
    veh_cw = list(accumulate(v["share"] for v in VEHICLES.values()))

    riders = [(i, f"{rng.choice(FIRST)} {rng.choice(LAST)}",
               rng.choices(city_names, cum_weights=city_cw)[0],
               (start - timedelta(days=rng.randint(1, 540))).date())
              for i in range(1, a.riders + 1)]
    drivers = [(i, f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                rng.choices(veh_names, cum_weights=veh_cw)[0],
                rng.choices(city_names, cum_weights=city_cw)[0],
                (start - timedelta(days=rng.randint(1, 900))).date())
               for i in range(1, a.drivers + 1)]
    veh_of = {d[0]: d[2] for d in drivers}

    rider_pool, rider_cw = build_pool(rng, riders, 2, lambda: min(rng.paretovariate(1.5), 40))
    driver_pool, driver_cw = build_pool(rng, drivers, 3, lambda: rng.lognormvariate(0, 0.5))
    ok_cities = [c for c in CITIES if rider_pool[c] and driver_pool[c]]
    ok_cw = list(accumulate(CITIES[c] for c in ok_cities))

    area_names = list(AREAS)
    area_cw = list(accumulate(AREAS.values()))
    days = [start + timedelta(days=i) for i in range(a.days)]
    day_cw = list(accumulate(DOW_W[d.weekday()] * (1 + 0.6 * i / a.days) for i, d in enumerate(days)))  # growth trend
    hour_cw = {k: list(accumulate(v)) for k, v in HOUR_W.items()}

    # ~2% of drivers cancel far more often: a planted pattern for the analysis to discover
    bad = set(rng.sample(range(1, a.drivers + 1), max(1, a.drivers // 50)))

    trips = []
    for tid in range(1, a.trips + 1):
        day = rng.choices(days, cum_weights=day_cw)[0]
        hour = rng.choices(range(24), cum_weights=hour_cw[day.weekday() >= 5])[0]
        ts = day.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))
        city = rng.choices(ok_cities, cum_weights=ok_cw)[0]
        rid = rng.choices(rider_pool[city], cum_weights=rider_cw[city])[0]
        did = rng.choices(driver_pool[city], cum_weights=driver_cw[city])[0]

        vt = veh_of[did]
        v = VEHICLES[vt]
        lo, hi = v["dist"]
        dist = round(rng.triangular(lo, hi, lo + (hi - lo) * 0.25), 2)
        surge = rng.choice((1.0, 1.0, 1.2, 1.5)) if hour in PEAK_HOURS else 1.0
        fare = round(max(v["base"], (v["base"] + v["rate"] * dist) * surge + rng.gauss(0, 6)), 2)

        p_cancel = (0.38 if did in bad else 0.08) + (0.03 if hour in PEAK_HOURS else 0)
        status = "Cancelled" if rng.random() < p_cancel else "Completed"
        pay = rng.choices(PAYMENTS, weights=PAY_W["premium" if vt in ("SUV", "Premium") else "default"])[0]

        pick = rng.choices(area_names, cum_weights=area_cw)[0]
        drop = rng.choices(area_names, cum_weights=area_cw)[0]
        while drop == pick:
            drop = rng.choices(area_names, cum_weights=area_cw)[0]
        trips.append((tid, rid, did, ts, f"{pick}, {city}", f"{drop}, {city}", dist, fare, status, pay))
    return riders, drivers, trips


CHECKS = {
    "trips with unknown rider":
        "SELECT COUNT(*) c FROM trips t LEFT JOIN riders r ON r.rider_id=t.rider_id WHERE r.rider_id IS NULL",
    "trips with unknown driver":
        "SELECT COUNT(*) c FROM trips t LEFT JOIN drivers d ON d.driver_id=t.driver_id WHERE d.driver_id IS NULL",
    "trips before rider signup":
        "SELECT COUNT(*) c FROM trips t JOIN riders r ON r.rider_id=t.rider_id WHERE DATE(t.trip_date) < r.signup_date",
    "trips before driver joining":
        "SELECT COUNT(*) c FROM trips t JOIN drivers d ON d.driver_id=t.driver_id WHERE DATE(t.trip_date) < d.joining_date",
    "rider/driver city mismatch":
        "SELECT COUNT(*) c FROM trips t JOIN riders r ON r.rider_id=t.rider_id JOIN drivers d ON d.driver_id=t.driver_id WHERE r.city<>d.city",
    "negative fare or distance":
        "SELECT COUNT(*) c FROM trips WHERE fare<0 OR distance_km<0",
}


def validate(cur):
    print("\nData-quality checks")
    failed = False
    for name, sql in CHECKS.items():
        cur.execute(sql)
        n = cur.fetchone()["c"]
        failed |= n > 0
        print(f"  [{'FAIL' if n else ' OK '}] {name}: {n}")
    cur.execute("""SELECT (SELECT COUNT(*) FROM riders) riders, (SELECT COUNT(*) FROM drivers) drivers,
                          COUNT(*) trips, MIN(trip_date) first_trip, MAX(trip_date) last_trip,
                          ROUND(100*AVG(trip_status='Cancelled'),2) cancel_pct FROM trips""")
    s = cur.fetchone()
    print(f"\nLoaded {s['riders']:,} riders, {s['drivers']:,} drivers, {s['trips']:,} trips "
          f"({s['first_trip']:%Y-%m-%d} to {s['last_trip']:%Y-%m-%d}); cancellation rate {s['cancel_pct']}%")
    return not failed


def main():
    p = argparse.ArgumentParser(description="Seed ride_sharing_db with synthetic data")
    p.add_argument("--riders", type=int, default=5000)
    p.add_argument("--drivers", type=int, default=1000)
    p.add_argument("--trips", type=int, default=100000)
    p.add_argument("--start", default="2025-10-01", help="first day of the trip window (YYYY-MM-DD)")
    p.add_argument("--days", type=int, default=365)
    p.add_argument("--seed", type=int, default=42, help="fixed seed = reproducible dataset")
    a = p.parse_args()

    print("Generating data...")
    riders, drivers, trips = generate(a)

    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        for table in ("trips", "riders", "drivers"):
            cur.execute(f"TRUNCATE TABLE {table}")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")
        print("Inserting riders, drivers, trips...")
        insert_many(cur, "INSERT INTO riders  (rider_id, rider_name, city, signup_date) VALUES (%s,%s,%s,%s)", riders)
        insert_many(cur, "INSERT INTO drivers (driver_id, driver_name, vehicle_type, city, joining_date) VALUES (%s,%s,%s,%s,%s)", drivers)
        insert_many(cur, """INSERT INTO trips (trip_id, rider_id, driver_id, trip_date, pickup_location, drop_location,
                            distance_km, fare, trip_status, payment_method) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", trips)
        ok = validate(cur)
    conn.close()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()