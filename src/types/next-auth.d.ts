import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "member" | "guest";
    } & DefaultSession["user"];
  }

  interface User {
    role?: "admin" | "member" | "guest";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "admin" | "member" | "guest";
  }
}
