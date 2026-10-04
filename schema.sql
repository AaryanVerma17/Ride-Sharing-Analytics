CREATE DATABASE IF NOT EXISTS ride_sharing_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ride_sharing_db;

DROP VIEW  IF EXISTS vw_trip_details;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS riders;
DROP TABLE IF EXISTS drivers;

CREATE TABLE riders (
    rider_id     INT          NOT NULL AUTO_INCREMENT,
    rider_name   VARCHAR(100) NOT NULL,
    city         VARCHAR(50)  NOT NULL,
    signup_date  DATE         NOT NULL,
    PRIMARY KEY (rider_id),
    KEY idx_riders_city (city)
) ENGINE=InnoDB;

CREATE TABLE drivers (
    driver_id     INT          NOT NULL AUTO_INCREMENT,
    driver_name   VARCHAR(100) NOT NULL,
    vehicle_type  ENUM('Bike','Auto','Sedan','SUV','Premium') NOT NULL,
    city          VARCHAR(50)  NOT NULL,
    joining_date  DATE         NOT NULL,
    PRIMARY KEY (driver_id),
    KEY idx_drivers_city_vehicle (city, vehicle_type)
) ENGINE=InnoDB;

CREATE TABLE trips (
    trip_id          INT           NOT NULL AUTO_INCREMENT,
    rider_id         INT           NOT NULL,
    driver_id        INT           NOT NULL,
    trip_date        DATETIME      NOT NULL,
    pickup_location  VARCHAR(100)  NOT NULL,
    drop_location    VARCHAR(100)  NOT NULL,
    distance_km      DECIMAL(6,2)  NOT NULL,
    fare             DECIMAL(10,2) NOT NULL,
    trip_status      ENUM('Completed','Cancelled')     NOT NULL,
    payment_method   ENUM('UPI','Card','Cash','Wallet') NOT NULL,
    PRIMARY KEY (trip_id),
    KEY idx_trips_date          (trip_date),
    KEY idx_trips_rider         (rider_id),
    KEY idx_trips_driver_status (driver_id, trip_status),
    KEY idx_trips_status_date   (trip_status, trip_date),
    CONSTRAINT fk_trips_rider  FOREIGN KEY (rider_id)  REFERENCES riders(rider_id),
    CONSTRAINT fk_trips_driver FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
    CONSTRAINT chk_trips_distance CHECK (distance_km >= 0),
    CONSTRAINT chk_trips_fare     CHECK (fare >= 0)
) ENGINE=InnoDB;

-- One pre-joined, analysis-ready view. The dashboard queries only this.
CREATE OR REPLACE VIEW vw_trip_details AS
SELECT
    t.trip_id,
    t.trip_date,
    DATE(t.trip_date)                  AS trip_day,
    HOUR(t.trip_date)                  AS trip_hour,
    WEEKDAY(t.trip_date)               AS weekday_num,      -- 0 = Monday
    (WEEKDAY(t.trip_date) >= 5)        AS is_weekend,
    DATE_FORMAT(t.trip_date, '%Y-%m')  AS trip_month,
    t.pickup_location,
    t.drop_location,
    CONCAT(t.pickup_location, ' → ', t.drop_location) AS route,
    t.distance_km,
    t.fare,
    t.trip_status,
    t.payment_method,
    r.rider_id,  r.rider_name,
    d.driver_id, d.driver_name, d.vehicle_type,
    d.city
FROM trips t
JOIN riders  r ON r.rider_id  = t.rider_id
JOIN drivers d ON d.driver_id = t.driver_id;