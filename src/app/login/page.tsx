import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { AuthForm } from "@/components/auth/AuthForm";
import styles from "../auth.module.css";

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <section className={styles.story}>
          <div><p className={styles.eyebrow}>IELTSQA / STUDENT WORKSPACE</p><h1>Bir maqsad.<span>To‘rtta ko‘nikma.</span></h1></div>
          <div className={styles.skills}><span>◖)) Listening</span><span>▤ Reading</span><span>✎ Writing</span><span>◉ Speaking</span></div>
        </section>
        <section className={styles.form}><Suspense><AuthForm mode="login" /></Suspense></section>
      </main>
    </div>
  );
}
