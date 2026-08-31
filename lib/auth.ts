import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { SIGNUP_FREE_CREDITS } from "@/lib/constants";
import { consume, reset, LIMITS } from "@/lib/core/limits";
import { actorHash } from "@/lib/core/request";
import { recordSecurityEvent } from "@/lib/core/audit";

/**
 * A real bcrypt hash of a value nobody will guess. Comparing against this when
 * the account does not exist keeps the failure path the same length as a wrong
 * password, so response time stops revealing which addresses are registered.
 */
const DUMMY_HASH = "$2b$12$HNngD93onCMDkh7LtH72Nu9BB5eo6eNST1AE6Wgx4DHQp4PtXBhSu";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Credentials sign-in requires JWT sessions; the adapter still owns user rows.
  session: { strategy: "jwt" },
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Auto-linking by email address is an account-takeover path: register
      // with a victim's address and a password of your choosing, wait for them
      // to sign in with Google, and the provider account attaches to the row
      // whose password you already control. Auth.js answers an unlinked match
      // with OAuthAccountNotLinked, which /auth-error explains.
      allowDangerousEmailAccountLinking: false,
    }),
    Credentials({
      credentials: {
        email: { label: "E-posta", type: "email" },
        password: { label: "Şifre", type: "password" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email.toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const ip =
          request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request?.headers?.get("x-real-ip")?.trim() ??
          "unknown";
        const actor = actorHash(ip);
        const account = actorHash(email);

        // Two windows: one stops a single address being hammered from a
        // botnet, the other stops one host spraying many addresses.
        const perAccount = await consume(LIMITS.loginByAccount, account);
        const perIp = await consume(LIMITS.loginByIp, actor);
        if (!perAccount.allowed || !perIp.allowed) {
          await recordSecurityEvent({
            kind: "login_throttled",
            actorHash: actor,
            detail: perAccount.allowed ? "address spray" : "repeated failures for one account",
          });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Always run a comparison, even with no account and no stored hash, so
        // the timing of every failure looks alike.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user?.passwordHash || !valid) {
          await recordSecurityEvent({
            kind: "login_failed",
            userId: user?.id ?? null,
            actorHash: actor,
          });
          return null;
        }

        // A clean sign-in clears the account counter so a legitimate user who
        // mistyped a few times is not left locked out behind an attacker.
        await reset(LIMITS.loginByAccount, account);

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/auth-error",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as typeof session.user & { id: string }).id = token.uid as string;
      }
      return session;
    },
  },
  events: {
    // The schema default covers the usual case; this keeps the grant correct
    // when SIGNUP_FREE_CREDITS is overridden.
    async createUser({ user }) {
      if (user.id && SIGNUP_FREE_CREDITS !== 2000) {
        await prisma.user.update({
          where: { id: user.id },
          data: { credits: SIGNUP_FREE_CREDITS },
        });
      }
    },
  },
});
