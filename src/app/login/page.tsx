"use client";

import { useActionState } from "react";
import { Wordmark } from "@app/presentation/brand";
import { Field, TextInput, Button } from "@app/presentation/ui";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-4xl">
          <Wordmark />
        </h1>
        <p className="text-sm text-slate-600">Sign in to your practice.</p>
      </div>
      <form action={formAction} className="flex flex-col gap-4" aria-label="Sign in">
        <Field label="Email" htmlFor="email">
          <TextInput id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <TextInput id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
