import { AttemptResultPage } from "@/components/testing/AttemptResultPage";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <AttemptResultPage module="READING" attemptId={params.id} />;
}
