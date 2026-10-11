// The demo cast. Staff and tenants are inserted directly (no command creates a tenant);
// recipients arrive through the agreements.
import type { StaffRole } from "../types.ts";

export interface Person {
  readonly email: string;
  readonly name: string;
}

export const NORTHWIND = "Northwind Studio";
export const HARBOR = "Harbor Legal";

export const AVERY: Person = { email: "avery@northwind.test", name: "Avery Chen" };
export const SAM: Person = { email: "sam@northwind.test", name: "Sam Rivera" };
export const PRIYA: Person = { email: "priya@harbor.test", name: "Priya Nair" };
export const JORDAN: Person = { email: "jordan@client.test", name: "Jordan Lee" };
export const MORGAN: Person = { email: "morgan@client.test", name: "Morgan Diaz" };
export const TAYLOR: Person = { email: "taylor@client.test", name: "Taylor Kim" };

export interface StaffSeed {
  readonly tenant: string;
  readonly person: Person;
  readonly role: StaffRole;
}

export const STAFF: readonly StaffSeed[] = [
  { tenant: NORTHWIND, person: AVERY, role: "admin" },
  { tenant: NORTHWIND, person: SAM, role: "member" },
  { tenant: HARBOR, person: PRIYA, role: "admin" },
];

/** Picker order: staff first, then the clients. */
export const DEV_EMAILS: readonly string[] = [AVERY, SAM, PRIYA, JORDAN, MORGAN, TAYLOR].map(
  (person) => person.email,
);
