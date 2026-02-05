-- Ensure Stripe identifiers are unique when present.
create unique index if not exists profiles_stripe_customer_id_unique_idx
on public.profiles (stripe_customer_id)
where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_unique_idx
on public.profiles (stripe_subscription_id)
where stripe_subscription_id is not null;
