import http from "k6/http";

export const options = {
  scenarios: {
    homepage: {
      executor: "shared-iterations",
      exec: "homepage",
      vus: 2,
      iterations: 10,
    },
    contacts: {
      executor: "shared-iterations",
      exec: "contacts",
      vus: 1,
      iterations: 5,
    },
  },
};

export function homepage() {
  http.get("https://test.k6.io/");
}

export function contacts() {
  http.get("https://test.k6.io/contacts.php");
}
