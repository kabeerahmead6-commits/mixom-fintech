<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project architecture
- Keep the customer, agent, and admin experiences in a shared, role-aware mobile-first app shell with separate route pages, while protecting data access in authenticated server functions; this avoids duplicated navigation and client-side privilege checks.
- Keep account identity separate from roles, and grant platform-admin access only after the specified email is confirmed; email addresses supplied during signup are unverified and must never grant privileges.
- Keep wallet balance changes atomic and server-authorized, and keep Eko credentials/signatures in server-only handlers; no browser call may control a wallet or access provider secrets.
- Treat the Eko API as live financial infrastructure: verify every endpoint and request shape against official provider documentation, require user action for a transaction, and do not report success until the provider confirms it.
