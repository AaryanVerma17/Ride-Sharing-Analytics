-- Showcase queries (MySQL 8+). Run after schema.sql and seed_data.py.
USE ride_sharing_db;

-- 1. Headline KPIs (revenue = completed trips only)
SELECT COUNT(*) AS total_trips,
       SUM(trip_status='Completed') AS completed_trips,
       ROUND(100*SUM(trip_status='Cancelled')/COUNT(*),2) AS cancellation_rate_pct,
       ROUND(SUM(CASE WHEN trip_status='Completed' THEN fare END),0) AS total_revenue,
       ROUND(AVG(CASE WHEN trip_status='Completed' THEN fare END),2) AS avg_fare
FROM trips;

-- 2. Cancellation rate and revenue by city
SELECT city, COUNT(*) AS trips,
       ROUND(100*SUM(trip_status='Cancelled')/COUNT(*),2) AS cancellation_rate_pct,
       ROUND(SUM(CASE WHEN trip_status='Completed' THEN fare END),0) AS revenue
FROM vw_trip_details GROUP BY city ORDER BY revenue DESC;

-- 3. Top 3 drivers per city (CTE + RANK window function)
WITH dr AS (
  SELECT city, driver_id, driver_name,
         SUM(CASE WHEN trip_status='Completed' THEN fare END) AS revenue
  FROM vw_trip_details GROUP BY city, driver_id, driver_name),
ranked AS (SELECT *, RANK() OVER (PARTITION BY city ORDER BY revenue DESC) AS rnk FROM dr)
SELECT city, rnk, driver_name, ROUND(revenue,0) AS revenue
FROM ranked WHERE rnk <= 3 ORDER BY city, rnk;

-- 4. Drivers with unusually high cancellation (HAVING with a minimum-volume guard)
SELECT driver_id, driver_name, city, COUNT(*) AS trips,
       ROUND(100*SUM(trip_status='Cancelled')/COUNT(*),1) AS cancel_rate_pct
FROM vw_trip_details GROUP BY driver_id, driver_name, city
HAVING COUNT(*) >= 30 AND cancel_rate_pct > 25
ORDER BY cancel_rate_pct DESC;

-- 5. Month-over-month revenue growth (LAG)
WITH m AS (SELECT trip_month, SUM(CASE WHEN trip_status='Completed' THEN fare END) AS revenue
           FROM vw_trip_details GROUP BY trip_month)
SELECT trip_month, ROUND(revenue,0) AS revenue,
       ROUND(100*(revenue - LAG(revenue) OVER (ORDER BY trip_month))
                 / LAG(revenue) OVER (ORDER BY trip_month),1) AS mom_growth_pct
FROM m ORDER BY trip_month;

-- 6. Cumulative revenue (running total)
WITH m AS (SELECT trip_month, SUM(CASE WHEN trip_status='Completed' THEN fare END) AS revenue
           FROM vw_trip_details GROUP BY trip_month)
SELECT trip_month, ROUND(revenue,0) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY trip_month),0) AS cumulative_revenue
FROM m;

-- 7. 7-day moving average of daily trips
WITH d AS (SELECT trip_day, COUNT(*) AS trips FROM vw_trip_details GROUP BY trip_day)
SELECT trip_day, trips,
       ROUND(AVG(trips) OVER (ORDER BY trip_day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),1) AS moving_avg_7d
FROM d ORDER BY trip_day;

-- 8. Rider spend quartiles and revenue concentration (NTILE)
WITH s AS (SELECT rider_id, SUM(CASE WHEN trip_status='Completed' THEN fare END) AS spend
           FROM vw_trip_details GROUP BY rider_id),
q AS (SELECT rider_id, spend, NTILE(4) OVER (ORDER BY spend DESC) AS quartile FROM s)
SELECT quartile, COUNT(*) AS riders, ROUND(SUM(spend),0) AS revenue,
       ROUND(100*SUM(spend)/SUM(SUM(spend)) OVER (),1) AS revenue_share_pct
FROM q GROUP BY quartile ORDER BY quartile;

-- 9. One-time vs repeat riders
WITH r AS (SELECT rider_id, COUNT(*) AS trips FROM trips GROUP BY rider_id)
SELECT CASE WHEN trips = 1 THEN 'One-time' ELSE 'Repeat' END AS rider_type,
       COUNT(*) AS riders, ROUND(100*COUNT(*)/SUM(COUNT(*)) OVER (),1) AS share_pct
FROM r GROUP BY rider_type;

-- 10. Peak hours: weekday vs weekend
SELECT CASE WHEN is_weekend THEN 'Weekend' ELSE 'Weekday' END AS day_type, trip_hour, COUNT(*) AS trips
FROM vw_trip_details GROUP BY day_type, trip_hour ORDER BY day_type, trips DESC;

-- 11. Top 10 routes by revenue
SELECT route, COUNT(*) AS trips, ROUND(SUM(CASE WHEN trip_status='Completed' THEN fare END),0) AS revenue
FROM vw_trip_details GROUP BY route ORDER BY revenue DESC LIMIT 10;

-- 12. Fare per km and average fare by vehicle type
SELECT vehicle_type, ROUND(AVG(fare),2) AS avg_fare,
       ROUND(SUM(fare)/SUM(distance_km),2) AS fare_per_km
FROM vw_trip_details WHERE trip_status='Completed'
GROUP BY vehicle_type ORDER BY fare_per_km DESC;