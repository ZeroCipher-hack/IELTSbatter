import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { BandBadge } from "@/components/ui/BandBadge";

export default async function LandingPage() {
  const t = await getTranslations("landing");

  return (
    <div className="min-h-screen bg-white">
      <Header />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-600">{t("heroSubtitle")}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-xl bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            {t("heroCta")}
          </Link>
          <a
            href="#how"
            className="rounded-xl border border-gray-300 px-6 py-3 text-base font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t("heroSecondary")}
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold text-gray-900">{t("howTitle")}</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl bg-white p-8 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
                  {i}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">{t(`how${i}Title`)}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{t(`how${i}Text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI evaluation + sample result */}
      <section className="py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">{t("aiTitle")}</h2>
            <p className="mt-4 leading-7 text-gray-600">{t("aiText")}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
            <p className="text-sm font-medium text-gray-500">{t("sampleTitle")}</p>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-5xl font-extrabold text-gray-900">6.5</span>
              <span className="text-sm text-gray-500">Overall</span>
            </div>
            <div className="mt-6 space-y-3">
              {[
                ["Task Response", 6.5],
                ["Coherence & Cohesion", 6.0],
                ["Lexical Resource", 6.5],
                ["Grammar", 6.0],
              ].map(([label, band]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{label}</span>
                  <BandBadge band={band as number} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="border-t border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold text-gray-900">{t("benefitsTitle")}</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-2xl bg-white p-6 shadow-sm">
                <h3 className="font-semibold text-gray-900">{t(`benefit${i}Title`)}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{t(`benefit${i}Text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing placeholder */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900">{t("pricingTitle")}</h2>
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-gray-200 p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
              {t("pricingFreeTitle")}
            </p>
            <p className="mt-3 text-gray-600">{t("pricingFreeText")}</p>
            <p className="mt-4 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
              {t("pricingSoon")}
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold text-gray-900">{t("faqTitle")}</h2>
          <div className="mt-10 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <details key={i} className="group rounded-xl bg-white p-5 shadow-sm">
                <summary className="cursor-pointer list-none font-medium text-gray-900">
                  {t(`faq${i}Q`)}
                </summary>
                <p className="mt-3 text-sm leading-6 text-gray-600">{t(`faq${i}A`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-700 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold text-white">{t("ctaTitle")}</h2>
          <p className="mt-3 text-brand-100">{t("ctaText")}</p>
          <Link
            href="/register"
            className="mt-8 inline-block rounded-xl bg-white px-8 py-3 text-base font-semibold text-brand-700 hover:bg-brand-50"
          >
            {t("ctaButton")}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-sm text-gray-500">
          <span className="font-bold text-gray-800">AXI</span>
          <span>
            © {new Date().getFullYear()} AXI. {t("footerRights")}
          </span>
        </div>
      </footer>
    </div>
  );
}
