/**
 * The platform super-administrator: **one** account, defined by the server
 * configuration (`SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD`), never by the
 * application.
 *
 * - It is (re)created at every server start, after a database restore and whenever
 *   someone signs in with its name: whatever happens in the application (account
 *   disabled, database replaced), it can always sign in with the configured password.
 * - It belongs to no company and holds no role: the users and roles screens of a
 *   company never list it.
 * - It is the only account allowed to see the technical screens (data sending,
 *   database). Any other account still flagged as super-administrator (older
 *   databases gave that flag to the company administrator) loses the flag — it keeps
 *   its company roles.
 */

import { and, eq, ne, sql } from "drizzle-orm";

import { userCompanies, users } from "@shared/schema";
import { db } from "../../db";
import { logger } from "../../shared/logging/logger";
import { hashPassword, verifyPassword } from "../auth/application";
import { invalidateAllSessionStates } from "../auth/guards";

const DEFAULT_USERNAME = "superadmin";
/** Development password: refused in production. */
const DEV_PASSWORD = "SuperAdmin123!";

function isStrongEnough(password: string): boolean {
  return password.length >= 12 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

/** Configured credentials, or `null` when production has no usable password. */
function configuredCredentials(): { username: string; password: string } | null {
  const username = (process.env.SUPERADMIN_USERNAME ?? "").trim() || DEFAULT_USERNAME;
  const production = process.env.NODE_ENV === "production";
  const password = process.env.SUPERADMIN_PASSWORD ?? (production ? "" : DEV_PASSWORD);
  if (production && (password === DEV_PASSWORD || !isStrongEnough(password))) {
    logger.error(
      "SUPERADMIN_PASSWORD is missing or too weak: the super-administrator account was not " +
        "set up. Set a password of at least 12 characters, with letters and digits."
    );
    return null;
  }
  return { username, password };
}

/** True for the configured super-administrator's username (case ignored). */
export function isSuperAdminUsername(username: string): boolean {
  const configured = (process.env.SUPERADMIN_USERNAME ?? "").trim() || DEFAULT_USERNAME;
  return username.trim().toLowerCase() === configured.toLowerCase();
}

/**
 * Creates or repairs the super-administrator account. Never throws: a failure is
 * logged and the application keeps running.
 */
export async function ensureSuperAdmin(): Promise<void> {
  const credentials = configuredCredentials();
  if (!credentials) return;
  try {
    const findUser = async () =>
      (
        await db
          .select()
          .from(users)
          .where(sql`lower(${users.username}) = lower(${credentials.username})`)
          .limit(1)
      )[0];

    let user = await findUser();

    // An ordinary account of a company already has this name: taking it over would
    // hand a shop's account to the platform.
    if (user && !user.isSuperuser) {
      const [membership] = await db
        .select({ id: userCompanies.id })
        .from(userCompanies)
        .where(eq(userCompanies.userId, user.id))
        .limit(1);
      if (membership) {
        logger.error(
          `SUPERADMIN_USERNAME "${credentials.username}" is already used by a company account: ` +
            "choose another name. The super-administrator account was not set up."
        );
        return;
      }
    }

    if (!user) {
      await db
        .insert(users)
        .values({
          username: credentials.username,
          passwordHash: await hashPassword(credentials.password),
          email: "",
          firstName: "Super administrateur",
          lastName: "",
          isSuperuser: true,
          allowOfflineLogin: false,
          mustChangePassword: false,
        })
        // Several instances starting together: the first one creates it.
        .onConflictDoNothing();
      user = await findUser();
      if (!user) return;
      logger.info("Super-administrator account created", { username: credentials.username });
    }

    const passwordMatches = await verifyPassword(credentials.password, user.passwordHash);
    const needsRepair =
      !passwordMatches ||
      !user.isActive ||
      !user.isSuperuser ||
      user.mustChangePassword ||
      user.allowOfflineLogin;
    if (needsRepair) {
      const now = new Date();
      await db
        .update(users)
        .set({
          isActive: true,
          isSuperuser: true,
          mustChangePassword: false,
          // Never copied to a till: offline sign-in is for shop staff.
          allowOfflineLogin: false,
          ...(passwordMatches
            ? {}
            : // A new password in the configuration closes the sessions opened with the old one.
              { passwordHash: await hashPassword(credentials.password), sessionsValidAfter: now }),
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    }

    const demoted = await db
      .update(users)
      .set({ isSuperuser: false, updatedAt: new Date() })
      .where(and(eq(users.isSuperuser, true), ne(users.id, user.id)))
      .returning({ username: users.username });
    if (demoted.length > 0) {
      logger.info("Super-administrator flag removed from other accounts", {
        usernames: demoted.map((row) => row.username),
      });
    }
    if (needsRepair || demoted.length > 0) invalidateAllSessionStates();
  } catch (error) {
    logger.error("Super-administrator setup failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
