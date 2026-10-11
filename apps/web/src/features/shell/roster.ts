import "server-only";
import { listStaff, type StaffMember } from "@dripsign/core/domain/staff";
import type { StaffActor } from "@dripsign/core/types";

export type RosterMember = StaffMember;

/** The live staff of the actor's tenant; the core scopes it to the actor and checks the role. */
export function loadRoster(actor: StaffActor): Promise<readonly RosterMember[]> {
  return listStaff(actor);
}
