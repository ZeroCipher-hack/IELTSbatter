import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { AuthForm } from "@/components/auth/AuthForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="flex items-center justify-center px-4 py-16">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </main>
    </div>
  );
}
