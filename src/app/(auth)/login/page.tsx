"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FirebaseError } from "firebase/app";
import { signInWithEmailAndPassword } from "firebase/auth";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { SubmitHandler } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { auth } from "@/config/firebase-client";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const getAuthErrorMessage = (error: unknown) => {
  if (error instanceof FirebaseError) {
    if (
      error.code === "auth/invalid-credential" ||
      error.code === "auth/user-not-found" ||
      error.code === "auth/wrong-password"
    ) {
      return "Email or password is incorrect.";
    }

    if (error.code === "auth/too-many-requests") {
      return "Too many attempts. Take a minute, then try again.";
    }
  }

  return "We could not sign you in. Please try again.";
};

export default function LoginPage() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit: SubmitHandler<LoginFormValues> = async (values) => {
    setAuthError(null);

    try {
      await signInWithEmailAndPassword(auth, values.email, values.password);
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-gray-950 px-4 py-10 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_30%),linear-gradient(135deg,rgba(17,24,39,0.95),rgba(3,7,18,1)_65%)]" />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="rounded-[8px] border border-white/10 bg-white/[0.06] py-0 text-white shadow-2xl shadow-black/40 ring-1 ring-white/10 backdrop-blur-xl">
          <CardHeader className="gap-3 px-6 pt-6">
            <div className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Studio access
            </div>
            <CardTitle className="text-3xl font-semibold tracking-tight text-white">
              Welcome back
            </CardTitle>
            <CardDescription className="text-sm text-gray-400">
              Sign in to continue shaping your next realistic podcast.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-200" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-invalid={Boolean(errors.email)}
                  className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70 focus-visible:ring-amber-300/30"
                  {...register("email")}
                />
                {errors.email ? (
                  <p className="text-sm text-red-300">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-gray-200"
                  htmlFor="password"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-invalid={Boolean(errors.password)}
                  className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70 focus-visible:ring-amber-300/30"
                  {...register("password")}
                />
                {errors.password ? (
                  <p className="text-sm text-red-300">
                    {errors.password.message}
                  </p>
                ) : null}
              </div>

              {authError ? (
                <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {authError}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-11 w-full rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200"
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-400">
              New to the studio?{" "}
              <Link
                className="font-medium text-amber-200 hover:text-amber-100"
                href="/signup"
              >
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
}
