import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { AuthForm } from "@/components/auth/AuthForm";
import styles from "../auth.module.css";

export default function RegisterPage() {
  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <section className={styles.story}>
          <div><p className={styles.eyebrow}>IELTSQA / START HERE</p><h1>Darajangizni biling.<span>Reja bilan o‘sing.</span></h1></div>
          <div className={styles.skills}><span>◖)) Listening</span><span>▤ Reading</span><span>✎ Writing</span><span>◉ Speaking</span></div>
        </section>
        <section className={styles.form}><Suspense><AuthForm mode="register" /></Suspense></section>
      </main>
    </div>
  );
}
