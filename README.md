# FieldSign

FieldSign is a mobile-first contractor workflow for creating change orders and new-job agreements, collecting client authorization, attaching site evidence, and producing a signed PDF record.

## Local setup

1. Copy `.env.example` to `.env`.
2. Add the Supabase project URL and publishable key.
3. Run both SQL files in `supabase/migrations/` in filename order using the Supabase SQL editor.
4. Enable email sign-in in Supabase Authentication and add the production URL to the allowed redirect URLs.
5. Install and start the app:

```bash
npm ci
npm run dev
```

## Validation

```bash
npm run lint
npm run build
```

## Security model

- Contractors use Supabase email magic-link authentication.
- Row Level Security restricts orders to their authenticated owner.
- Clients use unguessable, expiring signing tokens and restricted database functions.
- Signed records cannot be edited through normal contractor access.
- Dashboard deletion archives a record instead of destroying it.
- Consent, signer name, signature, server timestamp, and browser information are recorded.

## Stripe Connect

FieldSign uses connected Standard accounts and direct charges so each contractor receives client funds in their own Stripe account. Opening Stripe never marks an order paid. A signed order remains `pending` until a verified webhook confirms payment.

Before enabling payments:

1. Register the FieldSign platform in Stripe Connect.
2. Configure the Edge Function secrets listed in `supabase/functions/.env.example`.
3. Deploy `stripe-connect-onboard`, `create-checkout`, and `stripe-webhook`.
4. Configure the Stripe webhook as a Connect webhook that receives events from connected accounts.
5. Subscribe to `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.

Never place a Stripe secret or webhook signing secret in the Vite frontend environment.

## Legacy prototype rows

The migration leaves existing unauthenticated prototype rows inaccessible. After the contractor first signs in, an administrator may assign appropriate legacy rows using the instruction at the bottom of the migration. Only assign rows whose ownership is known.
