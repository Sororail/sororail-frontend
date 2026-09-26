---
title: Amounts and the decimals trap
description: Why every amount is a bigint in the token's smallest unit, and why you read a token's decimals instead of assuming 7.
---

Every amount the SDK sends or returns is a `bigint` counted in the token's
**smallest unit**. For native XLM that unit is the stroop: one XLM is
10,000,000 stroops, because XLM has 7 decimal places. So `15000000n` means
1.5 XLM.

## Why not `number`

JavaScript's `number` is a floating-point value. It holds whole numbers
exactly only up to 2^53, which is well inside the range of a real balance, and
it cannot represent many decimal fractions exactly: `0.1 + 0.2` is not `0.3`.
A payment amount is the wrong place to discover either, so the SDK never uses
`number` for money.

## Converting at the edges

Keep amounts as `bigint` everywhere in your code, and convert only where a
person types or reads one:

- `toStroops("12.50")` turns what someone typed into the smallest unit. It
  takes a **string**, not a number, and refuses an amount with more decimal
  places than the token supports instead of silently dropping the remainder.
- `fromStroops(amount)` turns it back into a decimal string for display. It
  returns a string so that large balances survive the trip.

Both take the token's decimals as a second argument, and default to 7.

## The decimals trap

Seven decimal places is the default for native XLM and classic Stellar assets,
but it is not a guarantee. On Soroban a token is a contract, and a custom token
can declare any number of decimals. The SoroRail contracts work in the token's
smallest unit without knowing or caring which.

Read `decimals()` off the token contract and pass it to `toStroops` and
`fromStroops`, rather than assuming 7. Getting this wrong scales every amount
by a power of ten: a token with 6 decimals shown as if it had 7 displays a
tenth of the real value, and an amount entered that way is ten times too
large.
