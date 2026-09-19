import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { TestRunner } from "@/components/testing/TestRunner";
import { modulePath } from "@/components/testing/ModuleCatalog";
import { getSession } from "@/lib/auth/session";
import { ensureAttempt, getOwnAttempt, getPublicTest, type ObjectiveModule } from "@/lib/testing/service";
import type { AnswerValue } from "@/components/testing/QuestionInput";

/**
 * Server shell for the test runner.
 *
 * The public test payload excludes the answer key, and the attempt is created
 * (or resumed) server-side for the signed-in user only.
 */
export async function ModuleRunnerPage({
  module,
  testId,
}: {
  module: ObjectiveModule;
  testId: string;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("testing");
  const test = await getPublicTest(testId, module);
  if (!test) notFound();

  const attempt = await ensureAttempt({ userId: session.userId, testId, module });
  if (!attempt) notFound();

  const state = await getOwnAttempt(session.userId, attempt.attemptId);
  if (!state) notFound();

  const responses: Record<string, AnswerValue> = {};
  for (const answer of state.answers) {
    if (answer.isCorrect !== null) continue; // graded rows belong to a finished attempt
    responses[answer.questionId] = (answer.response as AnswerValue) ?? null;
  }

  const path = modulePath(module);
  const moduleLabel = module === "READING" ? t("modules.reading") : t("modules.listening");

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{moduleLabel}</p>
            <h1 className="text-xl font-bold text-gray-900">{test.title}</h1>
          </div>
          <Link
            href={`/${path}`}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("exitTest")}
          </Link>
        </div>

        <div className="mt-6">
          <TestRunner
            module={module}
            test={test}
            attemptId={attempt.attemptId}
            startedAt={attempt.startedAt.toISOString()}
            initialResponses={responses}
          />
        </div>
      </main>
    </div>
  );
}
