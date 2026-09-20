import { describe, expect, it } from "vitest";
import { buildAdaptiveFollowUp } from "@/lib/speaking/adaptive-follow-up";
import { buildRepeatSpeech, canListenForExaminerCommands, classifyExaminerIntent } from "@/lib/speaking/examiner-intents";

describe("speaking examiner commands", () => {
  it("recognises natural repeat and ready requests", () => {
    expect(classifyExaminerIntent("Could you repeat that, please?".valueOf())).toBe("REPEAT_QUESTION");
    expect(classifyExaminerIntent("Pardon, could you say it again?")).toBe("REPEAT_QUESTION");
    expect(classifyExaminerIntent("I'm ready to begin.")).toBe("READY");
    expect(classifyExaminerIntent("I enjoy reading books.")).toBe("NONE");
  });

  it("repeats the exact public prompt and only listens in interview states", () => {
    expect(buildRepeatSpeech("Where do you live?")).toBe("Of course. Where do you live?");
    expect(canListenForExaminerCommands("PREPARING")).toBe(true);
    expect(canListenForExaminerCommands("PART_2")).toBe(true);
    expect(canListenForExaminerCommands("EVALUATING")).toBe(false);
  });
});

describe("mock adaptive follow-up", () => {
  it("uses deterministic, part-aware follow-ups", () => {
    expect(buildAdaptiveFollowUp(1, "I study computer science at university")).toBe("What do you enjoy most about that?");
    expect(buildAdaptiveFollowUp(3, "I think governments should support public transport")).toBe("What responsibility should governments have in this area?");
    expect(buildAdaptiveFollowUp(2, "This is a long cue card response about my journey")).toBeNull();
    expect(buildAdaptiveFollowUp(1, "Too short")).toBeNull();
  });
});
