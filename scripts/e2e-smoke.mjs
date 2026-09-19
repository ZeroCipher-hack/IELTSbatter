/**
 * End-to-end smoke test for the whole AXI learner journey.
 *
 * REGISTER -> LOGIN -> DASHBOARD -> WRITING -> WRITING RESULT ->
 * READING -> RESULT -> LISTENING -> RESULT -> SPEAKING (record/upload ->
 * mock transcription -> mock evaluation) -> RESULT -> DASHBOARD -> HISTORY
 *
 * Every step checks the HTTP status AND the payload/DB state that the step is
 * supposed to produce. No external AI provider is contacted: with AI_MODE=mock
 * the mock providers answer, and everything they produce is flagged isMock.
 *
 * Usage:
 *   npm run e2e                     # against the running server (default :3000)
 *   BASE_URL=http://localhost:3100 node --env-file=.env scripts/e2e-smoke.mjs
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DB_URL = process.env.DATABASE_URL ?? "postgresql://axi:axi@localhost:5432/axi";
const testIdSuffix = Date.now().toString().slice(-7);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });

let passed = 0;
const failures = [];
const jar = new Map();

function rememberCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function api(path, { method = "GET", body, headers = {}, form, auth = true } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Cookie: cookieHeader() } : {}),
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
    redirect: "manual",
  });
  rememberCookies(response);
  return response;
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text.slice(0, 300) };
  }
}

function check(step, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${step}`);
  } else {
    failures.push(`${step}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${step}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function htmlOk(path, label, needles = []) {
  const response = await api(path);
  const html = await response.text();
  check(`${label} page renders (200)`, response.status === 200, `status ${response.status}`);
  for (const needle of needles) {
    check(`${label} contains "${needle}"`, html.includes(needle));
  }
  return html;
}

const emailPhone = `+99890${testIdSuffix}`;
const intruderPhone = `+99891${testIdSuffix}`;
const password = "E2ePassword123";

async function main() {
  section("1. REGISTER + LOGIN");
  {
    const registered = await api("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { name: "E2E Smoke", phone: emailPhone, password },
    });
    check("register returns 201", registered.status === 201, `status ${registered.status}`);

    const loggedIn = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { phone: emailPhone, password },
    });
    const loginBody = await json(loggedIn);
    check("login returns 200", loggedIn.status === 200, `status ${loggedIn.status}`);
    check("login returns the user id", typeof loginBody.user?.id === "string");
    check("session cookie issued", jar.has("axi_session"));
  }

  const user = await prisma.user.findUnique({ where: { phone: emailPhone } });
  check("user row exists in the database", Boolean(user));

  section("2. ANONYMOUS PROTECTION");
  {
    for (const [path, method] of [
      ["/api/tests/reading", "GET"],
      ["/api/tests/listening", "GET"],
      ["/api/speaking/tests", "GET"],
      ["/api/attempts", "POST"],
      ["/api/speaking/submissions", "POST"],
      ["/api/audio/unknown-id", "GET"],
    ]) {
      const response = await api(path, { method, auth: false, body: method === "POST" ? {} : undefined });
      check(`anonymous ${method} ${path} -> 401`, response.status === 401, `status ${response.status}`);
    }
  }

  section("3. DASHBOARD (empty state)");
  await htmlOk("/dashboard", "dashboard", ["Modullar bo'yicha natijalar", "module-card-WRITING"]);

  section("4. WRITING -> SUBMIT -> RESULT");
  let writingSubmissionId = null;
  {
    const essay = Array(260).fill("This is a sentence about the topic.").join(" ");
    const idempotencyKey = `e2e-writing-${crypto.randomUUID()}`;
    const submitted = await api("/api/writing/submit", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: {
        question: "Some people think technology makes life easier. Discuss both views and give your own opinion.",
        essay,
        testType: "TASK_2",
      },
    });
    const body = await json(submitted);
    check("writing submit returns 200", submitted.status === 200, `status ${submitted.status}`);
    check("writing submission id returned", typeof body.submissionId === "string", JSON.stringify(body).slice(0, 160));
    writingSubmissionId = body.submissionId;

    if (writingSubmissionId) {
      const submission = await prisma.submission.findUnique({
        where: { id: writingSubmissionId },
        include: { score: true, feedback: true },
      });
      check("writing submission stored as COMPLETED", submission?.status === "COMPLETED", submission?.status);
      check("writing score stored", Boolean(submission?.score));
      check("writing feedback stored", Boolean(submission?.feedback));

      const resultPage = await api(`/writing/result/${writingSubmissionId}`);
      check("writing result page renders", resultPage.status === 200, `status ${resultPage.status}`);

      const retried = await api("/api/writing/submit", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: {
          question: "Some people think technology makes life easier. Discuss both views and give your own opinion.",
          essay,
          testType: "TASK_2",
        },
      });
      const retryBody = await json(retried);
      check("writing transport retry returns 200", retried.status === 200, `status ${retried.status}`);
      check("writing retry returns the same submission", retryBody.submissionId === writingSubmissionId);
      check(
        "writing idempotency key has one DB row",
        await prisma.submission.count({ where: { userId: user.id, idempotencyKey } }) === 1
      );
    }

    // A short essay must be rejected rather than graded.
    const short = await api("/api/writing/submit", {
      method: "POST",
      body: { question: "Short one", essay: "too short", testType: "TASK_2" },
    });
    check("writing rejects a too-short essay (400)", short.status === 400, `status ${short.status}`);
  }

  section("5. READING -> SUBMIT -> RESULT");
  let readingAttemptId = null;
  let readingBand = null;
  {
    const catalog = await api("/api/tests/reading");
    const { tests } = await json(catalog);
    check("reading catalog returns 200", catalog.status === 200);
    check("reading catalog has tests", Array.isArray(tests) && tests.length > 0);

    const testId = tests[0].id;
    const testResponse = await api(`/api/tests/reading/${testId}`);
    const publicPayload = await json(testResponse);
    check("reading test returns 200", testResponse.status === 200);
    check(
      "reading test hides the answer key",
      !JSON.stringify(publicPayload).includes('"answer"') &&
        !JSON.stringify(publicPayload).includes("explanation")
    );

    const started = await api("/api/attempts", {
      method: "POST",
      body: { module: "READING", testId },
    });
    const { attemptId } = await json(started);
    check("reading attempt created (201)", started.status === 201, `status ${started.status}`);
    readingAttemptId = attemptId;

    // Answer from the stored key: 10 correct, 4 deliberately wrong.
    const questions = await prisma.testQuestion.findMany({
      where: { section: { testId } },
      orderBy: { number: "asc" },
    });
    const responses = {};
    questions.forEach((question, index) => {
      responses[question.id] = index < 10 ? question.answer.answers[0] : "definitely-wrong";
    });

    const partial = Object.fromEntries(Object.entries(responses).slice(0, 5));
    const saved = await api(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      body: { responses: partial },
    });
    check("reading autosave returns 200", saved.status === 200, `status ${saved.status}`);

    const submitted = await api(`/api/attempts/${attemptId}/submit`, {
      method: "POST",
      body: { responses },
    });
    const submitBody = await json(submitted);
    check("reading submit returns 200", submitted.status === 200, `status ${submitted.status}`);
    check("reading score is 10/14", submitBody.result?.correctCount === 10, JSON.stringify(submitBody.result));
    check("reading band is 6.5", submitBody.result?.band === 6.5, String(submitBody.result?.band));
    readingBand = submitBody.result?.band;

    const attemptRow = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: true },
    });
    check("reading attempt stored as GRADED", attemptRow?.status === "GRADED", attemptRow?.status);
    check("reading answers persisted", attemptRow?.answers.length === questions.length);

    const resultResponse = await api(`/api/attempts/${attemptId}/result`);
    const resultBody = await json(resultResponse);
    check("reading result API returns 200", resultResponse.status === 200);
    check("reading result reveals the key to the owner", Array.isArray(resultBody.result?.review));
    check(
      "reading result marks non-mock module",
      resultBody.result?.isMock === false
    );

    await htmlOk(`/reading/result/${attemptId}`, "reading result", [
      "Umumiy ball",
      "Xatolar tahlili",
      "Kuchli tomonlar",
    ]);
    await htmlOk("/reading", "reading catalog", ["Mavjud testlar"]);
  }

  section("6. LISTENING -> SUBMIT -> RESULT");
  let listeningAttemptId = null;
  {
    const catalog = await api("/api/tests/listening");
    const { tests } = await json(catalog);
    check("listening catalog has tests", Array.isArray(tests) && tests.length > 0);

    const testId = tests[0].id;
    const testResponse = await api(`/api/tests/listening/${testId}`);
    const testBody = await json(testResponse);
    const audioUrl = testBody.test?.sections?.find((s) => s.audioUrl)?.audioUrl;
    check("listening test exposes an audio URL", typeof audioUrl === "string", String(audioUrl));
    check("listening audio is served from the public path", audioUrl?.startsWith("/audio/"));

    if (audioUrl) {
      const audioResponse = await fetch(`${BASE}${audioUrl}`);
      check("listening audio file downloads (200)", audioResponse.status === 200, `status ${audioResponse.status}`);
      check(
        "listening audio content-type is audio",
        (audioResponse.headers.get("content-type") ?? "").startsWith("audio"),
        audioResponse.headers.get("content-type") ?? ""
      );
    }

    const started = await api("/api/attempts", { method: "POST", body: { module: "LISTENING", testId } });
    const { attemptId } = await json(started);
    listeningAttemptId = attemptId;
    check("listening attempt created", started.status === 201);

    const questions = await prisma.testQuestion.findMany({ where: { section: { testId } } });
    const responses = Object.fromEntries(
      questions.map((question, index) => [question.id, index < 6 ? question.answer.answers[0] : "wrong"])
    );

    const submitted = await api(`/api/attempts/${attemptId}/submit`, {
      method: "POST",
      body: { responses },
    });
    const body = await json(submitted);
    check("listening submit returns 200", submitted.status === 200, `status ${submitted.status}`);
    check("listening correct count is 6", body.result?.correctCount === 6, JSON.stringify(body.result));

    await htmlOk(`/listening/result/${attemptId}`, "listening result", ["Umumiy ball", "Xatolar tahlili"]);
    await htmlOk(`/listening/${testId}`, "listening runner", ["data-testid=\"timer\""]);
    await htmlOk("/listening", "listening catalog", ["Mavjud testlar"]);
  }

  section("7. SPEAKING -> UPLOAD -> MOCK TRANSCRIPTION -> MOCK EVALUATION -> RESULT");
  let speakingSubmissionId = null;
  let recordingAssetId = null;
  {
    const catalog = await api("/api/speaking/tests");
    const { tests } = await json(catalog);
    check("speaking catalog has tests", Array.isArray(tests) && tests.length > 0);

    const testId = tests[0].id;
    const testResponse = await api(`/api/speaking/tests/${testId}`);
    const testBody = await json(testResponse);
    const prompt = testBody.test?.prompts?.[0];
    check("speaking test exposes prompts with timers", typeof prompt?.speakingSeconds === "number");

    const started = await api("/api/speaking/submissions", {
      method: "POST",
      body: { testId, promptId: prompt?.id },
    });
    const created = await json(started);
    check("speaking submission created (201)", started.status === 201, `status ${started.status}`);
    speakingSubmissionId = created.submissionId;

    const interview = await prisma.speakingInterview.findUnique({
      where: { submissionId: speakingSubmissionId },
    });
    check("speaking interview state persisted", interview?.state === "PREPARING", interview?.state);

    // Upload one generated WAV per part. Preparation time is advanced in the
    // database so the API still performs the authoritative timer validation.
    const wav = makeWav(2);
    for (let part = 1; part <= 3; part += 1) {
      await prisma.speakingInterview.update({
        where: { id: interview.id },
        data: { stateStartedAt: new Date(Date.now() - 70_000) },
      });

      const transitioned = await api(`/api/speaking/interviews/${interview.id}/transition`, {
        method: "POST",
        body: { action: "BEGIN_PART" },
      });
      const transitionBody = await json(transitioned);
      check(`speaking Part ${part} transition returns 200`, transitioned.status === 200, `status ${transitioned.status}`);
      check(`speaking Part ${part} state is server-owned`, transitionBody.interview?.state === `PART_${part}`);

      const duplicateTransition = await api(`/api/speaking/interviews/${interview.id}/transition`, {
        method: "POST",
        body: { action: "BEGIN_PART" },
      });
      check(`speaking Part ${part} duplicate transition is idempotent`, duplicateTransition.status === 200);

      const recovered = await api(`/api/speaking/interviews/${interview.id}`);
      const recoveryBody = await json(recovered);
      check(`speaking Part ${part} refresh recovers state`, recoveryBody.interview?.state === `PART_${part}`);

      const makeForm = () => {
        const form = new FormData();
        form.append("audio", new Blob([wav], { type: "audio/wav" }), `part-${part}.wav`);
        form.append("durationSeconds", "2");
        form.append("part", String(part));
        return form;
      };
      const uploaded = await api(`/api/speaking/submissions/${speakingSubmissionId}/audio`, {
        method: "POST",
        form: makeForm(),
      });
      const uploadBody = await json(uploaded);
      check(`speaking Part ${part} audio upload returns 201`, uploaded.status === 201, `status ${uploaded.status}`);
      if (part === 1) recordingAssetId = uploadBody.audio?.assetId;
      check(`speaking Part ${part} recording stored`, typeof uploadBody.audio?.assetId === "string");

      const duplicateUpload = await api(`/api/speaking/submissions/${speakingSubmissionId}/audio`, {
        method: "POST",
        form: makeForm(),
      });
      const duplicateBody = await json(duplicateUpload);
      check(`speaking Part ${part} duplicate upload is idempotent`, duplicateUpload.status === 201);
      check(`speaking Part ${part} duplicate returns same asset`, duplicateBody.audio?.assetId === uploadBody.audio?.assetId);
    }

    const assets = await prisma.audioAsset.findMany({
      where: { submissionId: speakingSubmissionId },
      orderBy: { speakingPart: "asc" },
    });
    check("all three speaking recordings persisted", assets.length === 3);
    check("speaking audio rows contain metadata, not binary", assets.every((asset) => Boolean(asset.storageKey) && asset.sizeBytes === wav.length));

    const beforeEvaluation = await api(`/api/speaking/interviews/${interview.id}`);
    const beforeEvaluationBody = await json(beforeEvaluation);
    check("speaking reaches TRANSCRIBING after Part 3", beforeEvaluationBody.interview?.state === "TRANSCRIBING");

    const evaluated = await api(`/api/speaking/submissions/${speakingSubmissionId}/evaluate`, {
      method: "POST",
      body: { locale: "uz" },
    });
    const evaluation = await json(evaluated);
    check("speaking evaluation returns 200", evaluated.status === 200, `status ${evaluated.status}`);
    check("evaluation is flagged as mock (AI_MODE=mock)", evaluation.isMock === true, JSON.stringify(evaluation));
    check("evaluation produced an overall band", typeof evaluation.overall === "number");

    const stored = await prisma.speakingResult.findUnique({ where: { submissionId: speakingSubmissionId } });
    check("speaking result persisted", Boolean(stored));
    check("speaking result keeps the MOCK flag", stored?.isMock === true);
    check("speaking result stores the transcript", (stored?.transcript ?? "").length > 0);
    check(
      "speaking result stores provider metadata",
      Boolean(stored?.aiProvider) && Boolean(stored?.transcriptionProvider) && Boolean(stored?.promptVersion)
    );
    check(
      "speaking overall comes from the criteria (backend computed)",
      stored?.overall === evaluation.overall
    );

    // The recording is served to its owner and hidden from everyone else.
    const audioOwn = await api(`/api/audio/${recordingAssetId}`);
    check("owner can stream the recording", audioOwn.status === 200, `status ${audioOwn.status}`);

    const otherUserJar = cookieHeader();
    jar.clear();
    const otherRegister = await api("/api/auth/register", {
      method: "POST",
      auth: false,
      body: { name: "Intruder", phone: intruderPhone, password },
    });
    check("second user registers for the ownership check", otherRegister.status === 201);
    const otherLogin = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { phone: intruderPhone, password },
    });
    check("second user logs in", otherLogin.status === 200);

    const foreign = await api(`/api/audio/${recordingAssetId}`);
    check("other user cannot stream the recording (404)", foreign.status === 404, `status ${foreign.status}`);

    const foreignResult = await api(`/api/speaking/submissions/${speakingSubmissionId}`);
    check("other user cannot read the submission (404)", foreignResult.status === 404, `status ${foreignResult.status}`);

    const foreignAttempt = await api(`/api/attempts/${readingAttemptId}/result`);
    check("other user cannot read a reading result (404)", foreignAttempt.status === 404, `status ${foreignAttempt.status}`);

    const foreignPatch = await api(`/api/attempts/${readingAttemptId}`, {
      method: "PATCH",
      body: { responses: {} },
    });
    check("other user cannot modify or enumerate an attempt (404)", foreignPatch.status === 404, `status ${foreignPatch.status}`);

    // Back to the original learner.
    jar.clear();
    jar.set("axi_session", otherUserJar.match(/axi_session=([^;]*)/)?.[1] ?? "");
    await api("/api/auth/login", { method: "POST", auth: false, body: { phone: emailPhone, password } });

    await htmlOk(`/speaking/result/${speakingSubmissionId}`, "speaking result", ["MOCK", "Umumiy ball", "Transkript"]);
    await htmlOk("/speaking", "speaking catalog", ["Mavjud testlar"]);
  }

  section("8. DASHBOARD + HISTORY (all four modules)");
  {
    const html = await htmlOk("/dashboard", "dashboard (with data)", ["module-card-WRITING"]);
    for (const moduleName of ["WRITING", "READING", "LISTENING", "SPEAKING"]) {
      check(`dashboard shows the ${moduleName} card`, html.includes(`module-card-${moduleName}`));
    }

    const readingProgress = await prisma.testAttempt.findMany({
      where: { userId: user.id, module: "READING", status: "GRADED" },
    });
    const listeningProgress = await prisma.testAttempt.findMany({
      where: { userId: user.id, module: "LISTENING", status: "GRADED" },
    });
    const writingSubmissions = await prisma.submission.count({
      where: { userId: user.id, module: "WRITING", status: "COMPLETED" },
    });
    const speakingResults = await prisma.speakingResult.count({
      where: { submission: { userId: user.id } },
    });

    check("DB: reading results for the user", readingProgress.length === 1);
    check("DB: listening results for the user", listeningProgress.length === 1);
    check("DB: writing submissions for the user", writingSubmissions === 1);
    check("DB: speaking results for the user", speakingResults === 1);

    const progressPeeks = await api("/api/attempts");
    const progressBody = await json(progressPeeks);
    check("progress API returns reading band", progressBody.modules?.READING?.latestBand === readingBand);
    check("progress API returns listening history", progressBody.modules?.LISTENING?.attempts === 1);
  }

  section("9. MOCK LABELLING + SECRET EXPOSURE");
  {
    const resultPage = await (await api(`/speaking/result/${speakingSubmissionId}`)).text();
    check("speaking result page shows the MOCK banner", resultPage.includes("MOCK"));
    check(
      "speaking result page states it is not a real AI evaluation",
      resultPage.includes("haqiqiy") || resultPage.includes("Haqiqiy") || resultPage.includes("настоящая")
    );

    for (const path of [
      `/api/attempts/${readingAttemptId}/result`,
      `/api/speaking/submissions/${speakingSubmissionId}`,
      "/api/tests/reading",
    ]) {
      const text = await (await api(path)).text();
      check(`${path} leaks no API key`, !/AIza[0-9A-Za-z_-]{10,}/.test(text));
      check(`${path} leaks no env secret`, !text.includes("GEMINI_API_KEY"));
    }
  }

  await prisma.user.deleteMany({ where: { phone: { in: [emailPhone, intruderPhone] } } });
  await prisma.$disconnect();

  section("SUMMARY");
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failures.length}`);
  for (const failure of failures) console.log(`   - ${failure}`);

  process.exit(failures.length === 0 ? 0 : 1);
}

/** Minimal 8-bit PCM WAV so the upload endpoint receives a real audio file. */
function makeWav(seconds) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const dataSize = samples;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    buffer[44 + i] = 128 + Math.round(60 * Math.sin((2 * Math.PI * 220 * i) / sampleRate));
  }
  return buffer;
}

main().catch(async (error) => {
  console.error("\nE2E smoke crashed:", error);
  try {
    await prisma.user.deleteMany({ where: { phone: { in: [emailPhone, intruderPhone] } } });
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
