#!/usr/bin/env node
/**
 * Development seed for the Reading, Listening and Speaking modules.
 *
 * Content is synthetic practice material written for this project — no real
 * IELTS papers and no real user data. Listening audio is a generated sample
 * tone that exists so the player and the storage pipeline can be exercised;
 * it is clearly labelled as a placeholder, and no mock result is ever shown
 * as a real one.
 *
 * Idempotent: running it again replaces the seeded tests by title.
 *
 * Usage:  npm run db:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getPublicStorage } from "../src/lib/storage";
import type { QuestionAnswerKey, QuestionOption, QuestionType } from "../src/lib/testing/types";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* rely on the real environment */
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

interface SeedQuestion {
  number: number;
  type: QuestionType;
  prompt: string;
  options?: QuestionOption[];
  answer: string[];
  explanation?: string;
  groupId?: string;
  meta?: Record<string, unknown>;
}

interface SeedSection {
  title: string;
  instructions?: string;
  passage?: string;
  questions: SeedQuestion[];
}

interface SeedTest {
  title: string;
  description: string;
  module: "READING" | "LISTENING" | "SPEAKING";
  durationMinutes: number;
  sections: SeedSection[];
}

/* ------------------------------------------------------------------ audio */

/**
 * Minimal 8-bit mono PCM WAV so listeners have something real to play in
 * development. It is a soft two-tone chime, not a recording of an exam.
 */
function makeSampleWav(seconds: number, sampleRate = 8000): Uint8Array {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byte rate
  buffer.writeUInt16LE(1, 32); // block align
  buffer.writeUInt16LE(8, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples, 40);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const tone = Math.sin(2 * Math.PI * 440 * t) * 0.25 + Math.sin(2 * Math.PI * 660 * t) * 0.15;
    buffer[44 + i] = 128 + Math.round(tone * 100);
  }
  return new Uint8Array(buffer);
}

/* -------------------------------------------------------------- test data */

const READING_SECTIONS: SeedSection[] = [
  {
    title: "Passage 1 — The Return of Urban Beekeeping",
    instructions: "Read the passage and answer questions 1-7.",
    passage: `City rooftops were once seen as dead space, but over the past two decades they have become unlikely homes for honeybees. In London, Paris and New York, hives now sit above banks, opera houses and apartment blocks, tended by hobbyists and, increasingly, by companies keen to advertise their environmental credentials.

Supporters argue that urban hives help pollinators. Cities, they point out, are often warmer than surrounding countryside and contain a surprising density of flowering plants in parks, gardens and roadside verges. Because pesticides are used less intensively in built-up areas than on farmland, urban colonies can sometimes thrive where rural ones struggle.

Ecologists, however, are not unanimous. Several studies have found that adding hives does not necessarily increase the number of wild bees; in some cases, competition for limited nectar may harm rare solitary species. Dr Marta Feld, who has surveyed pollinators in four European cities, notes that honeybees are a managed livestock species rather than an endangered one. "Putting a hive on a roof feels like conservation," she says, "but if the goal is biodiversity, planting diverse flowers achieves more."

Municipal attitudes differ sharply. Some city councils actively encourage beekeeping by granting roof access and offering training courses. Others have restricted hive numbers, arguing that the craft has become fashionable faster than the evidence base has grown.

For the beekeepers themselves, the appeal is rarely purely ecological. Honey harvested from urban hives often carries distinctive flavours, and the sheer novelty of producing food in the middle of a metropolis is part of the attraction. Whatever the ecological verdict, the rooftop hive has already changed how city dwellers think about the natural world.`,
    questions: [
      {
        number: 1,
        type: "TRUE_FALSE_NOT_GIVEN",
        prompt: "Urban hives are often kept by companies as well as by hobbyists.",
        answer: ["TRUE"],
        explanation: "The first paragraph mentions hobbyists 'and, increasingly, by companies'.",
      },
      {
        number: 2,
        type: "TRUE_FALSE_NOT_GIVEN",
        prompt: "Farmland generally uses more pesticides than built-up areas.",
        answer: ["TRUE"],
        explanation: "Paragraph two states pesticides are used less intensively in built-up areas than on farmland.",
      },
      {
        number: 3,
        type: "TRUE_FALSE_NOT_GIVEN",
        prompt: "Dr Feld believes that increasing the number of hives is the most effective way to protect biodiversity.",
        answer: ["FALSE"],
        explanation: "She says that if the goal is biodiversity, planting diverse flowers achieves more.",
      },
      {
        number: 4,
        type: "TRUE_FALSE_NOT_GIVEN",
        prompt: "Beekeeping on rooftops was first introduced in Japan.",
        answer: ["NOT GIVEN"],
        explanation: "No country of origin is mentioned anywhere in the passage.",
      },
      {
        number: 5,
        type: "MULTIPLE_CHOICE",
        prompt: "According to the passage, one advantage cities have over farmland is",
        options: [
          { value: "A", label: "a greater variety of flowering plants and warmer conditions." },
          { value: "B", label: "stricter regulation of hive numbers." },
          { value: "C", label: "a shortage of competing wild bee species." },
          { value: "D", label: "higher honey prices." },
        ],
        answer: ["A"],
        explanation: "Paragraph two cites warmer conditions and a density of flowering plants.",
      },
      {
        number: 6,
        type: "MULTIPLE_CHOICE",
        prompt: "What does Dr Feld suggest about honeybees?",
        options: [
          { value: "A", label: "They are close to extinction in rural areas." },
          { value: "B", label: "They are a managed species rather than an endangered one." },
          { value: "C", label: "They compete more successfully than solitary bees in all habitats." },
          { value: "D", label: "They should be banned from city centres." },
        ],
        answer: ["B"],
        explanation: "She describes honeybees as 'managed livestock' rather than endangered.",
      },
      {
        number: 7,
        type: "SHORT_ANSWER",
        prompt: "Which two cities are named in the passage alongside London as places with rooftop hives?",
        answer: ["Paris and New York", "New York and Paris"],
        explanation: "The opening paragraph names London, Paris and New York.",
        meta: { wordLimit: 4 },
      },
    ],
  },
  {
    title: "Passage 2 — Why Sleep Shapes Memory",
    instructions: "Read the passage and answer questions 8-14.",
    passage: `For decades, sleep was treated as a passive state, a nightly pause in which the brain simply rested. That view has collapsed. We now know that sleep is an active period during which recently formed memories are stabilised and reorganised, and that the consequences of losing it are measurable within days.

The process begins with the hippocampus, a structure that encodes the day's experiences quickly but holds them precariously. During deep slow-wave sleep, those fragile traces are replayed and gradually transferred to the neocortex, where they are integrated with existing knowledge. The electrical signature of this transfer — bursts of activity known as sleep spindles — correlates strongly with how much a person remembers the following morning.

Rapid eye movement sleep plays a different role. It appears to support the extraction of patterns and rules, allowing learners to generalise from examples rather than merely recall them. In one influential experiment, participants who slept between training sessions were far more likely to discover a hidden rule behind a sequence of symbols than participants who stayed awake for the same number of hours.

The practical implications are uncomfortable. Students who shorten sleep to study more often learn less, because the consolidation they are cutting short is what turns exposure into durable knowledge. Shift workers and new parents face a similar penalty, and the effect accumulates: a week of five-hour nights impairs performance comparably to a full night without sleep.

Researchers are careful not to overstate matters. Sleep cannot create memories from material that was never attended to, and individual requirements vary. What is now beyond dispute is the direction of the relationship: learning depends on sleep far more than sleep depends on learning.`,
    questions: [
      {
        number: 8,
        type: "MATCHING",
        prompt: "Deep slow-wave sleep — choose the correct description (i-v).",
        options: [
          { value: "i", label: "Supports extracting rules and generalising from examples." },
          { value: "ii", label: "Transfers fragile traces to long-term storage." },
          { value: "iii", label: "Has no measurable effect on memory." },
          { value: "iv", label: "Only occurs in shift workers." },
          { value: "v", label: "Replaces the need for attention." },
        ],
        answer: ["ii"],
        explanation: "Deep slow-wave sleep transfers traces from the hippocampus to the neocortex.",
        groupId: "sleep-phases",
      },
      {
        number: 9,
        type: "MATCHING",
        prompt: "Rapid eye movement sleep — choose the correct description (i-v).",
        options: [
          { value: "i", label: "Supports extracting rules and generalising from examples." },
          { value: "ii", label: "Transfers fragile traces to long-term storage." },
          { value: "iii", label: "Has no measurable effect on memory." },
          { value: "iv", label: "Only occurs in shift workers." },
          { value: "v", label: "Replaces the need for attention." },
        ],
        answer: ["i"],
        explanation: "REM sleep supports pattern extraction and generalisation.",
        groupId: "sleep-phases",
      },
      {
        number: 10,
        type: "MATCHING",
        prompt: "Sleep spindles — choose the correct description (i-v).",
        options: [
          { value: "i", label: "Supports extracting rules and generalising from examples." },
          { value: "ii", label: "Transfers fragile traces to long-term storage." },
          { value: "iii", label: "The electrical sign of memory transfer." },
          { value: "iv", label: "Only occurs in shift workers." },
          { value: "v", label: "Replaces the need for attention." },
        ],
        answer: ["iii"],
        explanation: "Sleep spindles are the electrical signature of the transfer process.",
        groupId: "sleep-phases",
      },
      {
        number: 11,
        type: "SENTENCE_COMPLETION",
        prompt: "Complete the sentence: Learning depends on sleep far more than sleep depends on ______.",
        answer: ["learning"],
        explanation: "The final sentence states the direction of the relationship.",
        meta: { wordLimit: 1 },
      },
      {
        number: 12,
        type: "SENTENCE_COMPLETION",
        prompt: "Complete the sentence: A week of five-hour nights impairs performance comparably to a ______ without sleep.",
        answer: ["full night", "whole night", "complete night"],
        explanation: "The fourth paragraph compares it to 'a full night without sleep'.",
        meta: { wordLimit: 2 },
      },
      {
        number: 13,
        type: "YES_NO_NOT_GIVEN",
        prompt: "The writer believes sleep can create memories from material that was never attended to.",
        answer: ["NO"],
        explanation: "The writer says researchers are careful not to claim this.",
      },
      {
        number: 14,
        type: "YES_NO_NOT_GIVEN",
        prompt: "The writer believes individual sleep requirements vary.",
        answer: ["YES"],
        explanation: "The last paragraph states that individual requirements vary.",
      },
    ],
  },
];

const LISTENING_SECTIONS: SeedSection[] = [
  {
    title: "Section 1 — Booking a conference venue",
    instructions: "Listen to the conversation and answer questions 1-6. Write NO MORE THAN TWO WORDS for each answer.",
    questions: [
      {
        number: 1,
        type: "SHORT_ANSWER",
        prompt: "The venue is located on ______ Street.",
        answer: ["Harbour", "Harbor"],
        explanation: "The receptionist says the entrance is on Harbour Street.",
        meta: { wordLimit: 2 },
      },
      {
        number: 2,
        type: "SHORT_ANSWER",
        prompt: "The conference room can hold a maximum of ______ people.",
        answer: ["120", "one hundred and twenty"],
        explanation: "The capacity is stated as 120 people.",
        meta: { wordLimit: 4 },
      },
      {
        number: 3,
        type: "SENTENCE_COMPLETION",
        prompt: "The deposit must be paid within ______ days of booking.",
        answer: ["14", "fourteen"],
        explanation: "A 14-day payment window is quoted.",
        meta: { wordLimit: 2 },
      },
      {
        number: 4,
        type: "MULTIPLE_CHOICE",
        prompt: "What does the price of the room include?",
        options: [
          { value: "A", label: "Lunch and refreshments" },
          { value: "B", label: "Audio-visual equipment and parking" },
          { value: "C", label: "Accommodation" },
          { value: "D", label: "Nothing — all extras are charged separately" },
        ],
        answer: ["B"],
        explanation: "Equipment and parking are included; catering is not.",
      },
      {
        number: 5,
        type: "MULTIPLE_CHOICE",
        prompt: "Why is the caller asked to confirm numbers by Friday?",
        options: [
          { value: "A", label: "The venue closes for the weekend." },
          { value: "B", label: "Catering must be ordered in advance." },
          { value: "C", label: "Another company wants the same date." },
          { value: "D", label: "The price increases next week." },
        ],
        answer: ["B"],
        explanation: "Catering has to be ordered with the supplier in advance.",
      },
      {
        number: 6,
        type: "SHORT_ANSWER",
        prompt: "What is the name of the events manager the caller should contact?",
        answer: ["Ms Okoro", "Okoro", "Miss Okoro"],
        explanation: "The events manager is introduced as Ms Okoro.",
        meta: { wordLimit: 3 },
      },
    ],
  },
  {
    title: "Section 2 — Museum orientation talk",
    instructions: "Listen to the talk and answer questions 7-12.",
    questions: [
      {
        number: 7,
        type: "MATCHING",
        prompt: "The Hall of Minerals — choose the correct location (i-v).",
        options: [
          { value: "i", label: "Ground floor, west wing" },
          { value: "ii", label: "First floor, east wing" },
          { value: "iii", label: "Basement level" },
          { value: "iv", label: "Temporary exhibition space" },
          { value: "v", label: "Outdoor courtyard" },
        ],
        answer: ["i"],
        explanation: "The Hall of Minerals is on the ground floor in the west wing.",
        groupId: "museum-map",
      },
      {
        number: 8,
        type: "MATCHING",
        prompt: "The photography exhibition — choose the correct location (i-v).",
        options: [
          { value: "i", label: "Ground floor, west wing" },
          { value: "ii", label: "First floor, east wing" },
          { value: "iii", label: "Basement level" },
          { value: "iv", label: "Temporary exhibition space" },
          { value: "v", label: "Outdoor courtyard" },
        ],
        answer: ["iv"],
        explanation: "It is a temporary exhibition.",
        groupId: "museum-map",
      },
      {
        number: 9,
        type: "MATCHING",
        prompt: "The cafe — choose the correct location (i-v).",
        options: [
          { value: "i", label: "Ground floor, west wing" },
          { value: "ii", label: "First floor, east wing" },
          { value: "iii", label: "Basement level" },
          { value: "iv", label: "Temporary exhibition space" },
          { value: "v", label: "Outdoor courtyard" },
        ],
        answer: ["ii"],
        explanation: "The cafe is upstairs in the east wing.",
        groupId: "museum-map",
      },
      {
        number: 10,
        type: "MULTIPLE_CHOICE",
        prompt: "What should visitors do before entering the photography exhibition?",
        options: [
          { value: "A", label: "Leave large bags in a locker" },
          { value: "B", label: "Pay an additional fee" },
          { value: "C", label: "Join a guided tour" },
          { value: "D", label: "Book a timed slot online" },
        ],
        answer: ["A"],
        explanation: "Large bags must be left in the lockers near the entrance.",
      },
      {
        number: 11,
        type: "TRUE_FALSE_NOT_GIVEN",
        prompt: "The museum offers free guided tours every afternoon.",
        answer: ["TRUE"],
        explanation: "Free guided tours run every afternoon at 2 pm.",
      },
      {
        number: 12,
        type: "TRUE_FALSE_NOT_GIVEN",
        prompt: "The museum is closed to the public on public holidays.",
        answer: ["NOT GIVEN"],
        explanation: "Holiday opening hours are never mentioned.",
      },
    ],
  },
];

const SPEAKING_SECTIONS: SeedSection[] = [
  {
    title: "Part 1 — Introduction and interview",
    instructions: "Answer each question. Use the preparation time to organise your ideas.",
    questions: [
      {
        number: 1,
        type: "SHORT_ANSWER",
        prompt: "Let's talk about where you live. Do you live in a house or an apartment?",
        answer: [""],
        meta: { prepSeconds: 5, speakSeconds: 45 },
      },
      {
        number: 2,
        type: "SHORT_ANSWER",
        prompt: "What do you like most about your neighbourhood?",
        answer: [""],
        meta: { prepSeconds: 5, speakSeconds: 45 },
      },
      {
        number: 3,
        type: "SHORT_ANSWER",
        prompt: "How often do you use public transport?",
        answer: [""],
        meta: { prepSeconds: 5, speakSeconds: 45 },
      },
    ],
  },
  {
    title: "Part 2 — Individual long turn",
    instructions:
      "You have 1 minute to prepare, then speak for up to 2 minutes. You may make notes.",
    questions: [
      {
        number: 4,
        type: "SHORT_ANSWER",
        prompt:
          "Describe a journey that did not go as planned. You should say: where you were going, what went wrong, how you dealt with it, and explain how you felt about the experience.",
        answer: [""],
        meta: { prepSeconds: 60, speakSeconds: 120, isCueCard: true },
      },
    ],
  },
  {
    title: "Part 3 — Two-way discussion",
    instructions: "Give extended answers and justify your opinions.",
    questions: [
      {
        number: 5,
        type: "SHORT_ANSWER",
        prompt:
          "Why do you think people enjoy travelling to unfamiliar places?",
        answer: [""],
        meta: { prepSeconds: 5, speakSeconds: 90 },
      },
      {
        number: 6,
        type: "SHORT_ANSWER",
        prompt:
          "Should governments invest more in public transport than in roads? Why?",
        answer: [""],
        meta: { prepSeconds: 5, speakSeconds: 90 },
      },
    ],
  },
];

const TESTS: SeedTest[] = [
  {
    title: "Academic Reading — Practice Test 1",
    description:
      "Two passages on urban beekeeping and sleep science, with 14 questions covering all supported question types.",
    module: "READING",
    durationMinutes: 20,
    sections: READING_SECTIONS,
  },
  {
    title: "Listening — Practice Test 1",
    description:
      "Two sections with 12 questions. The audio is a generated sample tone used as a placeholder for a real recording.",
    module: "LISTENING",
    durationMinutes: 15,
    sections: LISTENING_SECTIONS,
  },
  {
    title: "Speaking — Full Mock Test 1",
    description: "All three parts of the speaking test with preparation and speaking timers.",
    module: "SPEAKING",
    durationMinutes: 15,
    sections: SPEAKING_SECTIONS,
  },
];

/* -------------------------------------------------------------- upserting */

async function seedTest(test: SeedTest): Promise<string> {
  // Replace any previous seed of the same title (cascade deletes children).
  await prisma.test.deleteMany({ where: { title: test.title, module: test.module } });

  const created = await prisma.test.create({
    data: {
      module: test.module,
      title: test.title,
      description: test.description,
      durationMinutes: test.durationMinutes,
      isPublished: true,
    },
  });

  for (let sectionIndex = 0; sectionIndex < test.sections.length; sectionIndex++) {
    const section = test.sections[sectionIndex];
    let sectionAudioId: string | null = null;
    if (test.module === "LISTENING") {
      // One audio asset per section: a section owns exactly one file.
      const key = `listening/practice-1-section-${sectionIndex + 1}.wav`;
      const durationSeconds = 4;
      const stored = await getPublicStorage().put({
        key,
        data: makeSampleWav(durationSeconds),
        mimeType: "audio/wav",
      });
      const asset = await prisma.audioAsset.upsert({
        where: { storageKey: stored.key },
        update: { url: stored.url, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType },
        create: {
          kind: "LISTENING_SECTION",
          storageKey: stored.key,
          url: stored.url,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          durationSeconds,
        },
      });
      sectionAudioId = asset.id;
    }

    const createdSection = await prisma.testSection.create({
      data: {
        testId: created.id,
        order: sectionIndex,
        title: section.title,
        instructions: section.instructions ?? null,
        passage: section.passage ?? null,
        audioAssetId: sectionAudioId,
      },
    });

    for (let questionIndex = 0; questionIndex < section.questions.length; questionIndex++) {
      const question = section.questions[questionIndex];
      const answerKey: QuestionAnswerKey = { answers: question.answer };
      await prisma.testQuestion.create({
        data: {
          sectionId: createdSection.id,
          order: questionIndex,
          number: question.number,
          type: question.type,
          prompt: question.prompt,
          options: (question.options ?? undefined) as unknown as object | undefined,
          answer: answerKey as unknown as object,
          explanation: question.explanation ?? null,
          points: 1,
          meta: (question.meta ?? undefined) as unknown as object | undefined,
          groupId: question.groupId ?? null,
        },
      });
    }
  }

  return created.id;
}

async function main(): Promise<void> {
  for (const test of TESTS) {
    const id = await seedTest(test);
    const questionCount = await prisma.testQuestion.count({
      where: { section: { testId: id } },
    });
    console.log(`seeded ${test.module.padEnd(8)} ${test.title}  (${questionCount} questions)`);
  }

  // Drop listening assets that no section references any more (for example
  // leftovers from an earlier seed layout) so reruns stay clean.
  await prisma.audioAsset.deleteMany({
    where: { kind: "LISTENING_SECTION", sections: { none: {} } },
  });

  const totals = {
    tests: await prisma.test.count(),
    sections: await prisma.testSection.count(),
    questions: await prisma.testQuestion.count(),
    audioAssets: await prisma.audioAsset.count(),
  };
  console.log("totals:", totals);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
