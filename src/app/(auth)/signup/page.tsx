"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { Progress } from "@/components/ui/progress";
import { auth, db } from "@/config/firebase-client";
import { cn } from "@/lib/utils";

const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80),
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(6, "Password must be at least 6 characters."),
    confirmPassword: z
      .string()
      .min(6, "Confirm password must be at least 6 characters."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type SignupFormValues = z.infer<typeof signupSchema>;
type StrengthLevel = "weak" | "medium" | "strong";

interface PasswordStrength {
  label: "Weak" | "Medium" | "Strong";
  level: StrengthLevel;
  value: number;
}

const strengthClass: Record<StrengthLevel, string> = {
  weak: "[&_[data-slot=progress-indicator]]:bg-red-400",
  medium: "[&_[data-slot=progress-indicator]]:bg-amber-300",
  strong: "[&_[data-slot=progress-indicator]]:bg-emerald-300",
};

const getPasswordStrength = (password: string): PasswordStrength => {
  const checks = [
    password.length >= 8,
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];

  const score = checks.filter(Boolean).length;

  if (score >= 5) {
    return { label: "Strong", level: "strong", value: 100 };
  }

  if (score >= 3) {
    return { label: "Medium", level: "medium", value: 66 };
  }

  return {
    label: "Weak",
    level: "weak",
    value: password.length > 0 ? 33 : 0,
  };
};

const getSignupErrorMessage = (error: unknown) => {
  if (error instanceof FirebaseError) {
    if (error.code === "auth/email-already-in-use") {
      return "That email is already connected to an account.";
    }

    if (error.code === "auth/weak-password") {
      return "Choose a stronger password before creating the account.";
    }

    if (error.code === "permission-denied") {
      return "The account was created, but the profile could not be saved.";
    }
  }

  return "We could not create the account. Please try again.";
};

export default function SignupPage() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = useWatch({ control, name: "password" }) ?? "";
  const passwordStrength = useMemo(
    () => getPasswordStrength(password),
    [password]
  );

  const onSubmit: SubmitHandler<SignupFormValues> = async (values) => {
    setAuthError(null);

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        values.email,
        values.password
      );

      await updateProfile(credential.user, {
        displayName: values.name,
      });

      await setDoc(doc(db, "users", credential.user.uid), {
        name: values.name,
        email: values.email,
        plan: "free",
        credits: 3,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setAuthError(getSignupErrorMessage(error));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-gray-950 px-4 py-10 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_28%),linear-gradient(145deg,rgba(3,7,18,1),rgba(17,24,39,0.96)_58%,rgba(0,0,0,1))]" />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 w-full max-w-lg"
      >
        <Card className="rounded-[8px] border border-white/10 bg-white/[0.06] py-0 text-white shadow-2xl shadow-black/40 ring-1 ring-white/10 backdrop-blur-xl">
          <CardHeader className="gap-3 px-6 pt-6">
            <div className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Start free
            </div>
            <CardTitle className="text-3xl font-semibold tracking-tight text-white">
              Build your studio
            </CardTitle>
            <CardDescription className="text-sm text-gray-400">
              Create an account with 3 starter credits.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-200" htmlFor="name">
                  Name
                </label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  aria-invalid={Boolean(errors.name)}
                  className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70 focus-visible:ring-amber-300/30"
                  {...register("name")}
                />
                {errors.name ? (
                  <p className="text-sm text-red-300">{errors.name.message}</p>
                ) : null}
              </div>

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
                  autoComplete="new-password"
                  placeholder="Create a password"
                  aria-invalid={Boolean(errors.password)}
                  className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70 focus-visible:ring-amber-300/30"
                  {...register("password")}
                />
                <div className="space-y-2">
                  <Progress
                    value={passwordStrength.value}
                    className={cn(
                      "bg-white/10",
                      strengthClass[passwordStrength.level]
                    )}
                  />
                  <p className="text-xs text-gray-400">
                    Strength:{" "}
                    <span className="font-medium text-gray-200">
                      {passwordStrength.label}
                    </span>
                  </p>
                </div>
                {errors.password ? (
                  <p className="text-sm text-red-300">
                    {errors.password.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-gray-200"
                  htmlFor="confirmPassword"
                >
                  Confirm password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  aria-invalid={Boolean(errors.confirmPassword)}
                  className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70 focus-visible:ring-amber-300/30"
                  {...register("confirmPassword")}
                />
                {errors.confirmPassword ? (
                  <p className="text-sm text-red-300">
                    {errors.confirmPassword.message}
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
                {isSubmitting ? "Creating account..." : "Create account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-400">
              Already have an account?{" "}
              <Link
                className="font-medium text-amber-200 hover:text-amber-100"
                href="/login"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
}

