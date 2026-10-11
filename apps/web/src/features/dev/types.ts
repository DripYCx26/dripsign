/** One development identity, as the seed names it. */
export interface DevIdentity {
  readonly email: string;
  readonly name: string;
  readonly roleLine: string;
  readonly homes: readonly ("staff" | "recipient")[];
}
