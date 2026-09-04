# Monetization

Not built. This records the shape we agreed so the boundary is designed in rather
than retrofitted, and names the one question still open.

## Why an extension can carry a paid product

Form filling has to happen inside the page the user is on, which makes an
extension the only workable surface — not a compromise chosen for speed. That
also means the client is fully inspectable, so anything worth paying for must be
gated somewhere the user cannot patch.

Chrome Web Store no longer processes payments. Entitlement is therefore ours: the
extension authenticates against our backend and asks whether this account may do
the thing. That is normal for paid extensions and needs no special permission.

## The boundary

Entitlement sits exactly where auth and billing already sit in
[privacy.md](./privacy.md): cloud-eligible, and carrying nothing personal.

An entitlement check may send an account identifier, a plan tier and a count. It
may not send a concept key, a field label, an origin with a query string, a form
value, a file name, or anything derived from memory. The backend can know *that*
a user filled a form. It must not be able to learn *which* form or *what with*.

Restated as a rule: entitlement is allowed to know how much the user used the
product, and nothing about what the product was used on.

## The open question: what a "use" is

Two shapes, and this is a pricing decision rather than an architectural one.

**Per fill.** Truest to "paid per use", so revenue tracks value delivered and the
incentive to keep it working is direct. Costs a network round-trip on the single
action that should feel instant, and adds a failure mode to every fill — offline,
backend down, latency spike. It is also the most attractive thing in the codebase
to patch out, because one bypass unlocks unlimited use.

**Per active day or session.** One check, amortised over everything the user does
that day. Keeps the recurring-revenue motive, removes the per-fill failure mode,
and makes a bypass worth less. Loses granularity in pricing.

Leaning toward per active day, with per-fill counting kept locally and reported
only as an aggregate if it is ever needed for billing. Revisit against real usage
before building either.

Whichever is chosen, two rules hold:

**A failed check degrades, it does not brick.** Network failure must not strand a
user mid-form. Grace on failure, with the check retried later; a paid product that
stops working on a train is worse than one that occasionally gives away a day.

**Nothing about entitlement touches the fill path's data.** The check is a
separate call with its own payload. It never rides along with anything that has
seen memory.

## What stays free

The local, deterministic core — alias matching, stored values, filling, freshness
confirmation — is what makes the privacy claim true, and gating it would make the
product worse at the thing it is for. Paid tiers should be the layer above:
semantic retrieval, custom ontology, multi-device sync, team and admin features.

That also keeps the incentives honest. If revenue came from the core, there would
be a reason to make the model call more often, and the whole design points the
other way.
