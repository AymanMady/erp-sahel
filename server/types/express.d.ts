import type { Company } from "@shared/schema";
import type { PermissionCode } from "@shared/rbac";

/** Identité résolue par `requireAuth` — jamais renseignée par le client. */
export interface AuthContext {
  userId: string;
  username: string;
  isSuperuser: boolean;
  /** Société active de la session (claim `companyId` du JWT). */
  companyId: string;
  /** Permissions effectives dans cette société. */
  permissions: PermissionCode[];
  /** Modules activés pour cette société ([BR-12]). */
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
