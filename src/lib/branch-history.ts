import type { WorkspaceData } from "./domain";
import type { PageInfo } from "./workflow/query";
export interface BranchHistory {
  rows: NonNullable<WorkspaceData["transfers"]>;
  pending: number;
  pagination: PageInfo;
}
