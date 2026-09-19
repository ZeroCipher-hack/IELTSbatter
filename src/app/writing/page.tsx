import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { EssayEditor } from "@/components/writing/EssayEditor";
import { env } from "@/lib/env";

export default async function WritingPage() {
  const t = await getTranslations("writing");

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <div className="mt-6">
          <EssayEditor minWords={env.writingMinWords} />
        </div>
      </main>
    </div>
  );
}
