import { NextResponse } from "next/server";

/**
 * Placeholder — passes all requests through.
 * Add Supabase session refresh / auth guards when Auth is configured.
 */
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and Next.js internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
