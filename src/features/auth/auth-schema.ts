import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(320, "Email is too long.")
  .transform((value) => value.toLowerCase());

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(128),
});

export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(160, "Name is too long."),
    email: emailSchema,
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(128)
      .regex(/[a-z]/, "Add a lowercase letter.")
      .regex(/[A-Z]/, "Add an uppercase letter.")
      .regex(/[0-9]/, "Add a number.")
      .regex(/[^A-Za-z0-9]/, "Add a symbol."),
    confirmPassword: z
      .string()
      .min(1, "Confirm your password.")
      .max(128),
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;
