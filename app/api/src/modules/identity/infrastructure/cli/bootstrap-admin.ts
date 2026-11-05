import 'dotenv/config';
import { isEmail } from 'class-validator';
import { pathToFileURL } from 'node:url';
import { PrismaService } from '../../../../platform/database/prisma.service.js';

export interface BootstrapAdminResult {
  id: string;
  email: string;
  alreadyAdmin: boolean;
}

/** Explicit server-operator command; never exposed through the public API. */
export async function bootstrapAdmin(
  prisma: PrismaService,
  email: string,
): Promise<BootstrapAdminResult> {
  const emailNormalized = email.trim().toLowerCase();
  if (emailNormalized.length > 254 || !isEmail(emailNormalized)) {
    throw new Error('A valid existing account email is required');
  }
  return prisma.$transaction(async (tx) => {
    // Obtain SQLite's write lock before reading the administrator count. A plain
    // SQL no-op leaves updatedAt and authVersion unchanged on idempotent runs.
    await tx.$executeRaw`
      UPDATE "User" SET "authVersion" = "authVersion"
      WHERE "emailNormalized" = ${emailNormalized}
        AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
    `;
    const user = await tx.user.findFirst({
      where: { emailNormalized, status: 'ACTIVE', deletedAt: null },
    });
    if (!user)
      throw new Error(
        'An active, nondeleted account with this email is required',
      );
    if (user.role === 'ADMIN') {
      return { id: user.id, email: user.emailNormalized, alreadyAdmin: true };
    }
    if (user.role !== 'USER')
      throw new Error('Account has an unsupported role');
    const existingAdmins = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    });
    if (existingAdmins > 0) {
      throw new Error(
        'An active administrator already exists; use the administrator API to manage roles',
      );
    }
    const result = await tx.user.updateMany({
      where: {
        id: user.id,
        role: 'USER',
        status: 'ACTIVE',
        deletedAt: null,
        authVersion: user.authVersion,
      },
      data: { role: 'ADMIN', authVersion: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new Error('Account changed during bootstrap; retry the command');
    await tx.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { id: user.id, email: user.emailNormalized, alreadyAdmin: false };
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error(
      'Usage: npm run identity:bootstrap-admin -- existing-user@example.com',
    );
  }
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const result = await bootstrapAdmin(prisma, args[0]);
    console.log(
      result.alreadyAdmin
        ? `Account ${result.email} is already an active administrator.`
        : `Account ${result.email} is now the initial administrator. Sign in again to use the new role.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Administrator bootstrap failed',
    );
    process.exitCode = 1;
  });
}
