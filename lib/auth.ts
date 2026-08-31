import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { SIGNUP_FREE_CREDITS } from "@/lib/constants";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
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
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        (session.user as typeof session.user & { id: string }).id = user.id;
        (session.user as typeof session.user & { credits: number }).credits = (
          user as typeof user & { credits: number }
        ).credits;
      }
      return session;
    },
  },
});
