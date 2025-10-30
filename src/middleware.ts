const user = process.env.BASIC_USER ?? "";
const pass = process.env.BASIC_PASS ?? "";

export default function middleware(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  if (auth !== expected) {
    return new Response("Auth required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Stock-Dashboard"' },
    });
  }
  return;
}

export const config = {
  matcher: ["/((?!_next|api|favicon.ico|manifest.json|icons).*)"],
};
