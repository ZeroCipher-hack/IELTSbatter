import { ModuleRunnerPage } from "@/components/testing/ModuleRunnerPage";

export default async function Page(props: { params: Promise<{ testId: string }> }) {
  const params = await props.params;
  return <ModuleRunnerPage module="LISTENING" testId={params.testId} />;
}
