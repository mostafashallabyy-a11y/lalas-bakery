import { Options } from "k6/options";

export const options = {
  // Global thresholds - must pass for all test types
  thresholds: {
    http_req_duration: ["p(95)<800"], // 95% of requests under 800ms
    http_req_failed: ["rate<0.01"],   // error rate under 1%
    http_req_duration: ["avg<300"],   // average under 300ms
  },

  // Default tags for all metrics
  tags: {
    environment: "staging",
    service: "lalas-bakery",
  },
};

export const scenarios = {
  // Smoke test - 5 users, verify basic functionality
  smoke: {
    executor: "constant-vus",
    vus: 5,
    duration: "2m",
    exec: "browseAndOrder",
  },

  // Average load - 50 concurrent users
  average: {
    executor: "constant-vus",
    vus: 50,
    duration: "10m",
    exec: "browseAndOrder",
  },

  // Peak load - 150 concurrent users
  peak: {
    executor: "constant-vus",
    vus: 150,
    duration: "10m",
    exec: "browseAndOrder",
  },

  // Spike test - ramp 0 to 200 in 30 seconds
  spike: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "30s", target: 200 },
      { duration: "1m", target: 200 },
      { duration: "30s", target: 0 },
    ],
    exec: "browseAndOrder",
  },

  // Soak test - 30 users for 20 minutes
  soak: {
    executor: "constant-vus",
    vus: 30,
    duration: "20m",
    exec: "browseAndOrder",
  },
};
