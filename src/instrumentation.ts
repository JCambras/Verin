// The web runtime role's composition root (prompt 2 section 3): register() runs once per server
// process and module reloads never re-enter it; tooling roots are the entry scripts under src/tools/.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    (await import("./runtime/governed")).createGovernedRuntime("web");
  }
}
