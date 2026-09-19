import { AttemptResultPage } from "@/components/testing/AttemptResultPage";

export default function Page({ params }: { params: { id: string } }) {
  return <AttemptResultPage module="READING" attemptId={params.id} />;
}
