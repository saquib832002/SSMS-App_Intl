-- ============================================================================
-- Live bus tracking.
--
-- Reused (Transport):
--   ssms_transport_routes / _stops (stop_order, latitude, longitude, pickup_time, dropoff_time) / _vehicles /
--   _drivers / _assignments (route + vehicle + driver per session) / _enrollments (student, route, pickup / drop stop,
--   transport_type both | pickup | drop).
-- Changed:
--   ssms_transport_drivers.username   the driver's app login (the phone that shares the bus location).
--                                     A login with the same mobile number as the driver is used when it is empty.
-- New:
--   ssms_transport_trips        one run of a route (morning pick-up or afternoon drop) with the last position
--   ssms_transport_trip_points  the positions the driver's phone sent (kept for a few weeks)
--   ssms_transport_trip_stops   each stop of a trip: near / arrived / left
--   ssms_transport_boardings    students marked on the bus (boarded / dropped / absent) on a trip
--   ssms_transport_settings     per-school rules (alert distance, stop radius, which alerts, how long to keep)
-- Safe to run more than once (MariaDB 10.3+).
-- ============================================================================

ALTER TABLE ssms_transport_drivers
  ADD COLUMN IF NOT EXISTS username VARCHAR(100) NULL;

CREATE TABLE IF NOT EXISTS ssms_transport_trips (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ssms_client_code VARCHAR(50)  NOT NULL,
  route_id         INT          NOT NULL,
  vehicle_id       INT          NULL,
  driver_id        INT          NULL,
  session_id       INT          NULL,
  direction        VARCHAR(8)   NOT NULL,                 -- pickup (to school) | drop (from school)
  trip_date        DATE         NOT NULL,                 -- the school's local date
  status           VARCHAR(10)  NOT NULL DEFAULT 'running',   -- running | ended
  run_key          VARCHAR(80)  NULL,                     -- set while running: one running trip per route and direction
  started_at       DATETIME     NOT NULL,                 -- server time (UTC)
  ended_at         DATETIME     NULL,
  started_by       VARCHAR(100) NULL,
  ended_by         VARCHAR(100) NULL,
  end_reason       VARCHAR(20)  NULL,                     -- driver | office | idle
  last_lat         DECIMAL(10,7) NULL,
  last_lng         DECIMAL(10,7) NULL,
  last_speed       DECIMAL(6,2) NULL,                     -- m/s
  last_heading     SMALLINT     NULL,
  last_accuracy    SMALLINT     NULL,                     -- metres
  last_at          DATETIME     NULL,                     -- when the phone took the last position (UTC)
  next_stop_id     INT          NULL,
  avg_speed        DECIMAL(6,2) NULL,                     -- m/s while moving (for arrival times)
  points           INT          NOT NULL DEFAULT 0,
  created          DATETIME     NOT NULL,
  modified         DATETIME     NOT NULL,
  UNIQUE KEY uq_trip_run (run_key),
  KEY idx_trip_day (ssms_client_code, trip_date, status),
  KEY idx_trip_route (ssms_client_code, route_id, trip_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_transport_trip_points (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  trip_id      INT           NOT NULL,
  lat          DECIMAL(10,7) NOT NULL,
  lng          DECIMAL(10,7) NOT NULL,
  speed        DECIMAL(6,2)  NULL,
  heading      SMALLINT      NULL,
  accuracy     SMALLINT      NULL,
  recorded_at  DATETIME      NOT NULL,                    -- when the phone took it (UTC)
  created      DATETIME      NOT NULL,
  KEY idx_point_trip (trip_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_transport_trip_stops (
  trip_id      INT          NOT NULL,
  stop_id      INT          NOT NULL,
  seq          SMALLINT     NOT NULL,                     -- order on this trip
  status       VARCHAR(10)  NOT NULL DEFAULT 'pending',   -- pending | arrived | left | passed
  near_at      DATETIME     NULL,                         -- "bus is near" sent
  arrived_at   DATETIME     NULL,
  left_at      DATETIME     NULL,
  eta_at       DATETIME     NULL,                         -- last estimate
  min_dist     INT          NULL,                         -- closest the bus came (metres): a stop driven past just outside the circle
  PRIMARY KEY (trip_id, stop_id),
  KEY idx_tstop_seq (trip_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE ssms_transport_trip_stops
  ADD COLUMN IF NOT EXISTS min_dist INT NULL;

CREATE TABLE IF NOT EXISTS ssms_transport_boardings (
  trip_id          INT          NOT NULL,
  enrollment_id    VARCHAR(50)  NOT NULL,
  ssms_client_code VARCHAR(50)  NOT NULL,
  status           VARCHAR(10)  NOT NULL,                 -- boarded | dropped | absent
  stop_id          INT          NULL,
  boarded_at       DATETIME     NULL,
  dropped_at       DATETIME     NULL,
  marked_by        VARCHAR(100) NULL,
  modified         DATETIME     NOT NULL,
  PRIMARY KEY (trip_id, enrollment_id),
  KEY idx_board_child (ssms_client_code, enrollment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ssms_transport_settings (
  ssms_client_code VARCHAR(50)  NOT NULL PRIMARY KEY,
  near_minutes     SMALLINT     NOT NULL DEFAULT 5,       -- "bus is near": this many minutes away …
  near_meters      SMALLINT     NOT NULL DEFAULT 1000,    -- … or this close (straight line)
  stop_radius      SMALLINT     NOT NULL DEFAULT 100,     -- metres: the bus is "at" a stop inside this circle
  alert_start      TINYINT(1)   NOT NULL DEFAULT 1,       -- trip started
  alert_near       TINYINT(1)   NOT NULL DEFAULT 1,
  alert_arrived    TINYINT(1)   NOT NULL DEFAULT 1,       -- bus at your stop / reached school
  alert_board      TINYINT(1)   NOT NULL DEFAULT 1,       -- boarded / dropped / marked absent
  keep_days        SMALLINT     NOT NULL DEFAULT 30,      -- positions are deleted after this (trips and boardings stay)
  idle_minutes     SMALLINT     NOT NULL DEFAULT 90,      -- a trip with no position for this long is ended
  maint_on         DATE         NULL,
  modified         DATETIME     NULL,
  modified_by      VARCHAR(100) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
