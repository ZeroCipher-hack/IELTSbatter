import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LandingExaminerPreview } from "@/components/landing/LandingExaminerPreview";
import styles from "./landing.module.css";

const skills = [
  { key: "listening", mark: "◖))", score: 7 },
  { key: "reading", mark: "▤", score: 6.5 },
  { key: "writing", mark: "✎", score: 6 },
  { key: "speaking", mark: "◉", score: 6.5 },
] as const;

export default async function LandingPage() {
  const t = await getTranslations("landing");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/" aria-label="IELTSQA home">
          <span className={styles.logoMark}>≋</span>IELTS<span>QA</span>
        </Link>
        <nav aria-label={t("navLabel")}>
          <a href="#skills">{t("navFeatures")}</a>
          <a href="#how">{t("navHow")}</a>
          <Link href="/login">{t("navTests")}</Link>
        </nav>
        <Link className={styles.login} href="/login">{t("navLogin")}</Link>
      </header>

      <main>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{t("eyebrow")}</p>
            <h1>{t("heroTitle")}<span>{t("heroAccent")}</span></h1>
            <p className={styles.intro}>{t("heroSubtitle")}</p>
            <div className={styles.actions}>
              <Link className={styles.cta} href="/register">{t("heroCta")} <span>↗</span></Link>
              <a className={styles.textLink} href="#sample-result">{t("heroSecondary")}</a>
            </div>
            <p className={styles.note}>{t("heroNote")}</p>
          </div>

          <div id="sample-result" className={styles.report}>
            <div className={styles.reportHeader}>
              <div><h2>{t("sampleTitle")}</h2><p>{t("sampleNote")}</p></div>
              <span className={styles.waveMark}>≋</span>
            </div>
            <div className={styles.scoreGrid}>
              <div className={styles.ring}><div><strong>6.5</strong><span>Overall band</span></div></div>
              <ul className={styles.scores}>
                {skills.map(({ key, score, mark }) => (
                  <li key={key}><i>{mark}</i><span>{t(`skill.${key}`)}</span><div><b style={{ width: `${score / 9 * 100}%` }} /></div><strong>{score.toFixed(1)}</strong></li>
                ))}
              </ul>
            </div>
            <div className={styles.weakness}><span>◎</span><div><h3>{t("improveTitle")}</h3><p>{t("improveText")}</p></div></div>
            <div className={styles.plan}><span>▣</span><b>{t("planTitle")}</b><p>{t("planText")}</p></div>
          </div>
        </section>

        <section id="skills" className={styles.section}>
          <p className={styles.eyebrow}>IELTS / 04 SKILLS</p>
          <h2>{t("skillsTitle")}</h2>
          <div className={styles.skillGrid}>
            {skills.map(({ key, mark }) => (
              <Link key={key} href={`/${key}`} className={styles.skillCard}>
                <span className={styles.skillIcon}>{mark}</span>
                <div><h3>{t(`skill.${key}`)}</h3><p>{t(`skillText.${key}`)}</p></div><b>→</b>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.speaking}>
          <div className={styles.conversation}>
            <div className={styles.previewHeader}><span>{t("speakingPreview")}</span><span>PART 1</span></div>
            <LandingExaminerPreview
              question="What do you enjoy about where you live?"
              repeatLabel={t("repeatQuestion")}
              loadingLabel={t("examinerLoading")}
            />
            <p className={styles.note}>{t("speakingPreviewNote")}</p>
          </div>
          <div><p className={styles.eyebrow}>SPEAKING</p><h2>{t("speakingTitle")}</h2><p className={styles.intro}>{t("speakingText")}</p><Link className={styles.textLink} href="/speaking">{t("speakingCta")} →</Link></div>
        </section>

        <section id="how" className={styles.section}>
          <p className={styles.eyebrow}>IELTSQA / 01 — 03</p><h2>{t("howTitle")}</h2>
          <ol className={styles.steps}>{[1,2,3].map(i => <li key={i}><span>0{i}</span><h3>{t(`how${i}Title`)}</h3><p>{t(`how${i}Text`)}</p></li>)}</ol>
        </section>

        <section className={styles.feedback}>
          <div><p className={styles.eyebrow}>{t("feedbackLabel")}</p><h2>{t("feedbackTitle")}</h2><p className={styles.intro}>{t("feedbackText")}</p></div>
          <div className={styles.example}><span>{t("original")}</span><blockquote>“There are many things near my house.”</blockquote><span>{t("better")}</span><blockquote>“There’s a library and a small park within walking distance of my house.”</blockquote><p>{t("explanation")}</p></div>
        </section>

        <section className={styles.finalCta}><h2>{t("ctaTitle")}</h2><p>{t("ctaText")}</p><Link className={styles.cta} href="/register">{t("ctaButton")} ↗</Link></section>
      </main>
      <footer className={styles.footer}><div><span className={styles.logo}><span className={styles.logoMark}>≋</span>IELTS<span>QA</span></span><p>{t("footerTagline")}</p></div><p>{t("footerRights")}</p><Link className={styles.textLink} href="/login">{t("navLogin")} ↗</Link></footer>
    </div>
  );
}
