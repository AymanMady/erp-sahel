import type { Company } from "@shared/schema";
import type { PermissionCode } from "@shared/rbac";

/** Identity resolved by `requireAuth` — never supplied by the client. */
export interface AuthContext {
  userId: string;
  username: string;
  isSuperuser: boolean;
  /** Active company of the session (`companyId` claim of the JWT). */
  companyId: string;
  /** Effective permissions within this company. */
  permissions: PermissionCode[];
  /** Modules enabled for this company ([BR-12]). */
  enabledModules: string[];
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      company?: Company;
      companyId?: string;
    }
  }
}

export {};
