import { ModuleRunnerPage } from "@/components/testing/ModuleRunnerPage";

export default async function Page(props: { params: Promise<{ testId: string }>; searchParams: Promise<{ fullExamId?: string }> }) {
  const params = await props.params;
  const search = await props.searchParams;
  return <ModuleRunnerPage module="READING" testId={params.testId} fullExamSessionId={search.fullExamId ?? null} />;
}
