import { ModuleRunnerPage } from "@/components/testing/ModuleRunnerPage";

export default function Page({ params }: { params: { testId: string } }) {
  return <ModuleRunnerPage module="READING" testId={params.testId} />;
}
